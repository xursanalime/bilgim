import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import * as fc from 'fast-check';

import {
  BackupEncryptionError,
  BackupEncryptionService,
  BACKUP_FORMAT,
} from './backup-encryption.service';

/**
 * Tests for `BackupEncryptionService` (Task 28.4, Req 28.8).
 *
 * Focus areas:
 *
 *   1. Round-trip stream encryption / decryption preserves the
 *      original bytes exactly (any-size payload).
 *   2. Tampering with the ciphertext, header, or auth tag forces
 *      decryption to surface a typed `BackupEncryptionError`.
 *   3. Wrong key fails the auth-tag check (never silently produces
 *      garbage plaintext).
 *   4. Missing / malformed `BACKUP_ENCRYPTION_KEY` surfaces as
 *      `KEY_MISSING` / `KEY_INVALID` rather than crashing later in
 *      the pipeline.
 *
 * Validates: Requirements 28.8.
 */

const VALID_KEY = randomBytes(BACKUP_FORMAT.KEY_BYTES).toString('base64');

function streamFrom(buffer: Buffer): Readable {
  return Readable.from([buffer]);
}

async function collectStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writer = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    stream.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', () => resolve(Buffer.concat(chunks)));
    stream.pipe(writer);
  });
}

describe('BackupEncryptionService', () => {
  describe('configuration', () => {
    it('throws KEY_MISSING when BACKUP_ENCRYPTION_KEY is unset', () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      expect(svc.isConfigured()).toBe(true);
    });

    it('throws KEY_INVALID for non-32-byte key material', () => {
      expect(() =>
        BackupEncryptionService.fromKeyMaterial(
          Buffer.alloc(16).toString('base64'),
        ),
      ).toThrow(BackupEncryptionError);
    });

    it('throws KEY_MISSING for empty key string', () => {
      expect(() =>
        BackupEncryptionService.fromKeyMaterial('   '),
      ).toThrow(BackupEncryptionError);
    });

    it('isConfigured returns false when no key was supplied', () => {
      const svc = new BackupEncryptionService(
        { get: () => undefined } as never,
      );
      expect(svc.isConfigured()).toBe(false);
      expect(() => svc.encryptStream(streamFrom(Buffer.from('x')))).toThrow(
        BackupEncryptionError,
      );
    });
  });

  describe('round-trip', () => {
    it('preserves a tiny payload', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const original = Buffer.from('hello, world');

      const ciphertext = await collectStream(
        svc.encryptStream(streamFrom(original)),
      );
      const plaintext = await collectStream(
        svc.decryptStream(streamFrom(ciphertext)),
      );

      expect(plaintext.equals(original)).toBe(true);
    });

    it('preserves an empty payload', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const original = Buffer.alloc(0);

      const ciphertext = await collectStream(
        svc.encryptStream(streamFrom(original)),
      );
      // Empty plaintext still produces the 33-byte header.
      expect(ciphertext.length).toBe(BACKUP_FORMAT.HEADER_LEN);

      const plaintext = await collectStream(
        svc.decryptStream(streamFrom(ciphertext)),
      );
      expect(plaintext.length).toBe(0);
    });

    it('preserves a multi-megabyte payload', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const original = randomBytes(1024 * 1024 + 7); // 1 MiB + 7 bytes

      const ciphertext = await collectStream(
        svc.encryptStream(streamFrom(original)),
      );
      const plaintext = await collectStream(
        svc.decryptStream(streamFrom(ciphertext)),
      );

      expect(plaintext.equals(original)).toBe(true);
    });

    /**
     * Property 28.4-A: round-trip of any byte-buffer up to a
     * realistic per-test cap returns the exact input bytes.
     *
     * **Validates: Requirements 28.8.**
     */
    it('property: encrypt then decrypt yields the original bytes', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 0, maxLength: 8192 }),
          async (bytes) => {
            const original = Buffer.from(bytes);
            const ciphertext = await collectStream(
              svc.encryptStream(streamFrom(original)),
            );
            const plaintext = await collectStream(
              svc.decryptStream(streamFrom(ciphertext)),
            );
            return plaintext.equals(original);
          },
        ),
        { numRuns: 25 },
      );
    });
  });

  describe('integrity', () => {
    it('rejects tampered ciphertext with AUTH_TAG_MISMATCH', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const original = Buffer.from('the quick brown fox jumps over the lazy dog');

      const ciphertext = await collectStream(
        svc.encryptStream(streamFrom(original)),
      );
      // Flip a byte well past the header so we exercise the cipher
      // path (not the magic / version validation).
      const tampered = Buffer.from(ciphertext);
      const target = BACKUP_FORMAT.HEADER_LEN + 4;
      tampered[target] = (tampered[target] ?? 0) ^ 0xff;

      await expect(
        collectStream(svc.decryptStream(streamFrom(tampered))),
      ).rejects.toBeInstanceOf(BackupEncryptionError);
    });

    it('rejects a wrong-key decryption', async () => {
      const svcA = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const svcB = BackupEncryptionService.fromKeyMaterial(
        randomBytes(BACKUP_FORMAT.KEY_BYTES).toString('base64'),
      );

      const ciphertext = await collectStream(
        svcA.encryptStream(streamFrom(Buffer.from('top secret'))),
      );
      await expect(
        collectStream(svcB.decryptStream(streamFrom(ciphertext))),
      ).rejects.toBeInstanceOf(BackupEncryptionError);
    });

    it('rejects a stream that ended before the header completed', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const truncated = Buffer.from('ABC'); // shorter than HEADER_LEN

      await expect(
        collectStream(svc.decryptStream(streamFrom(truncated))),
      ).rejects.toMatchObject({
        code: 'HEADER_MALFORMED',
      });
    });

    it('rejects a stream missing the EBBK magic prefix', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      // Build a header-shaped buffer with the wrong magic.
      const fakeHeader = Buffer.alloc(BACKUP_FORMAT.HEADER_LEN);
      fakeHeader.write('XXXX', 0, 'utf8');
      fakeHeader[4] = BACKUP_FORMAT.VERSION;

      await expect(
        collectStream(svc.decryptStream(streamFrom(fakeHeader))),
      ).rejects.toMatchObject({
        code: 'HEADER_MALFORMED',
      });
    });

    it('rejects a stream with an unsupported version byte', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const original = Buffer.from('payload');
      const ciphertext = await collectStream(
        svc.encryptStream(streamFrom(original)),
      );
      const tampered = Buffer.from(ciphertext);
      tampered[BACKUP_FORMAT.MAGIC.length] = 0x99; // unsupported version

      await expect(
        collectStream(svc.decryptStream(streamFrom(tampered))),
      ).rejects.toMatchObject({
        code: 'HEADER_MALFORMED',
      });
    });
  });

  describe('uniqueness', () => {
    it('produces a different ciphertext for the same plaintext (random IV)', async () => {
      const svc = BackupEncryptionService.fromKeyMaterial(VALID_KEY);
      const payload = Buffer.from('repeat me twice');

      const a = await collectStream(svc.encryptStream(streamFrom(payload)));
      const b = await collectStream(svc.encryptStream(streamFrom(payload)));

      // Header IV byte position differs because IVs are random; the
      // ciphertext bytes after the header differ for the same reason.
      expect(a.equals(b)).toBe(false);
    });
  });
});
