/**
 * Typed error classes for the encryption subsystem (Task 28.1).
 *
 * All failures from `EncryptionService` and the Prisma encryption
 * extension surface as `EncryptionError` so callers can branch on the
 * stable `code` field rather than fragile error-message matching.
 *
 * Codes:
 *   - `MASTER_KEY_MISSING`        — `MASTER_ENCRYPTION_KEY` env var is
 *                                   unset and we are in production
 *                                   (dev/test fall back to a known dev
 *                                   key, see `EncryptionKeyManager`).
 *   - `MASTER_KEY_INVALID`        — env var present but does not decode
 *                                   to exactly 32 bytes.
 *   - `ENVELOPE_MALFORMED`        — ciphertext envelope failed
 *                                   structural parsing (wrong segment
 *                                   count, bad base64, wrong IV / tag
 *                                   length, non-string plaintext).
 *   - `UNSUPPORTED_VERSION`       — envelope version isn't recognised
 *                                   by the current binary (e.g. a
 *                                   future `v2.` payload, or a key
 *                                   version `EncryptionKeyManager`
 *                                   does not know).
 *   - `INVALID_AUTHENTICATION_TAG`— GCM auth-tag verification failed.
 *                                   Indicates tampering, wrong key,
 *                                   or wrong `aad`. Distinct code so
 *                                   callers can decide whether to
 *                                   retry with a rotated key or
 *                                   surface a hard error.
 */
export type EncryptionErrorCode =
  | 'MASTER_KEY_MISSING'
  | 'MASTER_KEY_INVALID'
  | 'ENVELOPE_MALFORMED'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_AUTHENTICATION_TAG';

/**
 * Single concrete error class — keeps `instanceof EncryptionError`
 * cheap and deterministic for both production and test code.
 *
 * `cause` is preserved when a lower-level `crypto` error triggered
 * the failure so observability can drill in without leaking sensitive
 * material.
 */
export class EncryptionError extends Error {
  public readonly code: EncryptionErrorCode;

  constructor(code: EncryptionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'EncryptionError';
    this.code = code;
    if (cause !== undefined) {
      // `Error.cause` is the standard since ES2022; fall back to a
      // direct property assignment for older Node ABIs.
      (this as { cause?: unknown }).cause = cause;
    }
    // Restore prototype chain for `instanceof` after target=es5 transpile.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
