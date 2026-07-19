import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, type EncryptionKey } from '@prisma/client';

import { EncryptionService } from '../../../common/security/encryption/encryption.service';
import { FieldEncryptionError } from '../../../common/security/encryption/encryption.errors';
import type { KmsKey, KmsKeyStatus, KmsProvider } from './kms.port';

/**
 * `LocalKmsProvider` — Task 28.2.
 *
 * Stores DEKs (data-encryption keys) in the Prisma `EncryptionKey`
 * table. Each row's `keyMaterial` is itself an envelope produced by
 * the master-key-backed `EncryptionService`, so the database never
 * sees raw key bytes — even an attacker with full SQL read access
 * recovers ciphertext only, not usable keys.
 *
 * Why a SQL-backed local provider:
 *   - Works out-of-the-box for development, single-tenant
 *     deployments, and the unit-test suite without standing up
 *     Vault.
 *   - Uses the same Prisma client / connection pool as the rest of
 *     the API, so rotation is one ACID transaction (no two-phase
 *     coordination across services).
 *   - Lets `ReencryptProcessor` (re-encryption job) scan
 *     historical keys with a normal `findMany` rather than walking
 *     a remote API.
 *
 * Atomicity invariants:
 *   - Exactly one row has `status = 'ACTIVE'` at all times. The
 *     `createKey` transaction retires the previous active row in
 *     the same transaction as inserting the new one, so a crash in
 *     the middle of a rotation cannot leave the table with two
 *     active rows.
 *   - `rotatedToId` always points "backwards" (RETIRED → ACTIVE)
 *     so traversal is unambiguous.
 *
 * Rotation visibility:
 *   - `material` buffers returned from this provider are defensive
 *     copies. Callers may mutate / zero them without affecting
 *     subsequent lookups.
 *   - Failed unwraps (e.g. `MASTER_KEY` rotated without a
 *     re-encrypt of the EncryptionKey table) surface as
 *     `FieldEncryptionError` from the underlying service. We
 *     re-throw with a clear "key id" prefix so operators can map a
 *     SIEM alert to a specific row.
 */
@Injectable()
export class LocalKmsProvider implements KmsProvider {
  private readonly logger = new Logger(LocalKmsProvider.name);

  /**
   * AAD bound to every wrapped DEK. Pinned to a stable string so a
   * rotation of the master key (a separate concern from DEK
   * rotation) doesn't change the ciphertext shape. Future-proofing:
   * if we ever want per-tenant KEKs the AAD can grow to encode the
   * tenant id without churning the migration story.
   */
  private static readonly KEK_AAD = 'edubridge.kms.dek/v1';

  constructor(
    private readonly prisma: PrismaClient,
    /**
     * Master-key-backed encryption service used to wrap / unwrap
     * the DEK material. Injected from `CryptoModule` —
     * `SecurityModule` re-imports it.
     */
    private readonly masterEncryption: EncryptionService,
  ) {}

  // -------------------------------------------------------------------------
  // KmsProvider implementation
  // -------------------------------------------------------------------------

  async getActiveKey(): Promise<KmsKey> {
    const row = await this.prisma.encryptionKey.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      // Bootstrap on first use — no active row means the KMS table
      // has never been seeded. Lazily create one so a fresh
      // database doesn't need a separate migration step.
      this.logger.log(
        'No ACTIVE EncryptionKey row found; bootstrapping a fresh DEK.',
      );
      return this.createKey();
    }
    return this.materialise(row);
  }

  async listKeys(): Promise<KmsKey[]> {
    const rows = await this.prisma.encryptionKey.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.materialise(row));
  }

  async getKeyById(id: string): Promise<KmsKey | null> {
    const row = await this.prisma.encryptionKey.findUnique({
      where: { id },
    });
    if (!row) return null;
    return this.materialise(row);
  }

  async createKey(): Promise<KmsKey> {
    const fresh = randomBytes(32);
    const wrapped = this.wrap(fresh);

    const created = await this.prisma.$transaction(async (tx) => {
      // Retire the previous active row (if any) in the same
      // transaction so the unique-active invariant holds even if
      // two rotations race.
      const previous = await tx.encryptionKey.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });

      const inserted = await tx.encryptionKey.create({
        data: {
          keyMaterial: wrapped,
          status: 'ACTIVE',
        },
      });

      if (previous) {
        await tx.encryptionKey.update({
          where: { id: previous.id },
          data: {
            status: 'RETIRED',
            retiredAt: new Date(),
            rotatedToId: inserted.id,
          },
        });
      }

      return inserted;
    });

    this.logger.log(
      `Created new ACTIVE EncryptionKey id=${created.id} (previous active retired).`,
    );

    // Zero the freshly-generated buffer locally — the persistent
    // copy now lives wrapped in the DB; future reads materialise
    // from there.
    fresh.fill(0);

    return this.materialise(created);
  }

  async markRotated(oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return;
    const oldRow = await this.prisma.encryptionKey.findUnique({
      where: { id: oldId },
    });
    if (!oldRow) {
      this.logger.warn(
        `markRotated: old key id=${oldId} not found; treating as no-op.`,
      );
      return;
    }
    if (oldRow.status === 'RETIRED' && oldRow.rotatedToId === newId) {
      // Already linked — idempotent.
      return;
    }
    await this.prisma.encryptionKey.update({
      where: { id: oldId },
      data: {
        status: 'RETIRED',
        retiredAt: oldRow.retiredAt ?? new Date(),
        rotatedToId: newId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Materialise a Prisma row into a `KmsKey` (unwraps the key bytes). */
  private materialise(row: EncryptionKey): KmsKey {
    let material: Buffer;
    try {
      material = Buffer.from(
        this.masterEncryption.decrypt(
          row.keyMaterial,
          LocalKmsProvider.KEK_AAD,
        ),
        'base64',
      );
    } catch (err) {
      // Likely causes: master key rotated without re-wrapping rows,
      // or a tampered `keyMaterial` value in the DB. Log with the
      // key id so the SIEM alert is actionable; bubble the original
      // error so the caller's path can choose to fall back.
      const msg =
        err instanceof FieldEncryptionError
          ? `${err.code}: ${err.message}`
          : (err as Error).message;
      throw new FieldEncryptionError(
        'INVALID_AUTHENTICATION_TAG',
        `LocalKmsProvider: failed to unwrap key id=${row.id}: ${msg}`,
        err,
      );
    }
    if (material.length !== 32) {
      throw new FieldEncryptionError(
        'MASTER_KEY_INVALID',
        `LocalKmsProvider: unwrapped key id=${row.id} is ${material.length} bytes; expected 32.`,
      );
    }
    return {
      id: row.id,
      material,
      status: row.status as KmsKeyStatus,
      createdAt: row.createdAt,
      retiredAt: row.retiredAt ?? null,
      rotatedToId: row.rotatedToId ?? null,
    };
  }

  /** Wrap raw key bytes with the master key so they can be persisted. */
  private wrap(material: Buffer): string {
    return this.masterEncryption.encryptField(
      material.toString('base64'),
      LocalKmsProvider.KEK_AAD,
    );
  }
}
