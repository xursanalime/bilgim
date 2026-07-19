/**
 * Field-level AES-256-GCM encryption service (Task 28.1).
 *
 * ## Why GCM and not CBC
 * AES-CBC is unauthenticated — a ciphertext can be tampered with and
 * the decrypt side cannot detect the change without a separate MAC
 * (HMAC-SHA256, etc.). Layering CBC + HMAC manually is famously easy
 * to misconfigure (encrypt-then-MAC vs MAC-then-encrypt, padding
 * oracle attacks against decryption error paths, missing
 * constant-time tag compare, …). AES-GCM bundles confidentiality and
 * authenticity into a single primitive — the 128-bit auth tag is
 * verified during `decipher.final()` and a mismatched tag throws
 * before any plaintext is returned. This is exactly the property
 * Property 19 in the design doc relies on: tampering with any byte of
 * the ciphertext, IV, or tag fails decrypt.
 *
 * ## Why a 96-bit IV
 * NIST SP 800-38D §8.2.1 recommends a 96-bit (12-byte) IV for AES-GCM
 * because the GCM internal IV-construction handles that length
 * directly without an extra GHASH pass. Longer IVs require GHASH
 * compression (slower, fewer hardware accelerations) and shorter IVs
 * shrink the random-IV birthday bound. For a fully random 96-bit IV
 * the safe encryption count under one key is ~2^32 messages before
 * the collision probability becomes non-negligible — well in excess
 * of any column we'll ever encrypt and within the rotation window of
 * Task 28.2.
 *
 * ## Wire format
 * The encrypted envelope is a single string:
 *
 *     v1:<iv>:<tag>:<ciphertext>
 *
 *   - `v1`         — version prefix. New formats add `v2:` etc and
 *                    the decrypt path branches on the prefix so old
 *                    rows still round-trip after a rollout.
 *   - `<iv>`       — 12 random bytes, base64url-encoded.
 *   - `<tag>`      — 16-byte GCM auth tag, base64url-encoded.
 *   - `<ciphertext>` — AES-256-GCM ciphertext, base64url-encoded.
 *                      Empty plaintext yields an empty ciphertext
 *                      segment (still authenticated by the tag) so
 *                      callers can distinguish "encrypted empty
 *                      string" from `null`.
 *
 * `:` is safe as a separator — it's not in the base64url alphabet
 * (`A-Z`, `a-z`, `0-9`, `-`, `_`, plus `=` padding which we strip).
 * base64url instead of base64 keeps envelopes safe to drop into URL
 * paths, JWT-style headers, or filenames without further escaping.
 *
 * ## Key rotation
 * The active key version is part of the envelope (`v1` today). When
 * Task 28.2 lands, the key manager will resolve the version to a
 * historical key buffer so rows written under `v1` remain readable
 * after `v2` becomes the active write version. This file owns the
 * GCM primitives only — the rotation strategy (Vault / KMS, 90-day
 * cadence, zero-downtime re-encrypt) lives in `key-management.service.ts`
 * (Task 28.2). Today there is exactly one key version; the boot
 * guard ensures it is present and exactly 32 bytes before the
 * service is constructed.
 *
 * ## AAD (associated authenticated data)
 * Both `encrypt()` and `decrypt()` take an optional `aad` argument.
 * When supplied, the value is bound into the GCM auth tag — a
 * decrypt with a different `aad` (or none at all) raises a typed
 * error. Use this to bind a ciphertext to a context such as a user
 * id so that an attacker who manages to swap one user's encrypted
 * phone number into another row's column cannot get a valid
 * plaintext back. The AAD itself is NOT stored in the envelope:
 * callers must supply the same value on both sides.
 *
 * ## Error semantics
 * Every failure path raises a plain `Error`. The encrypted format is
 * a single deterministic shape so error messages are stable strings
 * (`"ENCRYPTION_KEY missing"`, `"unsupported envelope version"`,
 * `"authentication tag mismatch"`, …) suitable for assertion in
 * tests. We deliberately do NOT leak the underlying `node:crypto`
 * error string for tag failures — an attacker who can distinguish
 * tag mismatch from key mismatch from AAD mismatch can drive an
 * oracle attack against the decrypt side.
 *
 * Validates: Requirements 28.1, 28.3 (Property 19).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

import type { EncryptedField } from './types';

// ---------------------------------------------------------------------------
// Constants — pinning these is part of the wire format.
// ---------------------------------------------------------------------------

/** AES-256-GCM (256-bit key, 96-bit IV, 128-bit tag). */
const ALGO = 'aes-256-gcm' as const;

/** AES-256 keys are exactly 32 bytes (256 bits). */
const KEY_BYTES = 32;

/**
 * 12 bytes (96 bits) — the NIST SP 800-38D recommended IV length for
 * GCM. See the file-level JSDoc for the rationale.
 */
const IV_BYTES = 12;

/**
 * 16 bytes (128 bits) — full GCM authentication tag length. Pinning
 * to the maximum supported size prevents partial-tag truncation
 * attacks.
 */
const TAG_BYTES = 16;

/**
 * Current envelope version. `decrypt()` refuses anything else.
 * Future formats add new prefixes (`v2:`, …) and the decrypt path
 * branches on the prefix so historical rows continue to round-trip.
 */
export const ENVELOPE_VERSION = 'v1' as const;

/** Name of the env var that carries the master key. */
export const ENCRYPTION_KEY_ENV_VAR = 'ENCRYPTION_KEY' as const;

// ---------------------------------------------------------------------------
// Boot-time key validation
// ---------------------------------------------------------------------------

/**
 * Decode an `ENCRYPTION_KEY` env value into a 32-byte `Buffer`, or
 * throw a deterministic error if the value is missing / wrong length
 * / not hex.
 *
 * Accepted format:
 *   - Hex string of exactly 64 characters (32 bytes). Generate with:
 *     `openssl rand -hex 32`.
 *
 * The boot wrapper (`AppConfigModule.validate(...)` →
 * `envSchema.safeParse(...)`) already enforces the format with Zod
 * before this runs, but this function is exported separately so
 * tests can drive the failure modes without needing the whole DI
 * graph and so a defensive check stays close to the consumer.
 */
export function decodeEncryptionKey(rawValue: string | undefined): Buffer {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV_VAR} is required: set a 32-byte hex value (generate with \`openssl rand -hex 32\`).`,
    );
  }

  const trimmed = rawValue.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV_VAR} must be hex-encoded (base16). Generate with \`openssl rand -hex 32\`.`,
    );
  }
  if (trimmed.length !== KEY_BYTES * 2) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV_VAR} must decode to exactly ${KEY_BYTES} bytes ` +
        `(${KEY_BYTES * 2} hex chars); got ${trimmed.length} chars.`,
    );
  }

  return Buffer.from(trimmed, 'hex');
}

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

/** Encode a buffer as unpadded base64url. */
function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Decode a base64url segment back to a `Buffer`. Throws a stable
 * error message when the input contains characters outside the
 * base64url alphabet — `Buffer.from(..., 'base64url')` silently
 * tolerates garbage and produces a truncated result, which would
 * mask a tampered envelope as a malformed-segment failure rather
 * than the auth-tag failure callers expect.
 */
function fromBase64Url(segment: string, what: string): Buffer {
  // base64url alphabet plus an optional `=` pad we accept on input
  // even though we never emit it.
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(segment)) {
    throw new Error(`malformed envelope: ${what} is not valid base64url`);
  }
  return Buffer.from(segment, 'base64url');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * `EncryptionService` — encrypts and decrypts UTF-8 strings with
 * AES-256-GCM. See the file-level JSDoc for format, rationale, and
 * rotation strategy.
 *
 * The service is intentionally framework-agnostic — it does not
 * import from `@nestjs/*` so it can be reused from BullMQ workers,
 * scripts, and tests without a Nest container. Wiring into a Nest
 * module is one line of provider registration.
 */
export class EncryptionService {
  private readonly key: Buffer;
  private readonly randomIv: () => Buffer;

  /**
   * @param key       32-byte master key. Pass the result of
   *                  {@link decodeEncryptionKey} or a `Buffer.from(hex, 'hex')`
   *                  with a length-32 hex string.
   * @param randomIv  Test-only seam — replace with a deterministic
   *                  generator from a unit test to assert specific
   *                  IVs. Production always uses
   *                  `crypto.randomBytes(12)`.
   */
  constructor(key: Buffer, randomIv?: () => Buffer) {
    if (!Buffer.isBuffer(key)) {
      throw new Error('EncryptionService: key must be a Buffer.');
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `EncryptionService: key must be exactly ${KEY_BYTES} bytes; got ${key.length}.`,
      );
    }
    // Defensive copy so a caller mutating the source buffer can't
    // perturb subsequent encryptions.
    this.key = Buffer.from(key);
    this.randomIv = randomIv ?? (() => randomBytes(IV_BYTES));
  }

  /**
   * Construct a service from `process.env.ENCRYPTION_KEY`. Use this
   * factory at module bootstrap so the boot guard fires before any
   * controller is wired.
   *
   * @param env  Optional override (defaults to `process.env`). Tests
   *             pass a fresh object to avoid touching real env state.
   */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): EncryptionService {
    const key = decodeEncryptionKey(env[ENCRYPTION_KEY_ENV_VAR]);
    return new EncryptionService(key);
  }

  /**
   * Encrypt `plaintext` and return a versioned envelope string.
   *
   * Empty plaintexts ARE supported — the result is a non-empty
   * envelope (the version, IV, and tag are always present) so
   * consumers can tell "encrypted empty string" apart from `null`.
   *
   * The optional `aad` is bound into the GCM auth tag. Pass the same
   * value to {@link decrypt} to round-trip; passing a different
   * value (or omitting it) raises an authentication-tag error.
   */
  encrypt(plaintext: string, aad?: string): EncryptedField {
    if (typeof plaintext !== 'string') {
      throw new Error('EncryptionService.encrypt requires a string plaintext.');
    }

    const iv = this.randomIv();
    if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) {
      // Defensive — a misconfigured test seam could return the wrong
      // shape and produce envelopes that decrypt fine in test but
      // fail in production.
      throw new Error(
        `EncryptionService: random IV must be ${IV_BYTES} bytes; got ${
          Buffer.isBuffer(iv) ? iv.length : 'non-buffer'
        }.`,
      );
    }

    const cipher = createCipheriv(ALGO, this.key, iv, {
      authTagLength: TAG_BYTES,
    }) as CipherGCM;

    if (typeof aad === 'string' && aad.length > 0) {
      cipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      toBase64Url(iv),
      toBase64Url(authTag),
      toBase64Url(ciphertext),
    ].join(':') as EncryptedField;
  }

  /**
   * Decrypt a versioned envelope back to UTF-8 plaintext.
   *
   * Throws a plain `Error` with a stable message on any failure:
   *   - Missing / non-string input.
   *   - Wrong segment count or unknown version prefix.
   *   - IV / tag of the wrong length.
   *   - Auth-tag mismatch (tampering, wrong key, or wrong AAD).
   *
   * The error message for an auth-tag failure is intentionally
   * generic — it does not distinguish "tampered ciphertext" from
   * "wrong AAD" so callers can't build an oracle out of the response.
   */
  decrypt(envelope: string, aad?: string): string {
    if (typeof envelope !== 'string' || envelope.length === 0) {
      throw new Error(
        'EncryptionService.decrypt requires a non-empty envelope string.',
      );
    }

    // Expect exactly 4 segments. We split on `:` because base64url
    // does not contain it, so a legitimate envelope has no extra
    // separators.
    const parts = envelope.split(':');
    if (parts.length !== 4) {
      throw new Error(
        `malformed envelope: expected 4 segments, got ${parts.length}.`,
      );
    }
    const [version, ivSeg, tagSeg, ctSeg] = parts as [
      string,
      string,
      string,
      string,
    ];

    if (version !== ENVELOPE_VERSION) {
      throw new Error(
        `unsupported envelope version "${version}"; this binary supports ${ENVELOPE_VERSION}.`,
      );
    }
    if (ivSeg.length === 0 || tagSeg.length === 0) {
      throw new Error('malformed envelope: iv and tag segments must be non-empty.');
    }

    const iv = fromBase64Url(ivSeg, 'iv');
    const authTag = fromBase64Url(tagSeg, 'tag');
    const ciphertext = fromBase64Url(ctSeg, 'ciphertext');

    if (iv.length !== IV_BYTES) {
      throw new Error(
        `malformed envelope: iv must be ${IV_BYTES} bytes; got ${iv.length}.`,
      );
    }
    if (authTag.length !== TAG_BYTES) {
      throw new Error(
        `malformed envelope: tag must be ${TAG_BYTES} bytes; got ${authTag.length}.`,
      );
    }

    const decipher = createDecipheriv(ALGO, this.key, iv, {
      authTagLength: TAG_BYTES,
    }) as DecipherGCM;
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
      // Underlying `node:crypto` message: "Unsupported state or
      // unable to authenticate data". Normalise to a stable string
      // and drop the original via the `cause` chain so observability
      // can drill in without exposing it to callers.
      const wrapped = new Error('authentication tag mismatch');
      (wrapped as { cause?: unknown }).cause = err;
      throw wrapped;
    }
  }

  /**
   * Cheap structural check — quickly determine whether a string
   * looks like a versioned envelope. Used during a column rollout
   * when a row may contain a mix of plaintext (legacy) and
   * ciphertext (new). Returning `true` does NOT guarantee that
   * decryption will succeed — it only means the value has the right
   * shape.
   */
  isEnvelope(candidate: unknown): candidate is EncryptedField {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    return /^v\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$/.test(
      candidate,
    );
  }
}
