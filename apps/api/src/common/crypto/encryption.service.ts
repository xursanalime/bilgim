import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  EncryptionKeyManager,
  ACTIVE_KEY_VERSION,
} from './encryption-key-manager';
import { EncryptionError } from './encryption.errors';

// ---------------------------------------------------------------------------
// Constants — change these and you change the wire format.
// ---------------------------------------------------------------------------

/** AES-256-GCM (256-bit key, 96-bit IV, 128-bit tag). */
const ALGO = 'aes-256-gcm' as const;

/** 32 bytes = 256 bits. AES-256 keys are exactly this size. */
const KEY_BYTES = 32;

/**
 * 12 bytes = 96 bits — the NIST SP 800-38D "recommended" IV length
 * for GCM. Using the recommended length lets us use the simple
 * internal IV-construction (raw 96-bit nonce) and keeps the auth tag
 * at its cryptographic optimum.
 */
const IV_BYTES = 12;

/**
 * 16 bytes = 128 bits — the GCM authentication tag length. We pin the
 * tag to the maximum size so a partial auth-tag truncation can't be
 * smuggled past the verifier.
 */
const TAG_BYTES = 16;

/**
 * Current envelope version. Re-exported as the value of
 * {@link CURRENT_ENVELOPE_VERSION} for legacy callers; the canonical
 * source of truth is `EncryptionKeyManager.getActiveVersion()` since
 * future rotations may push the active version forward without
 * touching this file.
 */
export const CURRENT_ENVELOPE_VERSION = ACTIVE_KEY_VERSION;

/** Injection token for the `EncryptionKeyManager`. */
export const ENCRYPTION_KEY_MANAGER_TOKEN = Symbol(
  'ENCRYPTION_KEY_MANAGER',
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * `EncryptionService` — at-rest field encryption using AES-256-GCM
 * with a versioned envelope format and AAD-based context binding.
 *
 * Wire format (single base64 string):
 *
 *     base64URL-decoded payload = `<version>.<iv>.<ciphertext>.<authTag>`
 *
 * where each segment is itself base64-encoded. Concretely the value
 * stored at rest looks like:
 *
 *     v1.<base64(iv)>.<base64(ciphertext)>.<base64(authTag)>
 *
 *   - `v1`         — fixed envelope version. The version is read from
 *                    `EncryptionKeyManager.getActiveVersion()` on
 *                    every encrypt and resolved through
 *                    `getKey(version)` on every decrypt, so a
 *                    rotation at the manager layer flips both sides
 *                    atomically.
 *   - `iv`         — 12 random bytes per encryption. Never reused.
 *   - `ciphertext` — AES-256-GCM ciphertext. Empty plaintexts produce
 *                    empty ciphertexts (still authenticated by the
 *                    tag) so callers can distinguish "encrypted empty
 *                    string" from `null`.
 *   - `authTag`    — 16-byte GCM authentication tag. Tampering or
 *                    using a wrong AAD throws
 *                    `EncryptionError(code='INVALID_AUTHENTICATION_TAG')`.
 *
 * The `.` separator is safe because base64 doesn't contain `.`, and
 * the version prefix lets us distinguish ciphertext from random
 * legacy plaintext when migrating an existing column in-place.
 *
 * **AAD (associated authenticated data).** Both `encrypt()` and
 * `decrypt()` take an optional `aad` string. When provided, the
 * value is bound into the GCM auth tag — decryption with a different
 * `aad` (or none at all) raises `INVALID_AUTHENTICATION_TAG`. This
 * is how callers tie a ciphertext to a context such as a user-id or
 * a tenant-id without needing a separate per-context key. The AAD is
 * **not** stored in the envelope: callers must supply the same value
 * on both sides.
 *
 * Requirements: 21.8 (User.phone field-level encryption), 28.1, 28.3.
 */
@Injectable()
export class EncryptionService {
  private readonly randomBytesFn: (size: number) => Buffer;

  constructor(
    @Inject(ENCRYPTION_KEY_MANAGER_TOKEN)
    private readonly keyManager: EncryptionKeyManager,
    /**
     * Test seam — never use a deterministic generator in production.
     * The default reads from Node's CSPRNG.
     */
    @Optional() randomBytesFn?: (size: number) => Buffer,
  ) {
    if (!keyManager) {
      // Defensive guard: Nest will normally satisfy the injection
      // through `EncryptionModule`, but tests sometimes new the
      // service up directly with the wrong arity.
      throw new EncryptionError(
        'MASTER_KEY_MISSING',
        'EncryptionService requires an EncryptionKeyManager instance.',
      );
    }
    this.randomBytesFn = randomBytesFn ?? randomBytes;
  }

  /**
   * Encrypt `plaintext` with AES-256-GCM. Returns the versioned
   * envelope string described above.
   *
   * Empty plaintexts ARE supported — the result is a non-empty
   * envelope (the version + IV + tag are always present) so
   * consumers can distinguish "encrypted empty string" from `null`
   * / "missing field". This is important for round-tripping nullable
   * PII columns where `null` and `""` mean different things.
   *
   * The optional `aad` argument is passed through to GCM as
   * associated authenticated data. Two encryptions of the same
   * plaintext with different `aad` values will both decrypt
   * correctly — but only when the caller supplies the *matching*
   * `aad` on the decrypt side. Mixing them up raises
   * `INVALID_AUTHENTICATION_TAG`.
   */
  encrypt(plaintext: string, aad?: string): string {
    if (typeof plaintext !== 'string') {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        'EncryptionService.encrypt requires a string plaintext.',
      );
    }

    const version = this.keyManager.getActiveVersion();
    const key = this.keyManager.getActiveKey();
    if (key.length !== KEY_BYTES) {
      throw new EncryptionError(
        'MASTER_KEY_INVALID',
        `Active key must be ${KEY_BYTES} bytes; got ${key.length}.`,
      );
    }

    const iv = this.randomBytesFn(IV_BYTES);
    if (iv.length !== IV_BYTES) {
      // Custom random sources can return the wrong length — refuse
      // to proceed rather than emit a malformed envelope.
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        `Random IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
      );
    }

    const cipher = createCipheriv(ALGO, key, iv, {
      authTagLength: TAG_BYTES,
    });
    if (typeof aad === 'string' && aad.length > 0) {
      cipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      version,
      iv.toString('base64'),
      ciphertext.toString('base64'),
      authTag.toString('base64'),
    ].join('.');
  }

  /**
   * Decrypt a versioned envelope back into UTF-8 plaintext.
   *
   * Throws `EncryptionError`:
   *   - `ENVELOPE_MALFORMED`         — wrong segment count, bad
   *                                    base64, wrong IV / tag length,
   *                                    non-string input.
   *   - `UNSUPPORTED_VERSION`        — version prefix isn't known to
   *                                    the current key manager.
   *   - `INVALID_AUTHENTICATION_TAG` — auth-tag mismatch (wrong key,
   *                                    wrong `aad`, or tampered
   *                                    ciphertext).
   *
   * The auth-tag check uses `crypto.createDecipheriv`'s built-in
   * verification, which itself uses constant-time comparison.
   */
  decrypt(envelope: string, aad?: string): string {
    if (typeof envelope !== 'string' || envelope.length === 0) {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        'EncryptionService.decrypt requires a non-empty envelope string.',
      );
    }

    const parts = envelope.split('.');
    if (parts.length !== 4) {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        `Envelope must have 4 dot-separated segments; got ${parts.length}.`,
      );
    }

    const [version, ivB64, ctB64, tagB64] = parts;
    if (
      typeof version !== 'string' ||
      version.length === 0 ||
      typeof ivB64 !== 'string' ||
      typeof ctB64 !== 'string' ||
      typeof tagB64 !== 'string'
    ) {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        'Envelope segments must all be non-empty strings.',
      );
    }

    // Resolve the key for the embedded version. Unknown versions
    // surface as `UNSUPPORTED_VERSION` (raised by the manager).
    const key = this.keyManager.getKey(version);

    let iv: Buffer;
    let ciphertext: Buffer;
    let authTag: Buffer;
    try {
      iv = Buffer.from(ivB64, 'base64');
      ciphertext = Buffer.from(ctB64, 'base64');
      authTag = Buffer.from(tagB64, 'base64');
    } catch (err) {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        'Failed to base64-decode envelope segments.',
        err,
      );
    }

    if (iv.length !== IV_BYTES) {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        `IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
      );
    }
    if (authTag.length !== TAG_BYTES) {
      throw new EncryptionError(
        'ENVELOPE_MALFORMED',
        `Auth tag must be ${TAG_BYTES} bytes; got ${authTag.length}.`,
      );
    }

    const decipher = createDecipheriv(ALGO, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(authTag);
    if (typeof aad === 'string' && aad.length > 0) {
      decipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    try {
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch (err) {
      // Auth-tag verification failure surfaces here. We deliberately
      // swallow the underlying `Error` message ("Unsupported state
      // or unable to authenticate data") so attackers can't
      // distinguish tag mismatch from key/aad mismatch via the
      // error string.
      throw new EncryptionError(
        'INVALID_AUTHENTICATION_TAG',
        'Decryption failed: authentication tag mismatch, wrong key, or wrong aad.',
        err,
      );
    }
  }

  /**
   * Heuristic — quickly check whether a string looks like a versioned
   * envelope. Used by the Prisma extension's read-side to safely
   * "decrypt-if-encrypted" during the rollout window when a column
   * may contain a mix of plaintext (legacy) and encrypted (new) rows.
   *
   * Cheap regex match; never throws. Returning `true` does NOT mean
   * decryption will succeed — it only means the value is structurally
   * shaped like an envelope.
   */
  isEnvelope(candidate: string | null | undefined): candidate is string {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    // `v\d+.<base64>.<base64>.<base64>` — base64 chars are
    // [A-Za-z0-9+/=]. We require non-empty segments for IV and tag
    // (those two are never empty), but tolerate an empty ciphertext
    // segment (encrypted empty string).
    return /^v\d+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]*\.[A-Za-z0-9+/=]+$/.test(
      candidate,
    );
  }
}
