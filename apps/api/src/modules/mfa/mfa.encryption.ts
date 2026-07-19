import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * AES-256-GCM column-level encryption for MFA secrets (Task 29.1).
 *
 * Stores TOTP shared secrets and WebAuthn public keys in the database
 * encrypted at rest. The encrypted blob format is:
 *
 *     base64(iv || authTag || ciphertext)
 *
 * Where `iv` is 12 bytes (GCM nonce), `authTag` is 16 bytes (GCM MAC).
 * That layout lets us round-trip a single string column without a
 * separate IV / tag column, while still rejecting any tampering at
 * `decrypt()` time (GCM verifies the auth tag as part of the
 * `final()` call).
 *
 * The class deliberately mirrors the public surface we expect the
 * future shared `EncryptionService` (Task 28.1) to expose so the MFA
 * module can swap to it without code churn — when 28.1 lands, this
 * file can be deleted and `MfaEncryption` becomes a thin wrapper /
 * alias.
 *
 * Key resolution rules:
 *   * `MFA_ENCRYPTION_KEY` env var (any length string; SHA-256 is
 *     applied to derive a 32-byte key) — production / staging.
 *   * Stable dev fallback (`mfa-encryption-key-development-only`) so
 *     local + test environments work without configuration. The
 *     fallback is logged at WARN level on first use so a misconfigured
 *     production deploy is loud.
 */
@Injectable()
export class MfaEncryption {
  private readonly logger = new Logger(MfaEncryption.name);

  /** Algorithm identifier — pinned to AES-256-GCM. */
  static readonly ALGORITHM = 'aes-256-gcm' as const;
  /** GCM nonce length in bytes (NIST SP 800-38D §8.2.1 recommended). */
  static readonly IV_LENGTH = 12;
  /** GCM authentication tag length in bytes. */
  static readonly TAG_LENGTH = 16;

  private readonly key: Buffer;
  private readonly usingFallback: boolean;

  constructor(configService?: ConfigService) {
    const configured = configService?.get<string>('MFA_ENCRYPTION_KEY');
    if (configured && configured.length >= 16) {
      this.key = MfaEncryption.deriveKey(configured);
      this.usingFallback = false;
    } else {
      this.key = MfaEncryption.deriveKey(
        'mfa-encryption-key-development-only',
      );
      this.usingFallback = true;
    }
  }

  /**
   * Encrypt a plaintext string and return the base64-encoded blob.
   * The result is safe to store in a TEXT/CITEXT column.
   */
  encrypt(plaintext: string): string {
    if (this.usingFallback) {
      this.logger.warn(
        'MfaEncryption: using development fallback key — set MFA_ENCRYPTION_KEY in non-dev environments',
      );
    }
    const iv = randomBytes(MfaEncryption.IV_LENGTH);
    const cipher = createCipheriv(MfaEncryption.ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  /**
   * Decrypt a value previously produced by `encrypt()`. Throws if the
   * blob has been tampered with (GCM auth-tag check fails).
   */
  decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    if (
      buf.length <
      MfaEncryption.IV_LENGTH + MfaEncryption.TAG_LENGTH + 1
    ) {
      throw new Error('MfaEncryption.decrypt: ciphertext too short');
    }
    const iv = buf.subarray(0, MfaEncryption.IV_LENGTH);
    const authTag = buf.subarray(
      MfaEncryption.IV_LENGTH,
      MfaEncryption.IV_LENGTH + MfaEncryption.TAG_LENGTH,
    );
    const ciphertext = buf.subarray(
      MfaEncryption.IV_LENGTH + MfaEncryption.TAG_LENGTH,
    );
    const decipher = createDecipheriv(MfaEncryption.ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Derive a 32-byte key from a string secret via SHA-256. Any length
   * input is accepted; production deployments should still pass a
   * high-entropy value (≥32 random bytes).
   */
  static deriveKey(secret: string): Buffer {
    return createHash('sha256').update(secret, 'utf8').digest();
  }
}
