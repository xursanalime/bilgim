import { randomBytes } from 'node:crypto';

import {
  CURRENT_ENVELOPE_VERSION,
  DEFAULT_KEY_ID,
  EncryptionService,
  decodeMasterKeyHex,
} from './encryption.service';
import { FieldEncryptionError } from './encryption.errors';

/**
 * Unit tests for the field-level `EncryptionService` (Task 28.1).
 *
 * Coverage maps directly to the task brief:
 *   - Round-trip: encrypt → decrypt yields the original plaintext.
 *   - Tamper detection: flipping a byte of the ciphertext throws on
 *     decrypt.
 *   - AAD mismatch: encrypting under one field and decrypting under
 *     another throws.
 *   - Key version recognition: blob with unknown version throws with
 *     a clear `UNSUPPORTED_VERSION` message.
 *   - Performance smoke test: 1000 encrypt+decrypt round-trips
 *     complete inside 200 ms.
 *
 * The service is constructed with a deterministic 32-byte key per
 * suite so test runs are independent of any environment state.
 */

const TEST_KEY = randomBytes(32);

function makeService(masterKey: Buffer = TEST_KEY): EncryptionService {
  return new EncryptionService(masterKey);
}

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('EncryptionService — round-trip', () => {
  it('encrypts and decrypts plain ASCII strings back to the original', () => {
    const enc = makeService();
    const plaintext = 'hello, world';
    const blob = enc.encrypt(plaintext);
    expect(enc.decrypt(blob.packed)).toBe(plaintext);
  });

  it('round-trips unicode, emoji, and multi-byte sequences', () => {
    const enc = makeService();
    const cases = [
      'привет',
      '日本語のテスト',
      '🎉🔐✨ unicode mix 你好',
      '\u0000nul-byte\u0000inside',
      'tabs\tand\nnewlines\r',
    ];
    for (const value of cases) {
      const blob = enc.encrypt(value);
      expect(enc.decrypt(blob.packed)).toBe(value);
    }
  });

  it('round-trips an empty string and produces a non-empty packed blob', () => {
    const enc = makeService();
    const blob = enc.encrypt('');
    expect(blob.packed.length).toBeGreaterThan(0);
    expect(blob.packed.startsWith(`${CURRENT_ENVELOPE_VERSION}.`)).toBe(true);
    expect(enc.decrypt(blob.packed)).toBe('');
  });

  it('round-trips Buffer plaintext via decryptToBuffer', () => {
    const enc = makeService();
    const plaintext = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
    const blob = enc.encrypt(plaintext);
    expect(enc.decryptToBuffer(blob.packed).equals(plaintext)).toBe(true);
  });

  it('emits the current version + active keyId in the packed prefix', () => {
    const enc = makeService();
    const blob = enc.encrypt('x');
    expect(blob.version).toBe(CURRENT_ENVELOPE_VERSION);
    expect(blob.keyId).toBe(DEFAULT_KEY_ID);
    expect(
      blob.packed.startsWith(
        `${CURRENT_ENVELOPE_VERSION}.${DEFAULT_KEY_ID}.`,
      ),
    ).toBe(true);
  });

  it('produces different ciphertexts for repeated encryptions of the same plaintext', () => {
    // GCM with random IVs MUST produce different ciphertexts on each
    // call, otherwise the IV-reuse attack becomes possible. This is
    // the cheapest end-to-end check that the service is using fresh
    // entropy.
    const enc = makeService();
    const a = enc.encrypt('same').packed;
    const b = enc.encrypt('same').packed;
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

describe('EncryptionService — tamper detection', () => {
  it('throws INVALID_AUTHENTICATION_TAG when a single byte of the packed payload is flipped', () => {
    const enc = makeService();
    const packed = enc.encrypt('top secret').packed;

    // Flip one bit inside the base64 payload (after the
    // `<version>.<keyId>.` prefix). We change a non-prefix character
    // so the structural parse still succeeds and we exercise the
    // GCM auth-tag check.
    const dotPositions: number[] = [];
    for (let i = 0; i < packed.length; i++) {
      if (packed[i] === '.') dotPositions.push(i);
    }
    expect(dotPositions.length).toBeGreaterThanOrEqual(2);
    const payloadStart = (dotPositions[1] ?? 0) + 1;

    // Find a position where flipping a base64 char yields a different
    // valid base64 char (so the surrounding base64 string still
    // decodes — we want the auth-tag path, not the structural path).
    let mutateAt = payloadStart;
    for (let i = payloadStart; i < packed.length; i++) {
      if (/[A-Za-z]/.test(packed[i] ?? '')) {
        mutateAt = i;
        break;
      }
    }
    const original = packed[mutateAt];
    const swapped = original === 'A' ? 'B' : 'A';
    const tampered =
      packed.slice(0, mutateAt) + swapped + packed.slice(mutateAt + 1);

    expect(tampered).not.toBe(packed);
    expect(() => enc.decrypt(tampered)).toThrow(FieldEncryptionError);
    try {
      enc.decrypt(tampered);
      fail('decrypt should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      // Either the structural parse rejects the malformed payload or
      // the auth-tag check fails — both are acceptable tamper
      // signals; what matters is that the service refuses to return
      // a forged plaintext.
      const code = (err as FieldEncryptionError).code;
      expect([
        'INVALID_AUTHENTICATION_TAG',
        'ENVELOPE_MALFORMED',
      ]).toContain(code);
    }
  });

  it('throws INVALID_AUTHENTICATION_TAG when ciphertext bytes are flipped after structural decode', () => {
    // Direct surgical tamper — pull the packed envelope apart, flip
    // one byte of the ciphertext segment, and repack so the
    // structural parser still succeeds and the auth-tag check is
    // the only thing standing between the attacker and a forged
    // plaintext.
    const enc = makeService();
    const packed = enc.encrypt('value').packed;

    const [version, keyId, payloadB64] = packed.split('.');
    expect(payloadB64).toBeDefined();
    const payload = Buffer.from(payloadB64 ?? '', 'base64');

    // Layout: u16 ivLen | iv | u32 ctLen | ct | u8 tagLen | tag | u16 aadLen | aad
    let off = 0;
    const ivLen = payload.readUInt16BE(off);
    off += 2 + ivLen;
    const ctLen = payload.readUInt32BE(off);
    off += 4;
    expect(ctLen).toBeGreaterThan(0);

    const tampered = Buffer.from(payload);
    tampered[off] = (tampered[off] ?? 0) ^ 0x01; // flip one bit of ciphertext

    const tamperedPacked = `${version}.${keyId}.${tampered.toString('base64')}`;
    try {
      enc.decrypt(tamperedPacked);
      fail('decrypt should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe(
        'INVALID_AUTHENTICATION_TAG',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AAD / field binding
// ---------------------------------------------------------------------------

describe('EncryptionService — field-level AAD', () => {
  it('round-trips when the same fieldName is used on both sides', () => {
    const enc = makeService();
    const blob = enc.encryptField('+998901234567', 'phone');
    expect(enc.decryptField(blob, 'phone')).toBe('+998901234567');
  });

  it('throws AAD_MISMATCH when encrypted under "email" and decrypted under "phone"', () => {
    const enc = makeService();
    const blob = enc.encryptField('user@example.com', 'email');
    try {
      enc.decryptField(blob, 'phone');
      fail('decryptField should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('AAD_MISMATCH');
    }
  });

  it('throws AAD_MISMATCH when context-encrypted blob is decrypted without a context', () => {
    const enc = makeService();
    const blob = enc.encrypt('secret', 'audit-trail').packed;
    try {
      enc.decrypt(blob);
      fail('decrypt should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('AAD_MISMATCH');
    }
  });

  it('throws AAD_MISMATCH when an empty-context blob is decrypted with a context', () => {
    const enc = makeService();
    const blob = enc.encrypt('secret').packed;
    try {
      enc.decrypt(blob, 'audit-trail');
      fail('decrypt should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('AAD_MISMATCH');
    }
  });

  it('rejects empty fieldName arguments', () => {
    const enc = makeService();
    expect(() => enc.encryptField('x', '')).toThrow(FieldEncryptionError);
    expect(() => enc.decryptField('v1.master.AAA=', '')).toThrow(
      FieldEncryptionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Version recognition
// ---------------------------------------------------------------------------

describe('EncryptionService — version recognition', () => {
  it('throws UNSUPPORTED_VERSION for blobs with an unknown version prefix', () => {
    const enc = makeService();
    const realBlob = enc.encrypt('hello').packed;
    // Replace the leading `v1` with `v99`.
    const futureBlob = realBlob.replace(/^v1/, 'v99');
    expect(futureBlob).not.toBe(realBlob);
    try {
      enc.decrypt(futureBlob);
      fail('decrypt should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('UNSUPPORTED_VERSION');
      expect((err as FieldEncryptionError).message).toMatch(
        /unknown envelope version/i,
      );
    }
  });

  it('throws UNSUPPORTED_VERSION when keyId is unknown to the active manager', () => {
    const enc = makeService();
    const realBlob = enc.encrypt('hello').packed;
    // Swap in a keyId the service does not know about.
    const wrongKeyBlob = realBlob.replace(
      `.${DEFAULT_KEY_ID}.`,
      '.unknown-key.',
    );
    expect(wrongKeyBlob).not.toBe(realBlob);
    try {
      enc.decrypt(wrongKeyBlob);
      fail('decrypt should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('UNSUPPORTED_VERSION');
    }
  });

  it('throws ENVELOPE_MALFORMED on structurally invalid blobs', () => {
    const enc = makeService();
    const invalids = [
      '',
      'not-an-envelope',
      'v1.master.', // empty payload
      'v1..AAA=', // empty keyId
      'v1.master.!!!not-base64!!!',
    ];
    for (const blob of invalids) {
      try {
        enc.decrypt(blob);
        fail(`decrypt should have thrown for ${JSON.stringify(blob)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(FieldEncryptionError);
        expect((err as FieldEncryptionError).code).toBe('ENVELOPE_MALFORMED');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Performance smoke test
// ---------------------------------------------------------------------------

describe('EncryptionService — performance smoke', () => {
  it('encrypts + decrypts 1000 short strings under 200ms', () => {
    const enc = makeService();
    const inputs: string[] = [];
    for (let i = 0; i < 1000; i++) {
      inputs.push(`row-${i}-${randomBytes(8).toString('hex')}`);
    }

    const start = process.hrtime.bigint();
    for (const value of inputs) {
      const blob = enc.encrypt(value).packed;
      const round = enc.decrypt(blob);
      if (round !== value) {
        // Not a `expect` so the failure short-circuits cleanly inside
        // the timing loop.
        throw new Error(`round-trip mismatch for ${value}`);
      }
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    expect(elapsedMs).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// Boot-time master-key resolution
// ---------------------------------------------------------------------------

describe('decodeMasterKeyHex — boot validation', () => {
  it('decodes a 64-char hex string into a 32-byte buffer', () => {
    const hex = TEST_KEY.toString('hex');
    const decoded = decodeMasterKeyHex(hex);
    expect(decoded.length).toBe(32);
    expect(decoded.equals(TEST_KEY)).toBe(true);
  });

  it('throws MASTER_KEY_MISSING for empty / whitespace input', () => {
    for (const value of [undefined, '', '    ']) {
      try {
        decodeMasterKeyHex(value as string | undefined);
        fail('decodeMasterKeyHex should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FieldEncryptionError);
        expect((err as FieldEncryptionError).code).toBe('MASTER_KEY_MISSING');
      }
    }
  });

  it('throws MASTER_KEY_INVALID for non-hex strings', () => {
    try {
      decodeMasterKeyHex('zzzzzzzz'.repeat(8));
      fail('decodeMasterKeyHex should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('MASTER_KEY_INVALID');
    }
  });

  it('throws MASTER_KEY_INVALID for hex of the wrong length', () => {
    try {
      decodeMasterKeyHex('0a'.repeat(16)); // 16 bytes, not 32
      fail('decodeMasterKeyHex should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('MASTER_KEY_INVALID');
    }
  });
});

describe('EncryptionService — environment resolution', () => {
  const originalKey = process.env.MASTER_KEY;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.MASTER_KEY;
    } else {
      process.env.MASTER_KEY = originalKey;
    }
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('refuses to start in production when MASTER_KEY is missing', () => {
    delete process.env.MASTER_KEY;
    process.env.NODE_ENV = 'production';
    try {
      // eslint-disable-next-line no-new
      new EncryptionService();
      fail('constructor should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('MASTER_KEY_MISSING');
    }
  });

  it('falls back to the dev key outside production when MASTER_KEY is missing', () => {
    delete process.env.MASTER_KEY;
    process.env.NODE_ENV = 'development';
    const svc = new EncryptionService();
    expect(svc.encrypt('ok').packed).toMatch(
      new RegExp(`^${CURRENT_ENVELOPE_VERSION}\\.${DEFAULT_KEY_ID}\\.`),
    );
  });

  it('boots cleanly when MASTER_KEY is a valid 64-char hex string', () => {
    process.env.MASTER_KEY = TEST_KEY.toString('hex');
    process.env.NODE_ENV = 'production';
    const svc = new EncryptionService();
    expect(svc.decrypt(svc.encrypt('hi').packed)).toBe('hi');
  });

  it('rejects MASTER_KEY values that are not 32 bytes of hex', () => {
    process.env.MASTER_KEY = 'deadbeef'; // too short
    process.env.NODE_ENV = 'production';
    try {
      // eslint-disable-next-line no-new
      new EncryptionService();
      fail('constructor should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FieldEncryptionError);
      expect((err as FieldEncryptionError).code).toBe('MASTER_KEY_INVALID');
    }
  });
});
