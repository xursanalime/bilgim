import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AUDIT_STORAGE,
  type AuditEntry,
  type AuditStoragePort,
} from './audit-storage.port';

/**
 * Input DTO for recording an audit event.
 */
export interface AuditEventInput {
  /** User who performed the action. */
  userId: string;
  /** Action identifier (e.g., 'user.login', 'admin.role_change'). */
  action: string;
  /** Client IP address. */
  ip: string;
  /** Device/user-agent string. */
  device: string;
  /** Arbitrary context (reason, affected resource, metadata). */
  context?: Record<string, unknown>;
}

/**
 * Result of an integrity verification run.
 */
export interface VerificationResult {
  /** Whether the entire chain is intact. */
  valid: boolean;
  /** Total entries checked. */
  totalEntries: number;
  /** Number of entries that passed hash verification. */
  validEntries: number;
  /** First broken entry (if any). */
  brokenAt?: {
    id: string;
    index: number;
    expectedHash: string;
    actualHash: string;
  };
}

/**
 * `AuditTrailService` — Task 30.3, Requirements 32.3 / 32.4.
 *
 * Provides tamper-proof audit logging with cryptographic hash
 * chaining. Each entry's `currentHash` is computed as:
 *
 *   SHA-256(id + userId + action + timestamp + ip + device + JSON(context) + prevHash)
 *
 * The `prevHash` of each entry equals the `currentHash` of the
 * preceding entry, forming an append-only chain similar to a
 * blockchain. Any modification to a historical entry breaks the
 * chain from that point forward, making tampering detectable.
 *
 * Genesis entry uses '0'.repeat(64) as its `prevHash`.
 *
 * The service is injectable — other modules call `record()` to log
 * sensitive operations (login, logout, permission changes, data
 * access, payment, admin actions).
 */
@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  /** Genesis prevHash — 64 zeros (SHA-256 output length in hex). */
  static readonly GENESIS_HASH = '0'.repeat(64);

  constructor(
    @Inject(AUDIT_STORAGE)
    private readonly storage: AuditStoragePort,
  ) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Record a sensitive operation in the audit trail.
   *
   * The entry is hash-chained to the previous entry, ensuring
   * append-only integrity. Concurrent calls are serialized by the
   * database's unique constraint on `currentHash` — a collision
   * (two entries claiming the same prevHash) will fail one writer,
   * which retries with the updated head.
   */
  async record(input: AuditEventInput): Promise<AuditEntry> {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const context = input.context ?? {};

    // Fetch the current chain head to get prevHash.
    const latest = await this.storage.findLatest();
    const prevHash = latest?.currentHash ?? AuditTrailService.GENESIS_HASH;

    // Compute the cryptographic hash for this entry.
    const currentHash = AuditTrailService.computeHash({
      id,
      userId: input.userId,
      action: input.action,
      timestamp,
      ip: input.ip,
      device: input.device,
      context,
      prevHash,
    });

    const entry: AuditEntry = {
      id,
      userId: input.userId,
      action: input.action,
      timestamp,
      ip: input.ip,
      device: input.device,
      context,
      prevHash,
      currentHash,
    };

    await this.storage.append(entry);

    this.logger.log(
      `Audit entry recorded: ${input.action} by ${input.userId} [${currentHash.slice(0, 8)}…]`,
    );

    return entry;
  }

  /**
   * Verify the integrity of the entire audit chain.
   *
   * Walks entries from oldest to newest, recomputing each entry's
   * hash and verifying it matches the stored `currentHash`. Also
   * verifies that each entry's `prevHash` matches the preceding
   * entry's `currentHash`.
   *
   * Returns a structured result indicating whether the chain is
   * intact or where the first break occurred.
   */
  async verifyIntegrity(): Promise<VerificationResult> {
    const totalEntries = await this.storage.count();

    if (totalEntries === 0) {
      return { valid: true, totalEntries: 0, validEntries: 0 };
    }

    // Process in batches to avoid loading the entire log into memory.
    const batchSize = 1000;
    let validEntries = 0;
    let previousHash = AuditTrailService.GENESIS_HASH;

    for (let offset = 0; offset < totalEntries; offset += batchSize) {
      const batch = await this.storage.findAll(offset, batchSize);

      for (const entry of batch) {
        // 1. Verify prevHash linkage.
        if (entry.prevHash !== previousHash) {
          return {
            valid: false,
            totalEntries,
            validEntries,
            brokenAt: {
              id: entry.id,
              index: validEntries,
              expectedHash: previousHash,
              actualHash: entry.prevHash,
            },
          };
        }

        // 2. Recompute and verify currentHash.
        const recomputed = AuditTrailService.computeHash({
          id: entry.id,
          userId: entry.userId,
          action: entry.action,
          timestamp: entry.timestamp,
          ip: entry.ip,
          device: entry.device,
          context: entry.context,
          prevHash: entry.prevHash,
        });

        if (recomputed !== entry.currentHash) {
          return {
            valid: false,
            totalEntries,
            validEntries,
            brokenAt: {
              id: entry.id,
              index: validEntries,
              expectedHash: recomputed,
              actualHash: entry.currentHash,
            },
          };
        }

        previousHash = entry.currentHash;
        validEntries++;
      }
    }

    return { valid: true, totalEntries, validEntries };
  }

  /**
   * Retrieve recent audit entries (newest-first).
   */
  async getRecent(limit = 50): Promise<AuditEntry[]> {
    return this.storage.findRecent(limit);
  }

  // =====================================================================
  // Static helpers (exposed for testing)
  // =====================================================================

  /**
   * Compute the SHA-256 hash for an audit entry.
   *
   * Formula: SHA-256(id + userId + action + timestamp + ip + device + JSON(context) + prevHash)
   */
  static computeHash(params: {
    id: string;
    userId: string;
    action: string;
    timestamp: string;
    ip: string;
    device: string;
    context: Record<string, unknown>;
    prevHash: string;
  }): string {
    const payload =
      params.id +
      params.userId +
      params.action +
      params.timestamp +
      params.ip +
      params.device +
      JSON.stringify(params.context) +
      params.prevHash;

    return createHash('sha256').update(payload).digest('hex');
  }
}
