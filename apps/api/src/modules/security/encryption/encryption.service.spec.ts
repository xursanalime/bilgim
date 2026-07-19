import { randomBytes } from 'node:crypto';
import fc from 'fast-check';

import {
  EncryptionService,
  EncryptionKeyManager,
  EncryptionError,
  CURRENT_ENVELOPE_VERSION,
} from './encryption.service';

/**
 * Task 28.1 — SecurityModule-scoped wiring tests for the
 * encryption surface re-exported under
 * `modules/security/encryption/*`.
 *
 * The full unit-test matrix for `EncryptionService` lives next to
 * the implementation in
 * `common/crypto/encryption.service.spec.ts`. These tests focus on
 * the four contract guarantees called out by the Task 28.1 brief:
 *
 *   1. Round-trip: encrypt → decrypt returns the original plaintext.
 *   2. Idempotent encrypt — already-ciphertext stays ciphertext when
 *      passed through the Prisma extension's pre-write check.
 *   3. Random IV per call — same plaintext yields distinct envelopes.
 *   4. Tampered ciphertext fails to decrypt (auth-tag verification).
 *
 * The re-export module is the only seam under test here; if a future
 * refactor moves the implementation behind the SecurityModule path
 * the contract still holds because every assertion exercises the
 * public API.
 */

function makeService(masterKey: Buffer = randomBytes(32)): EncryptionService {
  const manager = new EncryptionKeyManager(masterKey);
  return new EncryptionService(manager);
}

describe('modules/security/encryption — Task 28.1 contract', () => {
  describe('round-trip (Property 19 baseline)', () => {
    it('encrypt → decrypt returns the original plaintext', () => {
      const enc = makeService();
      const inputs = [
        '+998901234567',
        'Tashkent, Mustaqillik 1',
        '4242 4242 4242 4242',
        'Привет мир',
        '👨‍👩‍👧‍👦 family',
        '',
        'a'.repeat(2_000),
      ];
      for (const input of inputs) {
        expect(enc.decrypt(enc.encrypt(input))).toBe(input);
      }
    });

    it('Property 19: correctly round-trips any string', () => {
      const enc = makeService();
      fc.assert(
        fc.property(fc.string(), (input: string) => {
          expect(enc.decrypt(enc.encrypt(input))).toBe(input);
        }),
      );
    });

    it('emits the active envelope version prefix', () => {
      const enc = makeService();
      const envelope = enc.encrypt('hello');
      expect(envelope.startsWith(`${CURRENT_ENVELOPE_VERSION}.`)).toBe(
        true,
      );
    });
  });

  describe('idempotent encrypt detection', () => {
    it('isEnvelope flags ciphertext so the Prisma extension can skip re-encryption', () => {
      const enc = makeService();
      const cipher = enc.encrypt('+998901234567');

      // Already-encrypted values are detected so the extension
      // returns `undefined` from `encryptValue` (no double encryption).
      expect(enc.isEnvelope(cipher)).toBe(true);

      // Plaintext-shaped strings are NOT considered envelopes.
      expect(enc.isEnvelope('+998901234567')).toBe(false);
      expect(enc.isEnvelope('plain text')).toBe(false);
      expect(enc.isEnvelope(null)).toBe(false);
      expect(enc.isEnvelope(undefined)).toBe(false);
    });

    it('round-trips an already-encrypted envelope unchanged', () => {
      const enc = makeService();
      const original = 'restricted PII';
      const cipher = enc.encrypt(original);
      // Decrypting twice via fresh references still yields the
      // original — no in-place mutation, no key drift.
      expect(enc.decrypt(cipher)).toBe(original);
      expect(enc.decrypt(cipher)).toBe(original);
    });
  });

  describe('random IV per encrypt', () => {
    it('produces distinct ciphertexts for the same plaintext', () => {
      const enc = makeService();
      const a = enc.encrypt('+998901234567');
      const b = enc.encrypt('+998901234567');
      // Random 96-bit IV makes a collision astronomically unlikely.
      expect(a).not.toBe(b);
      expect(enc.decrypt(a)).toBe('+998901234567');
      expect(enc.decrypt(b)).toBe('+998901234567');
    });

    it('IV segments differ across 25 successive encrypts', () => {
      const enc = makeService();
      const ivSegments = new Set<string>();
      for (let i = 0; i < 25; i++) {
        const envelope = enc.encrypt('Tashkent, Mustaqillik 1');
        const iv = envelope.split('.')[1];
        expect(iv).toBeTruthy();
        ivSegments.add(iv!);
      }
      expect(ivSegments.size).toBe(25);
    });
  });

  describe('tamper detection (auth-tag verification)', () => {
    it('flips a tag byte → INVALID_AUTHENTICATION_TAG', () => {
      const enc = makeService();
      const envelope = enc.encrypt('+998901234567');
      const parts = envelope.split('.');
      expect(parts).toHaveLength(4);

      const tag = Buffer.from(parts[3]!, 'base64');
      tag[0] = (tag[0]! ^ 0x01) & 0xff;
      const tampered = [
        parts[0],
        parts[1],
        parts[2],
        tag.toString('base64'),
      ].join('.');

      try {
        enc.decrypt(tampered);
        throw new Error('expected EncryptionError');
      } catch (err) {
        expect(err).toBeInstanceOf(EncryptionError);
        expect((err as EncryptionError).code).toBe(
          'INVALID_AUTHENTICATION_TAG',
        );
      }
    });

    it('flips a ciphertext byte → INVALID_AUTHENTICATION_TAG', () => {
      const enc = makeService();
      const envelope = enc.encrypt('Tashkent, Mustaqillik 1');
      const parts = envelope.split('.');
      const ct = Buffer.from(parts[2]!, 'base64');
      expect(ct.length).toBeGreaterThan(0);
      ct[0] = (ct[0]! ^ 0x01) & 0xff;
      const tampered = [
        parts[0],
        parts[1],
        ct.toString('base64'),
        parts[3],
      ].join('.');

      try {
        enc.decrypt(tampered);
        throw new Error('expected EncryptionError');
      } catch (err) {
        expect(err).toBeInstanceOf(EncryptionError);
        expect((err as EncryptionError).code).toBe(
          'INVALID_AUTHENTICATION_TAG',
        );
      }
    });

    it('decryption with a different master key fails closed', () => {
      const a = makeService(randomBytes(32));
      const b = makeService(randomBytes(32));
      const envelope = a.encrypt('cross-tenant secret');
      try {
        b.decrypt(envelope);
        throw new Error('expected EncryptionError');
      } catch (err) {
        expect(err).toBeInstanceOf(EncryptionError);
        expect((err as EncryptionError).code).toBe(
          'INVALID_AUTHENTICATION_TAG',
        );
      }
    });
  });
});
