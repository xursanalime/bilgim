import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { RedisService } from '../../../infra/redis/redis.service';
import { KeyManagementService } from './key-management.service';
import { KmsEnvelopeService } from './kms-envelope.service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Description of a single column targeted by the re-encrypt sweep.
 * Each entry maps to a Prisma model + string field, with an optional
 * AAD producer (so re-encryption preserves the per-row context).
 */
export interface ReencryptTarget {
  /** Prisma model name (e.g. `User`). */
  model: 'User' | 'PaymeTransaction';
  /** Column name to re-encrypt. */
  field: string;
  /**
   * Returns the AAD bound to a particular row, or `undefined` when
   * the column is not context-bound. Defaults to `undefined`.
   */
  aadFor?: (row: Record<string, unknown>) => string | undefined;
}

/**
 * Defaults documented in the Task 28.2 brief — every column
 * registered in `DEFAULT_ENCRYPTED_FIELDS` from
 * `prisma-encryption.extension.ts` plus the new `cardLastFour` /
 * `account` JSON fields. JSON fields are skipped because the master
 * encryption extension stores them as plaintext JSON; the v2 KMS
 * format only kicks in once the application starts going through
 * `KmsEnvelopeService` for those columns.
 */
export const DEFAULT_REENCRYPT_TARGETS: ReencryptTarget[] = [
  { model: 'User', field: 'phone' },
  { model: 'User', field: 'address' },
  { model: 'PaymeTransaction', field: 'cardLastFour' },
];

export interface ReencryptOptions {
  /** Batch size for the scan. Defaults to 100. */
  batchSize?: number;
  /** Optional override of the target list. */
  targets?: ReencryptTarget[];
  /** Override the active key id (defaults to current active key). */
  toKeyId?: string;
}

export interface ReencryptResult {
  target: ReencryptTarget;
  scanned: number;
  reencrypted: number;
  skippedAlreadyActive: number;
  skippedNotEnvelope: number;
  failed: number;
}

/** Redis key under which progress is tracked for ops dashboards. */
const PROGRESS_KEY_PREFIX = 'kms:reencrypt:progress';

/**
 * `ReencryptProcessor` — Task 28.2.
 *
 * Sweeps every encrypted column listed in {@link DEFAULT_REENCRYPT_TARGETS}
 * and re-wraps any row whose envelope still references a non-active
 * key id. Idempotent — running twice is a no-op (rows already on the
 * active key are skipped).
 *
 * Implementation choices:
 *   - **Streaming over batches**, not a single transaction. Each
 *     batch is fetched with `findMany({ take: batchSize, skip: ... })`
 *     and processed in a tight loop. A failure on one row never
 *     aborts the rest of the batch — the failure is logged and the
 *     loop continues so a single corrupt envelope can't block the
 *     rotation.
 *   - **Direct Prisma access** (not the encryption extension).
 *     We need the raw envelope string on read so we can introspect
 *     the embedded key id. The transparent decryption path would
 *     give us plaintext (and the wrong key id on the way back).
 *   - **`updateMany` is avoided** because we compute one envelope
 *     per row (random IV / fresh tag). A per-row `update` is the
 *     correct shape; the batched-fetch pattern keeps the I/O cost
 *     predictable.
 *
 * Operability:
 *   - Progress is tracked in Redis under
 *     `kms:reencrypt:progress:<jobId>` so operators can poll the
 *     sweep without Tail-ing logs.
 *   - The processor returns a structured `ReencryptResult` per
 *     target so the admin endpoint can render a summary.
 *
 * BullMQ wiring (Task 28.2 brief, point 3):
 *   - The KeyManagementService rotation hook posts a job onto a
 *     queue named `kms-reencrypt`. A worker calls `runOnce()` on
 *     this processor and writes the result back as job result. The
 *     queue declaration is intentionally NOT registered globally in
 *     `BullMqModule` to keep that file additive — the SecurityModule
 *     calls `runOnce()` synchronously today and a future task can
 *     promote the call onto a real BullMQ worker.
 */
@Injectable()
export class ReencryptProcessor {
  private readonly logger = new Logger(ReencryptProcessor.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly keyManagement: KeyManagementService,
    private readonly envelope: KmsEnvelopeService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Run the sweep once. Returns a structured per-target summary.
   * The optional `jobId` is used as a Redis progress-tracking key
   * so callers can poll the run; defaults to a timestamp-based id.
   */
  async runOnce(
    options: ReencryptOptions & { jobId?: string } = {},
  ): Promise<ReencryptResult[]> {
    const targets = options.targets ?? DEFAULT_REENCRYPT_TARGETS;
    const batchSize = options.batchSize ?? 100;
    const jobId = options.jobId ?? `auto-${Date.now()}`;

    const activeKey = await this.keyManagement.getActiveKey();
    const activeKeyId = options.toKeyId ?? activeKey.id;

    await this.recordProgress(jobId, {
      stage: 'started',
      activeKeyId,
      targets: targets.map((t) => `${t.model}.${t.field}`),
      startedAt: new Date().toISOString(),
    });

    const results: ReencryptResult[] = [];
    for (const target of targets) {
      try {
        const result = await this.runTarget(target, batchSize, activeKeyId);
        results.push(result);
        const { target: _resultTarget, ...counts } = result;
        await this.recordProgress(jobId, {
          stage: 'target_complete',
          target: `${target.model}.${target.field}`,
          ...counts,
        });
      } catch (err) {
        this.logger.error(
          `runOnce: target ${target.model}.${target.field} failed: ${(err as Error).message}`,
          (err as Error).stack,
        );
        results.push({
          target,
          scanned: 0,
          reencrypted: 0,
          skippedAlreadyActive: 0,
          skippedNotEnvelope: 0,
          failed: 1,
        });
      }
    }

    await this.recordProgress(jobId, {
      stage: 'complete',
      finishedAt: new Date().toISOString(),
      summary: results.map((r) => ({
        target: `${r.target.model}.${r.target.field}`,
        scanned: r.scanned,
        reencrypted: r.reencrypted,
      })),
    });

    return results;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async runTarget(
    target: ReencryptTarget,
    batchSize: number,
    activeKeyId: string,
  ): Promise<ReencryptResult> {
    const result: ReencryptResult = {
      target,
      scanned: 0,
      reencrypted: 0,
      skippedAlreadyActive: 0,
      skippedNotEnvelope: 0,
      failed: 0,
    };

    let cursor: string | undefined;
    // Loop until a batch returns fewer than `batchSize` rows. Each
    // iteration reads `batchSize` rows ordered by id, processes
    // them in memory and persists the updates one row at a time.
    /* eslint-disable no-constant-condition */
    while (true) {
      const rows = await this.fetchBatch(target, batchSize, cursor);
      if (rows.length === 0) break;
      result.scanned += rows.length;
      cursor = String(rows[rows.length - 1]?.id ?? '');

      for (const row of rows) {
        const id = String(row.id);
        const value = row[target.field];
        if (typeof value !== 'string' || value.length === 0) {
          result.skippedNotEnvelope++;
          continue;
        }
        if (!this.envelope.isEnvelope(value)) {
          result.skippedNotEnvelope++;
          continue;
        }
        const currentKeyId = this.envelope.extractKeyId(value);
        if (currentKeyId === activeKeyId) {
          result.skippedAlreadyActive++;
          continue;
        }
        try {
          const aad = target.aadFor?.(row);
          const plaintext = await this.envelope.decrypt(value, aad);
          const fresh = await this.envelope.encrypt(plaintext, aad);
          await this.persistRow(target, id, fresh);
          result.reencrypted++;
        } catch (err) {
          result.failed++;
          this.logger.warn(
            `runTarget: ${target.model}.${target.field} id=${id} failed: ${(err as Error).message}`,
          );
        }
      }

      if (rows.length < batchSize) break;
    }
    return result;
  }

  /**
   * Fetch a single batch of rows for a target. Uses the underlying
   * Prisma model dynamically — the encryption extension is bypassed
   * so we read raw envelopes.
   */
  private async fetchBatch(
    target: ReencryptTarget,
    batchSize: number,
    cursor: string | undefined,
  ): Promise<Array<Record<string, unknown> & { id: string }>> {
    const select: Record<string, true> = { id: true, [target.field]: true };
    const args: Record<string, unknown> = {
      take: batchSize,
      orderBy: { id: 'asc' },
      select,
    };
    if (cursor) {
      // Skip the cursor row itself so we make forward progress.
      args.cursor = { id: cursor };
      args.skip = 1;
    }
    // Indexed access is intentional — Prisma's generated client
    // exposes models via the lower-cased model name.
    const delegate = (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
    }>)[this.delegateName(target.model)];
    if (!delegate) {
      throw new Error(`ReencryptProcessor: unknown delegate for ${target.model}`);
    }
    const rows = (await delegate.findMany(args)) as Array<
      Record<string, unknown> & { id: string }
    >;
    return rows;
  }

  /** Persist the freshly-re-encrypted envelope back to the row. */
  private async persistRow(
    target: ReencryptTarget,
    id: string,
    envelope: string,
  ): Promise<void> {
    const delegate = (this.prisma as unknown as Record<string, {
      update: (a: unknown) => Promise<unknown>;
    }>)[this.delegateName(target.model)];
    if (!delegate) {
      throw new Error(`ReencryptProcessor: unknown delegate for ${target.model}`);
    }
    await delegate.update({
      where: { id },
      data: { [target.field]: envelope },
    });
  }

  private delegateName(model: string): string {
    return model.charAt(0).toLowerCase() + model.slice(1);
  }

  private async recordProgress(jobId: string, payload: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      const key = `${PROGRESS_KEY_PREFIX}:${jobId}`;
      await this.redis.set(key, JSON.stringify(payload), 60 * 60 * 24);
    } catch (err) {
      // Progress tracking is observability — never let a Redis
      // hiccup mask the sweep itself.
      this.logger.debug(
        `recordProgress: failed to write ${jobId}: ${(err as Error).message}`,
      );
    }
  }
}
