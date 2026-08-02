import { Injectable, Logger } from '@nestjs/common';

import type { KmsProvider } from '../kms/kms.port';

/**
 * Result of a crypto-shredding operation.
 */
export interface CryptoShreddingResult {
  /** User ID whose keys were destroyed. */
  userId: string;
  /** Number of keys destroyed. */
  keysDestroyed: number;
  /** Timestamp of the shredding operation. */
  shreddedAt: Date;
  /** Whether the operation completed successfully. */
  success: boolean;
  /** Optional error message if the operation failed. */
  error?: string;
}

/**
 * Audit record for crypto-shredding operations.
 */
export interface ShreddingAuditEntry {
  userId: string;
  keyId: string;
  action: 'key_destroyed' | 'key_zeroed' | 'shredding_complete';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Interface for the key store that supports per-user key management.
 * This extends the base KMS provider with user-scoped operations
 * needed for crypto-shredding (GDPR right-to-erasure).
 */
export interface UserKeyStore {
  /**
   * Retrieve all encryption key IDs associated with a specific user.
   * These are the per-user DEKs used to encrypt that user's PII.
   */
  getKeyIdsForUser(userId: string): Promise<string[]>;

  /**
   * Permanently destroy a key by its ID. After this call, any data
   * encrypted with this key is irrecoverable. The implementation
   * MUST:
   *   - Zero the key material in memory.
   *   - Delete or overwrite the key material in persistent storage.
   *   - Ensure the operation is not reversible.
   */
  destroyKey(keyId: string): Promise<void>;

  /**
   * Record an audit entry for the shredding operation.
   * Compliance requires a tamper-evident log of key destruction.
   */
  recordAudit(entry: ShreddingAuditEntry): Promise<void>;
}

/**
 * Token for injecting the UserKeyStore implementation.
 */
export const USER_KEY_STORE = Symbol('USER_KEY_STORE');

/**
 * `CryptoShreddingService` — Task 28.3, Requirement 28.7.
 *
 * Implements the crypto-shredding pattern for GDPR right-to-erasure
 * compliance. When a user requests deletion of their data, instead
 * of (or in addition to) physically deleting every encrypted record,
 * we destroy the encryption keys that protect that user's data.
 *
 * This makes all encrypted PII for that user permanently
 * unrecoverable — even if the ciphertext remains in backups or
 * replicas, it can never be decrypted again.
 *
 * Flow:
 *   1. User requests account deletion.
 *   2. System identifies all encryption keys scoped to that user.
 *   3. Each key's material is securely zeroed and the key record
 *      is permanently deleted from the key store.
 *   4. An immutable audit trail records the destruction event.
 *   5. The encrypted data becomes cryptographically inaccessible.
 *
 * This service is intentionally decoupled from the global KMS
 * rotation keys — per-user DEKs are a separate concept from the
 * system-wide column-encryption keys managed by `KeyManagementService`.
 */
@Injectable()
export class CryptoShreddingService {
  private readonly logger = new Logger(CryptoShreddingService.name);

  constructor(private readonly keyStore: UserKeyStore) {}

  /**
   * Execute crypto-shredding for a user. Destroys all encryption
   * keys associated with the given user ID, rendering their
   * encrypted data permanently unrecoverable.
   *
   * This operation is IRREVERSIBLE. Callers must ensure proper
   * authorization and confirmation before invoking.
   */
  async shredUserData(userId: string): Promise<CryptoShreddingResult> {
    const startTime = Date.now();

    try {
      this.logger.warn(
        `Initiating crypto-shredding for user: ${userId.slice(0, 8)}***`,
      );

      // 1. Retrieve all key IDs for this user.
      const keyIds = await this.keyStore.getKeyIdsForUser(userId);

      if (keyIds.length === 0) {
        this.logger.log(
          `No encryption keys found for user ${userId.slice(0, 8)}***; shredding is a no-op.`,
        );
        return {
          userId,
          keysDestroyed: 0,
          shreddedAt: new Date(),
          success: true,
        };
      }

      this.logger.log(
        `Found ${keyIds.length} key(s) for user ${userId.slice(0, 8)}***; destroying.`,
      );

      // 2. Destroy each key and record audit entries.
      let destroyedCount = 0;

      for (const keyId of keyIds) {
        await this.destroyKeyWithAudit(userId, keyId);
        destroyedCount++;
      }

      // 3. Record the completion audit entry.
      await this.keyStore.recordAudit({
        userId,
        keyId: 'ALL',
        action: 'shredding_complete',
        timestamp: new Date(),
        metadata: {
          keysDestroyed: destroyedCount,
          durationMs: Date.now() - startTime,
        },
      });

      this.logger.log(
        `Crypto-shredding complete for user ${userId.slice(0, 8)}***: ${destroyedCount} key(s) destroyed in ${Date.now() - startTime}ms.`,
      );

      return {
        userId,
        keysDestroyed: destroyedCount,
        shreddedAt: new Date(),
        success: true,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Crypto-shredding FAILED for user ${userId.slice(0, 8)}***: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        userId,
        keysDestroyed: 0,
        shreddedAt: new Date(),
        success: false,
        error: message,
      };
    }
  }

  /**
   * Verify that crypto-shredding was successful for a user.
   * Returns true if no keys remain for the given user.
   */
  async verifyShreddingComplete(userId: string): Promise<boolean> {
    const remainingKeys = await this.keyStore.getKeyIdsForUser(userId);
    return remainingKeys.length === 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Destroy a single key and record the audit trail.
   */
  private async destroyKeyWithAudit(
    userId: string,
    keyId: string,
  ): Promise<void> {
    // Record the destruction intent before actually destroying.
    await this.keyStore.recordAudit({
      userId,
      keyId,
      action: 'key_zeroed',
      timestamp: new Date(),
    });

    // Permanently destroy the key material.
    await this.keyStore.destroyKey(keyId);

    // Record successful destruction.
    await this.keyStore.recordAudit({
      userId,
      keyId,
      action: 'key_destroyed',
      timestamp: new Date(),
    });
  }
}
