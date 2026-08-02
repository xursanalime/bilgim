import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  EncryptionService as MasterEncryptionService,
} from '../../../common/security/encryption/encryption.service';
import { FieldEncryptionError } from '../../../common/security/encryption/encryption.errors';
import { KeyManagementService } from './key-management.service';
import type { KmsKey } from './kms.port';

// ---------------------------------------------------------------------------
// Constants — these are part of the v2 wire format.
// ---------------------------------------------------------------------------

const ALGO = 'aes-256-gcm' as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Envelope version embedded by `encrypt()`. */
export const KMS_ENVELOPE_VERSION = 'v2' as const;

/**
 * `KmsEnvelopeService` — Task 28.2.
 *
 * Field-level encryption that embeds the *KMS key id* in the envelope
 * so a future rotation can decrypt historical rows by looking the id
 * up in `KeyManagementService`.
 *
 * Wire format:
 *
 *     v2:<keyId>:<base64url(iv)>:<base64url(ciphertext)>:<base64url(tag)>
 *
 *   - `v2`         — fixed version prefix; `decrypt()` branches on
 *                    this so v1 envelopes (master-key only, the
 *                    Task 28.1 default) keep round-tripping.
 *   - `<keyId>`    — KMS key id minted by `KeyManagementService`.
 *                    Decoders look the id up via `getKeyById` and
 *                    use the returned `material` to decrypt.
 *   - `iv` / `ct` / `tag` — AES-256-GCM components, base64url-encoded.
 *                            `:` is safe as a separator because
 *                            base64url doesn't contain it.
 *
 * Backward compat:
 *   - `decrypt()` accepts both `v2` and any legacy `v1` envelopes.
 *     Legacy v1 envelopes are delegated to the master-key
 *     `EncryptionService` injected at construction time. This is
 *     what enables a zero-downtime rollout: rows written before the
 *     KMS migration keep decrypting under the master key, rows
 *     written after embed a KMS id.
 *
 * AAD:
 *   - The optional `aad` is bound into the GCM auth tag so callers
 *     can tie ciphertexts to a context (field name, user id, …)
 *     without minting a separate key per context.
 */
@Injectable()
export class KmsEnvelopeService {
  constructor(
    private readonly keyManagement: KeyManagementService,
    /**
     * Master-key encryption service (Task 28.1). Used to decrypt
     * pre-rotation `v1` envelopes during the rollout window.
     * Optional — when absent, the service refuses to decrypt v1
     * blobs and surfaces a typed error.
     */
    @Optional()
    @Inject(MasterEncryptionService)
    private readonly legacyMasterEncryption?: MasterEncryptionService,
  ) {}

  /**
   * Encrypt plaintext with the currently-active DEK. Returns a `v2`
   * envelope whose key id can be resolved on decrypt.
   */
  async encrypt(plaintext: string, aad?: string): Promise<string> {
    if (typeof plaintext !== 'string') {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'KmsEnvelopeService.encrypt requires a string plaintext.',
      );
    }
    const key = await this.keyManagement.getActiveKey();
    return this.encryptWithKey(plaintext, key, aad);
  }

  /**
   * Encrypt using a specific KMS key. Used by the re-encryption
   * processor when it wants to re-wrap rows under the active key
   * but read them with a retired key.
   */
  async encryptWithKey(
    plaintext: string,
    key: KmsKey,
    aad?: string,
  ): Promise<string> {
    if (key.material.length !== KEY_BYTES) {
      throw new FieldEncryptionError(
        'MASTER_KEY_INVALID',
        `KmsEnvelopeService: key id=${key.id} is ${key.material.length} bytes; expected ${KEY_BYTES}.`,
      );
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key.material, iv, {
      authTagLength: TAG_BYTES,
    });
    if (typeof aad === 'string' && aad.length > 0) {
      cipher.setAAD(Buffer.from(aad, 'utf8'));
    }
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      KMS_ENVELOPE_VERSION,
      this.encodeKeyId(key.id),
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join(':');
  }

  /**
   * Decrypt an envelope. Handles both `v2` (KMS-aware) and `v1`
   * (legacy master-key) prefixes for backward compatibility during
   * the rollout window.
   */
  async decrypt(envelope: string, aad?: string): Promise<string> {
    if (typeof envelope !== 'string' || envelope.length === 0) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'KmsEnvelopeService.decrypt requires a non-empty envelope string.',
      );
    }
    // Legacy v1 envelopes from `common/security/encryption/` use a
    // dot as the separator (`v1.<keyId>.<payload>`), while v2 KMS
    // envelopes use a colon (`v2:<keyId>:<iv>:<ct>:<tag>`). We
    // therefore route on the version-suffix character rather than
    // splitting on a single separator.
    if (envelope.startsWith('v1.')) {
      if (!this.legacyMasterEncryption) {
        throw new FieldEncryptionError(
          'UNSUPPORTED_VERSION',
          'KmsEnvelopeService: legacy v1 envelope encountered but the master-key service is not bound.',
        );
      }
      return this.legacyMasterEncryption.decrypt(envelope, aad);
    }
    if (envelope.startsWith(`${KMS_ENVELOPE_VERSION}:`)) {
      return this.decryptV2(envelope, aad);
    }
    // Anything else is either an unknown future version or
    // garbage — surface as UNSUPPORTED_VERSION so callers can
    // distinguish the case from "auth tag mismatch".
    const sep = envelope.indexOf(':');
    const dot = envelope.indexOf('.');
    const cut = sep >= 0 && (dot < 0 || sep < dot) ? sep : dot;
    const version = cut > 0 ? envelope.slice(0, cut) : envelope.slice(0, 8);
    throw new FieldEncryptionError(
      'UNSUPPORTED_VERSION',
      `KmsEnvelopeService: unknown envelope version "${version}".`,
    );
  }

  /**
   * Extract the embedded key id from a `v2` envelope without
   * decrypting. Used by `ReencryptProcessor` so it can skip rows
   * that already use the active key id (idempotent re-encrypt).
   *
   * Returns `null` when the envelope is not `v2` or the format is
   * malformed — callers can then treat the row as "needs to migrate
   * from a legacy format" or "leave alone".
   */
  extractKeyId(envelope: string): string | null {
    if (typeof envelope !== 'string') return null;
    const parts = envelope.split(':');
    if (parts.length !== 5) return null;
    if (parts[0] !== KMS_ENVELOPE_VERSION) return null;
    const decoded = this.decodeKeyId(parts[1] ?? '');
    return decoded.length > 0 ? decoded : null;
  }

  /**
   * Cheap structural check — recognise both v1 and v2 envelopes.
   * Used by callers that want to "decrypt-if-encrypted" during a
   * rollout window when a column may contain a mix of plaintext and
   * envelope rows.
   */
  isEnvelope(candidate: string | null | undefined): candidate is string {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    return /^v\d+(:|\.).+/.test(candidate);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async decryptV2(envelope: string, aad?: string): Promise<string> {
    const parts = envelope.split(':');
    if (parts.length !== 5) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        `KmsEnvelopeService: v2 envelope must have 5 segments; got ${parts.length}.`,
      );
    }
    const [, encodedKeyId, ivSeg, ctSeg, tagSeg] = parts;
    const keyId = this.decodeKeyId(encodedKeyId ?? '');
    if (keyId.length === 0) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'KmsEnvelopeService: v2 envelope has empty keyId segment.',
      );
    }

    const key = await this.keyManagement.getKeyById(keyId);
    if (!key) {
      throw new FieldEncryptionError(
        'UNSUPPORTED_VERSION',
        `KmsEnvelopeService: KMS key id "${keyId}" is not known to this binary.`,
      );
    }

    let iv: Buffer;
    let ciphertext: Buffer;
    let tag: Buffer;
    try {
      iv = Buffer.from(ivSeg ?? '', 'base64url');
      ciphertext = Buffer.from(ctSeg ?? '', 'base64url');
      tag = Buffer.from(tagSeg ?? '', 'base64url');
    } catch (err) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        'KmsEnvelopeService: failed to base64url-decode envelope segments.',
        err,
      );
    }
    if (iv.length !== IV_BYTES) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        `KmsEnvelopeService: IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
      );
    }
    if (tag.length !== TAG_BYTES) {
      throw new FieldEncryptionError(
        'ENVELOPE_MALFORMED',
        `KmsEnvelopeService: tag must be ${TAG_BYTES} bytes; got ${tag.length}.`,
      );
    }

    const decipher = createDecipheriv(ALGO, key.material, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
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
      throw new FieldEncryptionError(
        'INVALID_AUTHENTICATION_TAG',
        'KmsEnvelopeService: decryption failed (auth tag mismatch, wrong key, or wrong AAD).',
        err,
      );
    }
  }

  /**
   * Encode the key id so the envelope's `:` separator stays
   * unambiguous. Vault ids include `:` (e.g. `key:3`); we substitute
   * `~` since neither URL-safe base64 nor cuid emit it.
   */
  private encodeKeyId(id: string): string {
    return id.replace(/:/g, '~');
  }

  private decodeKeyId(encoded: string): string {
    return encoded.replace(/~/g, ':');
  }
}
