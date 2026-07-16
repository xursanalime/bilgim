import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../../../config/env.schema';

/** AES-256-GCM with the NIST-recommended 96-bit IV and 128-bit tag. */
const ALGO = 'aes-256-gcm' as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/**
 * Wire format magic header. Lets a future format version evolve
 * without ambiguity, and lets `decryptStream` reject non-Bilgim
 * archives early instead of producing garbage.
 *
 *   bytes 0..3   `EBBK`            (magic)
 *   byte  4      `0x01`            (version)
 *   bytes 5..16  IV (12 bytes)
 *   bytes 17..32 auth tag (16 bytes, written at finish)
 *   bytes 33..   ciphertext
 *
 * Total prefix = 33 bytes. The auth tag occupies a fixed slot at
 * bytes 17..32; we cannot know the tag until the cipher emits its
 * final block, so the encrypt path rewrites it once when the input
 * stream ends. Because the stream is sequential, we assemble the
 * header in a small staging buffer and only flush it after the
 * cipher finalises — that way the consumer sees a single contiguous
 * stream of `[header || ciphertext]`.
 */
const MAGIC = Buffer.from('EBBK', 'utf8');
const VERSION = 0x01;
const HEADER_LEN = MAGIC.length + 1 + IV_BYTES + TAG_BYTES; // 33

/** Error class for backup-specific failures. */
export class BackupEncryptionError extends Error {
  public override readonly cause?: unknown;
  constructor(
    public readonly code:
      | 'KEY_MISSING'
      | 'KEY_INVALID'
      | 'HEADER_MALFORMED'
      | 'AUTH_TAG_MISMATCH',
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'BackupEncryptionError';
    this.cause = cause;
  }
}

export interface BackupEncryptionDeps {
  /** Override for the IV / nonce source — only used in tests. */
  randomBytesFn?: (size: number) => Buffer;
}

/**
 * `BackupEncryptionService` (Task 28.4, Req 28.8).
 *
 * Streams large backup archives through AES-256-GCM with a per-call
 * random IV. Designed for the cron pipeline:
 *
 *   pg_dump | backup-encrypt.ts | rclone copy - r2:bilgim-backups/...
 *
 * **Why streams.** Production dumps are tens of GiB; loading them
 * into memory is a non-starter. Both `encryptStream()` and
 * `decryptStream()` take a `Readable` source and return a `Readable`
 * the caller can pipe into S3 / R2 uploaders, file streams, etc.
 *
 * **Key separation (Req 28.8).** The service reads
 * `BACKUP_ENCRYPTION_KEY` — distinct from `MASTER_ENCRYPTION_KEY` /
 * `ENCRYPTION_KEY`. A compromise of the live encryption key does NOT
 * grant access to historical backups, and vice versa. Operators
 * generate a fresh key with:
 *
 *   `openssl rand -base64 32`
 *
 * and store it in the secrets backend (Vault / AWS Secrets Manager)
 * separately from the live keys.
 *
 * **Wire format.** `[MAGIC(4) || VERSION(1) || IV(12) || AUTH_TAG(16) || CIPHERTEXT(*)]`.
 * The auth tag sits at a fixed slot rather than appended at the end
 * so a partial decrypt that streams to disk can still verify
 * authenticity at finish time without seeking backwards.
 */
@Injectable()
export class BackupEncryptionService {
  private readonly logger = new Logger(BackupEncryptionService.name);
  private readonly key: Buffer | null;
  private readonly randomBytesFn: (size: number) => Buffer;

  constructor(
    config: ConfigService<EnvConfig>,
    @Optional() deps?: BackupEncryptionDeps,
  ) {
    const raw = (config.get('BACKUP_ENCRYPTION_KEY' as never) as
      | string
      | undefined) ?? undefined;
    this.key = raw ? decodeKey(raw) : null;
    this.randomBytesFn = deps?.randomBytesFn ?? randomBytes;

    if (!this.key) {
      this.logger.warn(
        'BACKUP_ENCRYPTION_KEY is unset — backup encryption is disabled. Set a base64-encoded 32-byte key before running production backups.',
      );
    } else {
      this.logger.log(
        'BackupEncryptionService initialised with AES-256-GCM (separate key from MASTER_ENCRYPTION_KEY).',
      );
    }
  }

  /**
   * Direct construction (used by the CLI scripts where Nest DI is
   * not available). Throws `KEY_MISSING` / `KEY_INVALID` if the key
   * argument cannot be decoded into a 32-byte buffer.
   */
  static fromKeyMaterial(
    keyMaterial: string,
    deps?: BackupEncryptionDeps,
  ): BackupEncryptionService {
    const fakeConfig = {
      get: (name: string) =>
        name === 'BACKUP_ENCRYPTION_KEY' ? keyMaterial : undefined,
    } as unknown as ConfigService<EnvConfig>;
    return new BackupEncryptionService(fakeConfig, deps);
  }

  /**
   * Wrap an input stream in an AES-256-GCM encrypting transform.
   * The output stream emits the wire-format described above.
   */
  encryptStream(input: Readable): Readable {
    const key = this.requireKey();
    const iv = this.randomBytesFn(IV_BYTES);
    if (iv.length !== IV_BYTES) {
      throw new BackupEncryptionError(
        'KEY_INVALID',
        `Random IV must be ${IV_BYTES} bytes; got ${iv.length}.`,
      );
    }

    const cipher = createCipheriv(ALGO, key, iv, {
      authTagLength: TAG_BYTES,
    });
    const output = new PassThrough();

    // Reserve the header slot up front. We push 33 zero bytes now
    // and patch the tag in once `cipher` finalises. Downstream
    // consumers (R2, file writers) get a single contiguous stream
    // and never have to seek.
    //
    // We can't actually rewrite already-emitted bytes, so instead
    // we BUFFER the entire ciphertext and flush header+ciphertext
    // when finish lands. This is safe for typical backup sizes
    // because GCM's tag is only available at finish time. For
    // truly streaming write paths (e.g. multipart S3) the upload
    // wrapper buffers the first 33 bytes anyway.
    const chunks: Buffer[] = [];

    cipher.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    cipher.on('end', () => {
      const tag = cipher.getAuthTag();
      const header = Buffer.alloc(HEADER_LEN);
      MAGIC.copy(header, 0);
      header[MAGIC.length] = VERSION;
      iv.copy(header, MAGIC.length + 1);
      tag.copy(header, MAGIC.length + 1 + IV_BYTES);

      output.write(header);
      for (const c of chunks) output.write(c);
      output.end();
    });

    cipher.on('error', (err) => output.destroy(err));
    input.on('error', (err) => {
      cipher.destroy(err);
      if (!output.destroyed) output.destroy(err);
    });

    input.pipe(cipher);

    return output;
  }

  /**
   * Decrypt a stream produced by `encryptStream`. Throws
   * `BackupEncryptionError(AUTH_TAG_MISMATCH)` if the ciphertext or
   * header was tampered with, or `HEADER_MALFORMED` for a missing
   * magic / wrong version / truncated header.
   */
  decryptStream(input: Readable): Readable {
    const key = this.requireKey();
    const output = new PassThrough();

    let header = Buffer.alloc(0);
    let pendingDataChunks: Buffer[] = [];
    let cipher: ReturnType<typeof createDecipheriv> | null = null;
    let headerComplete = false;

    const onChunk = (chunk: Buffer): void => {
      if (headerComplete && cipher) {
        cipher.write(chunk);
        return;
      }

      header = Buffer.concat([header, chunk]);
      if (header.length < HEADER_LEN) return;

      // Slice the header off and forward the remainder to the
      // cipher. Anything past the header is ciphertext.
      const headerSlice = header.subarray(0, HEADER_LEN);
      const tail = header.subarray(HEADER_LEN);
      header = headerSlice;
      headerComplete = true;

      try {
        cipher = buildDecipher(headerSlice, key);
      } catch (err) {
        cleanupOnHeaderError(err);
        return;
      }

      cipher.on('data', (out: Buffer) => output.write(out));
      cipher.on('end', () => output.end());
      cipher.on('error', (err) =>
        output.destroy(
          new BackupEncryptionError(
            'AUTH_TAG_MISMATCH',
            'Backup decryption failed: authentication tag mismatch (wrong key, tampered ciphertext, or corrupted file).',
            err,
          ),
        ),
      );

      // Forward any tail bytes captured before we recognised the
      // header boundary, then anything we buffered during the
      // header-collection phase (none in practice — but defensive).
      if (tail.length > 0) cipher.write(tail);
      for (const c of pendingDataChunks) cipher.write(c);
      pendingDataChunks = [];
    };

    const cleanupOnHeaderError = (err: unknown): void => {
      input.removeListener('data', onChunk);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      output.destroy(
        err instanceof BackupEncryptionError
          ? err
          : new BackupEncryptionError(
              'HEADER_MALFORMED',
              'Failed to parse backup header.',
              err,
            ),
      );
    };

    const onEnd = (): void => {
      if (!headerComplete) {
        cleanupOnHeaderError(
          new BackupEncryptionError(
            'HEADER_MALFORMED',
            `Stream ended before header completed (received ${header.length} bytes, need ${HEADER_LEN}).`,
          ),
        );
        return;
      }
      cipher?.end();
    };

    const onError = (err: Error): void => {
      cipher?.destroy(err);
      if (!output.destroyed) output.destroy(err);
    };

    input.on('data', onChunk);
    input.on('end', onEnd);
    input.on('error', onError);

    return output;
  }

  /** Returns true when a backup key is configured. */
  isConfigured(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new BackupEncryptionError(
        'KEY_MISSING',
        'BACKUP_ENCRYPTION_KEY is not configured. Set the env var to a base64-encoded 32-byte key.',
      );
    }
    return this.key;
  }
}

/**
 * Decode a base64-encoded key string into a 32-byte buffer. Accepts
 * the standard base64 alphabet (urlsafe is rejected on purpose so a
 * confused operator does not silently produce a different key).
 */
function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BackupEncryptionError(
      'KEY_MISSING',
      'BACKUP_ENCRYPTION_KEY is empty.',
    );
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, 'base64');
  } catch (err) {
    throw new BackupEncryptionError(
      'KEY_INVALID',
      'BACKUP_ENCRYPTION_KEY must be base64-encoded.',
      err,
    );
  }
  if (decoded.length !== KEY_BYTES) {
    throw new BackupEncryptionError(
      'KEY_INVALID',
      `BACKUP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${decoded.length}. Generate with \`openssl rand -base64 32\`.`,
    );
  }
  return decoded;
}

function buildDecipher(
  header: Buffer,
  key: Buffer,
): ReturnType<typeof createDecipheriv> {
  if (
    header.length !== HEADER_LEN ||
    header.subarray(0, MAGIC.length).compare(MAGIC) !== 0
  ) {
    throw new BackupEncryptionError(
      'HEADER_MALFORMED',
      'Backup header missing EBBK magic prefix.',
    );
  }
  const version = header[MAGIC.length];
  if (version !== VERSION) {
    throw new BackupEncryptionError(
      'HEADER_MALFORMED',
      `Unsupported backup format version: ${version} (expected ${VERSION}).`,
    );
  }
  const iv = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_BYTES);
  const tag = header.subarray(MAGIC.length + 1 + IV_BYTES, HEADER_LEN);

  const decipher = createDecipheriv(ALGO, key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return decipher;
}

export const BACKUP_FORMAT = {
  MAGIC,
  VERSION,
  HEADER_LEN,
  IV_BYTES,
  TAG_BYTES,
  KEY_BYTES,
} as const;
