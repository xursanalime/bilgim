/**
 * Typed errors for the application-layer field-encryption service
 * (Task 28.1).
 *
 * All failures surface as `FieldEncryptionError` so callers can branch
 * on the stable `code` field rather than fragile message matching. The
 * shape mirrors the existing `EncryptionError` in `common/crypto/` but
 * lives in its own namespace so the two services can evolve
 * independently — `common/crypto/` is the legacy column-level
 * envelope (Prisma extension), while `common/security/encryption/` is
 * the spec-aligned field-level service consumed by the wider
 * application code (audit logs, secrets, MFA wrap keys, etc.).
 *
 * Codes:
 *   - `MASTER_KEY_MISSING`         — `MASTER_KEY` env var is unset and
 *                                    we are running under
 *                                    `NODE_ENV=production`. Refusing
 *                                    to start is a hard requirement of
 *                                    Task 28.1.
 *   - `MASTER_KEY_INVALID`         — `MASTER_KEY` is present but is
 *                                    not a hex string of exactly 64
 *                                    chars (i.e. 32 bytes).
 *   - `ENVELOPE_MALFORMED`         — blob string failed structural
 *                                    parsing (bad version prefix,
 *                                    wrong number of segments, bad
 *                                    base64, wrong IV / tag length).
 *   - `UNSUPPORTED_VERSION`        — version prefix is well-formed but
 *                                    is unknown to the current binary
 *                                    (a future `v2.` blob, or a
 *                                    `keyId` we don't have a key for).
 *   - `INVALID_AUTHENTICATION_TAG` — GCM auth-tag verification failed.
 *                                    Indicates tampering, the wrong
 *                                    key, or a mismatched AAD (wrong
 *                                    `fieldName` on `decryptField`).
 *   - `AAD_MISMATCH`               — the AAD bound at encrypt time
 *                                    does not equal the value supplied
 *                                    at decrypt time. Surfaced as a
 *                                    distinct code (in addition to the
 *                                    underlying auth-tag failure)
 *                                    purely so tests can assert on it
 *                                    explicitly; production code will
 *                                    typically branch on either.
 */
export type FieldEncryptionErrorCode =
  | 'MASTER_KEY_MISSING'
  | 'MASTER_KEY_INVALID'
  | 'ENVELOPE_MALFORMED'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_AUTHENTICATION_TAG'
  | 'AAD_MISMATCH';

/**
 * Single concrete error class for the field-encryption service. Using
 * one class keeps `instanceof FieldEncryptionError` cheap and stable;
 * the discriminator lives in `code`.
 *
 * `cause` is forwarded when a lower-level `node:crypto` error triggers
 * the failure so observability can drill in without leaking sensitive
 * material into the user-facing message.
 */
export class FieldEncryptionError extends Error {
  public readonly code: FieldEncryptionErrorCode;

  constructor(
    code: FieldEncryptionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'FieldEncryptionError';
    this.code = code;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
    // Restore prototype chain for `instanceof` after target=es5 transpile.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
