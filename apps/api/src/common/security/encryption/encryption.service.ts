import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FieldEncryptionError } from './encryption.errors';

// ---------------------------------------------------------------------------
// Constants — pinning these is part of the wire format.
// ---------------------------------------------------------------------------

/** AES-256-GCM (256-bit key, 96-bit IV, 128-bit tag). */
const ALGO = 'aes-256-gcm' as const;

/** AES-256 keys are exactly 32 bytes. */
const KEY_BYTES = 32;

/**
 * 12 bytes (96 bits) is the NIST SP 800-38D recommended IV length for
 * GCM. Sticking to the recommended length lets us use the simple raw
 * 96-bit nonce construction and keeps the auth tag at its
 * cryptographic optimum.
 */
const IV_BYTES = 12;

/**
 * 16 bytes (128 bits) — the GCM authentication tag length. We pin the
 * tag to the maximum supported size so a partial-tag truncation
 * attack can't be smuggled past the verifier.
 */
const TAG_BYTES = 16;

/**
 * Current envelope version. Consumed by `encrypt()` when forming a
 * new blob. The decode path is version-aware and dispatches by the
 * leading prefix, so a future `v2` rollout adds a parser branch
 * without breaking historical reads.
 */
export const CURRENT_ENVELOPE_VERSION = 'v1' as const;

/** Default key-id used when only the boot-time master key is present. */
export const DEFAULT_KEY_ID = 'master' as const;

/**
 * Hex-encoded 32-byte development fallback. Only ever used when
 * `NODE_ENV !== 'production'` and `MASTER_KEY` is unset. Static
 * material so existing dev fixtures and unit tests round-trip without
 * having to plumb the env var. Production refuses to use it (the
 * boot guard throws before the fallback would be selected).
 */
const DEV_FALLBACK_KEY_HEX =
  '00112233445566778899aabbccddeeff' +
  '00112233445566778899aabbccddeeff';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured output of `encrypt()` — exposed for callers that want
 * direct access to the parts (e.g. tests, debugging tools) before
 * they're packed into the wire-format string. Production code should
 * pass the `packed` field through `decrypt()` round-trip.
 *
 *   - `ciphertext` — base64 of the AES-256-GCM ciphertext.
 *   - `iv`         — base64 of the 12-byte random IV.
 *   - `authTag`    — base64 of the 16-byte GCM auth tag.
 *   - `aad`        — base64 of the AAD bound at encrypt time
 *                    (`undefined` when no context was supplied).
 *   - `keyId`      — the key identifier active at encrypt time.
 *   - `version`    — the envelope-format version (`v1` today).
 *   - `packed`     — the canonical wire-format string; this is what
 *                    `decrypt()` consumes.
 */
export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
  aad?: string | undefined;
  keyId: string;
  version: string;
  packed: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * `EncryptionService` — application-layer field-level encryption with
 * AES-256-GCM, a versioned wire format, and AAD-based context binding
 * (Task 28.1).
 *
 * Wire format (a single base64-of-concatenated-bytes string, with a
 * dot-separated version prefix):
 *
 *     v1.<keyId>.<base64( iv | ciphertext | tag | aad )>
 *
 *   - `v1`       — fixed envelope version. Future rollouts add new
 *                  prefixes (`v2.`, …) and the decode path dispatches
 *                  by version.
 *   - `<keyId>`  — identifier of the master key used for this blob.
 *                  When only the boot-time master key is present the
 *                  id is `master`; future Vault/KMS rotations will
 *                  assign more descriptive ids.
 *   - The trailing base64 segment packs four byte-strings, prefixed
 *     by their lengths so the decoder doesn't need a second separator
 *     scheme that could collide with base64 alphabet:
 *         u16(iv.length) | iv | u32(ct.length) | ct |
 *         u8(tag.length) | tag | u16(aad.length) | aad
 *
 * The single base64 string is convenient for storing in JSON columns
 * and Redis values. The version prefix is plain ASCII so `decrypt()`
 * can refuse `v2`-formatted blobs with a clear error before doing any
 * crypto work.
 *
 * **AAD (associated authenticated data).** Both `encrypt()` and
 * `decrypt()` accept an optional `context` (or `fieldName` via the
 * field-level helpers). When supplied, the value is bound into the
 * GCM auth tag — decrypting with a different context surfaces an
 * auth-tag failure. This is how callers tie a ciphertext to a logical
 * field (e.g. `User.phone`) so a stolen `Address` ciphertext cannot
 * be silently swapped into the `phone` slot.
 *
 * The AAD itself **is** stored inside the blob (length-prefixed) so
 * the decrypt side can refuse mismatches with a deterministic
 * `AAD_MISMATCH` error before the auth-tag check runs. This matches
 * the spec — "AAD mismatch must throw" — and produces a stable error
 * code distinct from generic tag failures.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly keysByKeyId: Map<string, Buffer>;
  private readonly activeKeyId: string;
  private readonly randomBytesFn: (size: number) => Buffer;

  /**
   * Two construction shapes are supported:
   *
   *   1. Direct injection of a master-key buffer — used by tests so
   *      they can drive the service deterministically.
   *   2. Nest DI with `ConfigService` — when no override is supplied
   *      the service reads `MASTER_KEY` from config / env itself,
   *      validates the length, and either sets up the active key or
   *      hard-stops the process (production) / falls back to the dev
   *      key (everywhere else).
   *
   * The `randomBytesFn` argument is a test-only seam — pass a
   * deterministic generator from a unit test to assert on specific
   * IVs. Production always uses Node's CSPRNG.
   */
  constructor(
    @Optional() activeKey?: Buffer,
    @Optional() configService?: ConfigService,
    @Optional() randomBytesFn?: (size: number) => Buffer,
  ) {
    this.randomBytesFn = randomBytesFn ?? randomBytes;

    let materialised: Buffer;
    let keyId: string;

    if (activeKey) {
      if (!Buffer.isBuffer(activeKey)) {
        throw new FieldEncryptionError(
          'MASTER_KEY_INVALID',
          'EncryptionService: active key must be a Buffer.',
        );
      }
      if (activeKey.length !== KEY_BYTES) {
        throw new FieldEncryptionError(
          'MASTER_KEY_INVALID',
          `EncryptionService: active key must be ${KEY_BYTES} bytes; got ${activeKey.length}.`,
        );
      }
      materialised = Buffer.from(activeKey);
      keyId = DEFAULT_KEY_ID;
    } else {
      const raw =
        configService?.get<string>('MASTER_KEY') ?? process.env.MASTER_KEY;
      const nodeEnv =
        configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV;

      if (raw && raw.trim().length > 0) {
        materialised = decodeMasterKeyHex(raw.trim());
        keyId = DEFAULT_KEY_ID;
      } else if (nodeEnv === 'production') {
        // Production must always set a real key — refuse to start.
        // The exception bubbles through Nest's DI factory so the boot
        // sequence aborts before any controller is wired.
        throw new FieldEncryptionError(
          'MASTER_KEY_MISSING',
          'MASTER_KEY is required in production. Generate one with `openssl rand -hex 32`.',
        );
      } else {
        materialised = decodeMasterKeyHex(DEV_FALLBACK_KEY_HEX);
        keyId = DEFAULT_KEY_ID;
        this.logger.warn(
          `MASTER_KEY not set; using the well-known dev fallback for ${
            nodeEnv ?? 'dev'
          } only. Set MASTER_KEY before deploying to production.`,
        );
      }
    }

    this.activeKeyId = keyId;
    this.keysByKeyId = new Map<string, Buffer>([[keyId, materialised]]);
  }

  // -------------------------------------------------------------------------
  // High-level API
  // -------------------------------------------------------------------------

  /**
   * Encrypt arbitrary `plaintext` under the active master key. Returns
   * a `EncryptedBlob` with both the structured parts and the packed
   * wire-format string. Production callers typically only care about
   * `.packed` — the structured fields are exposed for tooling and
   * tests.
   *
   * The optional `context` is bound into the GCM auth tag as AAD; pass
   * the same value to `decrypt()` to round-trip. Field-level callers
   * should prefer `encryptField`/`decryptField` so the AAD is
   * derived consistently from the field name.
   *
   * Empty plaintexts are supported — the result is a non-empty blob
   * (the version, key-id, IV, and tag are always present) so consumers
   * can distinguish "encrypted empty string" from `null` / "missing".
   */
  encrypt(plaintext: string | Buffer, context?: string): EncryptedBlob {
    if (typeof plaintext !== 'string' && !Buffer.isBuffer(plaintext)) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'EncryptionService.encrypt requires a string or Buffer plaintext.',
      );
    }

    const key = this.keysByKeyId.get(this.activeKeyId);
    if (!key || key.length !== KEY_BYTES) {
      // Defensive — the constructor invariant guarantees this can't
      // happen, but a clear error here is better than a cryptic
      // `crypto.createCipheriv` failure if a maintainer ever drains
      // the map by mistake.
      throw new FieldEncryptionError(
        'MASTER_KEY_INVALID',
        `Active key "${this.activeKeyId}" is missing or wrong size.`,
      );
    }

    const iv = this.randomBytesFn(IV_BYTES);
    if (iv.length !== IV_BYTES) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        `Random IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
      );
    }

    const cipher = createCipheriv(ALGO, key, iv, {
      authTagLength: TAG_BYTES,
    });

    const aadBuffer =
      typeof context === 'string' && context.length > 0
        ? Buffer.from(context, 'utf8')
        : Buffer.alloc(0);
    if (aadBuffer.length > 0) {
      cipher.setAAD(aadBuffer);
    }

    const plaintextBuffer = Buffer.isBuffer(plaintext)
      ? plaintext
      : Buffer.from(plaintext, 'utf8');

    const ciphertext = Buffer.concat([
      cipher.update(plaintextBuffer),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const packed = packEnvelope({
      version: CURRENT_ENVELOPE_VERSION,
      keyId: this.activeKeyId,
      iv,
      ciphertext,
      authTag,
      aad: aadBuffer,
    });

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      aad: aadBuffer.length > 0 ? aadBuffer.toString('base64') : undefined,
      keyId: this.activeKeyId,
      version: CURRENT_ENVELOPE_VERSION,
      packed,
    };
  }

  /**
   * Decrypt a packed envelope back into a UTF-8 string. The optional
   * `context` is checked against the AAD that was bound at encrypt
   * time — passing a different value (or omitting it when the blob
   * was encrypted with one) raises `AAD_MISMATCH`.
   *
   * Throws `FieldEncryptionError` with one of:
   *   - `ENVELOPE_MALFORMED`         — bad prefix / segments / base64.
   *   - `UNSUPPORTED_VERSION`        — unknown `v…` prefix or unknown
   *                                    `keyId`.
   *   - `AAD_MISMATCH`               — bound vs supplied AAD differ.
   *   - `INVALID_AUTHENTICATION_TAG` — tampering, wrong key, or
   *                                    deeper auth-tag failure.
   */
  decrypt(blob: string, context?: string): string {
    return this.decryptToBuffer(blob, context).toString('utf8');
  }

  /**
   * Variant of `decrypt()` that returns the raw plaintext bytes.
   * Useful when the input passed to `encrypt()` was a `Buffer` and
   * the caller wants to avoid the round-trip through UTF-8.
   */
  decryptToBuffer(blob: string, context?: string): Buffer {
    if (typeof blob !== 'string' || blob.length === 0) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'EncryptionService.decrypt requires a non-empty blob string.',
      );
    }

    const parsed = parseEnvelope(blob);

    if (parsed.version !== CURRENT_ENVELOPE_VERSION) {
      // Future versions will add cases here. Today anything other
      // than `v1` is unknown.
      throw new FieldEncryptionError(
        'UNSUPPORTED_VERSION',
        `Unknown envelope version "${parsed.version}". This binary supports: ${CURRENT_ENVELOPE_VERSION}.`,
      );
    }

    const key = this.keysByKeyId.get(parsed.keyId);
    if (!key) {
      throw new FieldEncryptionError(
        'UNSUPPORTED_VERSION',
        `Unknown keyId "${parsed.keyId}". This binary cannot decrypt blobs written under that key.`,
      );
    }

    // Compare the bound AAD to what the caller supplied. We do this
    // BEFORE invoking the decipher because GCM doesn't tell us
    // whether a tag failure was caused by a tampered ciphertext or
    // an AAD mismatch — distinguishing the two is purely useful for
    // diagnostics and tests.
    const expectedAad =
      typeof context === 'string' && context.length > 0
        ? Buffer.from(context, 'utf8')
        : Buffer.alloc(0);

    if (!buffersEqual(parsed.aad, expectedAad)) {
      throw new FieldEncryptionError(
        'AAD_MISMATCH',
        'Associated data mismatch: the context supplied to decrypt() differs from the value bound at encrypt time.',
      );
    }

    const decipher = createDecipheriv(ALGO, key, parsed.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(parsed.authTag);
    if (parsed.aad.length > 0) {
      decipher.setAAD(parsed.aad);
    }

    try {
      return Buffer.concat([
        decipher.update(parsed.ciphertext),
        decipher.final(),
      ]);
    } catch (err) {
      // Auth-tag verification failure surfaces here. The native
      // message is "Unsupported state or unable to authenticate
      // data" — we normalise it so callers get a stable code without
      // leaking the underlying string.
      throw new FieldEncryptionError(
        'INVALID_AUTHENTICATION_TAG',
        'Decryption failed: authentication tag mismatch, wrong key, or tampered ciphertext.',
        err,
      );
    }
  }

  /**
   * Field-level convenience wrapper. Uses `fieldName` as the AAD so
   * that two ciphertexts written under different field names cannot
   * be substituted for each other at rest.
   *
   * Returns the packed wire-format string only — callers that want
   * the structured parts should use `encrypt()` directly.
   */
  encryptField(plaintext: string, fieldName: string): string {
    if (typeof fieldName !== 'string' || fieldName.length === 0) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'encryptField requires a non-empty fieldName.',
      );
    }
    return this.encrypt(plaintext, fieldName).packed;
  }

  /**
   * Decrypt a field-level blob, verifying that the AAD bound at
   * encrypt time matches the supplied `fieldName`. Mismatches throw
   * `AAD_MISMATCH` — useful when defending against ciphertext-swap
   * attacks at the database layer.
   */
  decryptField(blob: string, fieldName: string): string {
    if (typeof fieldName !== 'string' || fieldName.length === 0) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'decryptField requires a non-empty fieldName.',
      );
    }
    return this.decrypt(blob, fieldName);
  }

  /**
   * Cheap structural check — quickly determine whether a string looks
   * like a packed envelope. Used by callers during a rollout window
   * when a column may contain a mix of plaintext (legacy) and
   * encrypted rows. Returning `true` does NOT guarantee that
   * decryption will succeed; it only means the value is shaped like a
   * blob.
   */
  isEnvelope(candidate: string | null | undefined): candidate is string {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    return /^v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9+/=]+$/.test(candidate);
  }
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests, not part of the DI surface.
// ---------------------------------------------------------------------------

/**
 * Decode a hex-encoded master key and assert it is exactly 32 bytes.
 * Accepts upper- or lower-case hex; rejects anything else with a
 * specific code so the boot guard's error message is actionable.
 */
export function decodeMasterKeyHex(rawValue: string | undefined): Buffer {
  if (!rawValue || rawValue.trim().length === 0) {
    throw new FieldEncryptionError(
      'MASTER_KEY_MISSING',
      'MASTER_KEY is not set. Generate one with `openssl rand -hex 32`.',
    );
  }

  const trimmed = rawValue.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new FieldEncryptionError(
      'MASTER_KEY_INVALID',
      'MASTER_KEY must be hex-encoded (`openssl rand -hex 32` produces the right shape).',
    );
  }
  if (trimmed.length !== KEY_BYTES * 2) {
    throw new FieldEncryptionError(
      'MASTER_KEY_INVALID',
      `MASTER_KEY must decode to exactly ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars); got ${trimmed.length} chars.`,
    );
  }
  return Buffer.from(trimmed, 'hex');
}

interface ParsedEnvelope {
  version: string;
  keyId: string;
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  aad: Buffer;
}

interface PackInput {
  version: string;
  keyId: string;
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  aad: Buffer;
}

/**
 * Pack a structured envelope into the wire-format string. The byte
 * layout is documented on `EncryptionService`; here we simply
 * concatenate the length-prefixed parts and base64-encode the result,
 * then prepend the plain-text `<version>.<keyId>.` header.
 *
 * Length prefixes:
 *   - IV         u16 (max 65535 — well over our fixed 12 bytes)
 *   - ciphertext u32 (max ~4 GB; effectively unlimited for fields)
 *   - tag        u8  (max 255 — fits the fixed 16-byte tag)
 *   - AAD        u16 (max 65535 — fits any reasonable field name /
 *                     UUID-style context).
 */
function packEnvelope(input: PackInput): string {
  const { version, keyId, iv, ciphertext, authTag, aad } = input;

  if (iv.length > 0xffff) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `IV is too long (${iv.length} bytes).`,
    );
  }
  if (ciphertext.length > 0xffffffff) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Ciphertext is too long (${ciphertext.length} bytes).`,
    );
  }
  if (authTag.length > 0xff) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Auth tag is too long (${authTag.length} bytes).`,
    );
  }
  if (aad.length > 0xffff) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `AAD is too long (${aad.length} bytes).`,
    );
  }

  const ivLen = Buffer.alloc(2);
  ivLen.writeUInt16BE(iv.length, 0);

  const ctLen = Buffer.alloc(4);
  ctLen.writeUInt32BE(ciphertext.length, 0);

  const tagLen = Buffer.alloc(1);
  tagLen.writeUInt8(authTag.length, 0);

  const aadLen = Buffer.alloc(2);
  aadLen.writeUInt16BE(aad.length, 0);

  const payload = Buffer.concat([
    ivLen,
    iv,
    ctLen,
    ciphertext,
    tagLen,
    authTag,
    aadLen,
    aad,
  ]);

  return `${version}.${keyId}.${payload.toString('base64')}`;
}

/**
 * Inverse of `packEnvelope`. Validates the version prefix shape, the
 * key-id segment, and every length-prefix during decode. Any
 * structural anomaly raises `ENVELOPE_MALFORMED` with a specific
 * message so failures during a rollout are easy to triage.
 */
function parseEnvelope(blob: string): ParsedEnvelope {
  const firstDot = blob.indexOf('.');
  if (firstDot < 0) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      'Envelope is missing the version separator.',
    );
  }
  const version = blob.slice(0, firstDot);
  if (!/^v\d+$/.test(version)) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Envelope version segment "${version}" is not in the form "v<digits>".`,
    );
  }

  const secondDot = blob.indexOf('.', firstDot + 1);
  if (secondDot < 0) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      'Envelope is missing the keyId separator.',
    );
  }
  const keyId = blob.slice(firstDot + 1, secondDot);
  if (keyId.length === 0) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      'Envelope keyId segment is empty.',
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(keyId)) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Envelope keyId "${keyId}" contains invalid characters.`,
    );
  }

  const payloadB64 = blob.slice(secondDot + 1);
  if (payloadB64.length === 0) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      'Envelope payload segment is empty.',
    );
  }

  let payload: Buffer;
  try {
    payload = Buffer.from(payloadB64, 'base64');
  } catch (err) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      'Envelope payload is not valid base64.',
      err,
    );
  }
  // Buffer.from('!@#', 'base64') silently produces a buffer of the
  // valid prefix — guard against that by re-encoding and comparing
  // length, which is cheap and rejects most garbage.
  if (payload.toString('base64').replace(/=+$/, '') !==
      payloadB64.replace(/=+$/, '')) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      'Envelope payload contains characters outside the base64 alphabet.',
    );
  }

  let offset = 0;
  const need = (n: number, what: string): void => {
    if (offset + n > payload.length) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        `Envelope payload is truncated while reading ${what}.`,
      );
    }
  };

  need(2, 'iv length');
  const ivLen = payload.readUInt16BE(offset);
  offset += 2;
  if (ivLen !== IV_BYTES) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Envelope IV must be ${IV_BYTES} bytes; declared length is ${ivLen}.`,
    );
  }
  need(ivLen, 'iv');
  const iv = payload.subarray(offset, offset + ivLen);
  offset += ivLen;

  need(4, 'ciphertext length');
  const ctLen = payload.readUInt32BE(offset);
  offset += 4;
  need(ctLen, 'ciphertext');
  const ciphertext = payload.subarray(offset, offset + ctLen);
  offset += ctLen;

  need(1, 'tag length');
  const tagLen = payload.readUInt8(offset);
  offset += 1;
  if (tagLen !== TAG_BYTES) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Envelope auth tag must be ${TAG_BYTES} bytes; declared length is ${tagLen}.`,
    );
  }
  need(tagLen, 'tag');
  const authTag = payload.subarray(offset, offset + tagLen);
  offset += tagLen;

  need(2, 'aad length');
  const aadLen = payload.readUInt16BE(offset);
  offset += 2;
  need(aadLen, 'aad');
  const aad = payload.subarray(offset, offset + aadLen);
  offset += aadLen;

  if (offset !== payload.length) {
    throw new FieldEncryptionError(
      'ENVELOPE_MALFORMED',
      `Envelope payload has ${payload.length - offset} trailing bytes after parsing.`,
    );
  }

  return { version, keyId, iv, ciphertext, authTag, aad };
}

/**
 * Constant-ish equality check for two buffers. Crypto-grade
 * `timingSafeEqual` requires equal lengths, so we short-circuit on
 * length difference (which already leaks length anyway — that's
 * inherent to the construction).
 */
function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // `Buffer` indexed access is typed as `number | undefined` under
    // `noUncheckedIndexedAccess`, but the loop bounds guarantee both
    // are defined. The `?? 0` fallbacks keep the type-checker happy
    // without changing semantics.
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
