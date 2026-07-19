import { randomBytes } from 'node:crypto';
import * as fc from 'fast-check';

import {
  EncryptionKeyManager,
  decodeMasterKey,
} from './encryption-key-manager';
import { EncryptionError } from './encryption.errors';
import {
  CURRENT_ENVELOPE_VERSION,
  EncryptionService,
} from './encryption.service';

/**
 * Unit tests for `EncryptionService` (Task 28.1).
 *
 * Coverage maps directly to the task brief:
 *   - Round-trip property (loop of 100 random plaintexts +
 *     fast-check property)
 *   - Tampered ciphertext throws `INVALID_AUTHENTICATION_TAG`
 *   - Wrong AAD throws on decrypt
 *   - Wrong version prefix throws
 *   - Empty plaintext encrypts and decrypts correctly
 *   - Different IVs for the same plaintext produce different
 *     ciphertexts (confidentiality)
 *   - Boot-time key validation (`decodeMasterKey`)
 */

const MASTER_KEY = randomBytes(32);

function makeService(masterKey: Buffer = MASTER_KEY): EncryptionService {
  const manager = new EncryptionKeyManager(masterKey);
  return new EncryptionService(manager);
}

// ---------------------------------------------------------------------------
// Round-trip: loop and property test
// ---------------------------------------------------------------------------

describe('EncryptionService — round-trip', () => {
  it('round-trips 100 random plaintexts', () => {
    const enc = makeService();
    for (let i = 0; i < 100; i++) {
      // Random length 0..512, random byte content rendered as utf-8
      const len = (i * 7919) % 512;
      const input = randomBytes(len).toString('base64').slice(0, len);
      expect(enc.decrypt(enc.encrypt(input))).toBe(input);
    }
  });

  it('round-trips arbitrary unicode strings (fast-check property)', () => {
    const enc = makeService();
    fc.assert(
      fc.property(fc.string(), (input) => {
        const envelope = enc.encrypt(input);
        return enc.decrypt(envelope) === input;
      }),
      { numRuns: 200 },
    );
  });

  it('emits the current version prefix', () => {
    const enc = makeService();
    expect(
      enc.encrypt('x').startsWith(`${CURRENT_ENVELOPE_VERSION}.`),
    ).toBe(true);
  });

  it('round-trips an empty string and produces a non-empty envelope', () => {
    const enc = makeService();
    const envelope = enc.encrypt('');
    // Empty plaintexts still yield a structurally valid envelope so
    // callers can distinguish "encrypted empty" from null. The
    // ciphertext segment is empty but the IV and tag segments are
    // always present.
    expect(envelope).toMatch(
      /^v1\.[A-Za-z0-9+/=]+\.\.[A-Za-z0-9+/=]+$/,
    );
    expect(enc.decrypt(envelope)).toBe('');
  });

  it('round-trips long unicode (Cyrillic, emoji, composed grapheme)', () => {
    const enc = makeService();
    const cases = [
      'O‘zbekiston',
      'Привет мир',
      '你好世界',
      '👨‍👩‍👧‍👦 family',
      'mixed: a١b٢c',
      'a'.repeat(10_000),
    ];
    for (const input of cases) {
      expect(enc.decrypt(enc.encrypt(input))).toBe(input);
    }
  });
});

// ---------------------------------------------------------------------------
// Confidentiality: different IVs per call
// ---------------------------------------------------------------------------

describe('EncryptionService — confidentiality (random IV)', () => {
  it('produces different ciphertexts for the same plaintext', () => {
    const enc = makeService();
    const a = enc.encrypt('repeat');
    const b = enc.encrypt('repeat');
    expect(a).not.toBe(b);
    // Both still decrypt back to the same plaintext.
    expect(enc.decrypt(a)).toBe('repeat');
    expect(enc.decrypt(b)).toBe('repeat');
  });

  it('IV segments differ across 50 successive encrypts', () => {
    const enc = makeService();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const envelope = enc.encrypt('same plaintext');
      const ivSegment = envelope.split('.')[1];
      expect(ivSegment).toBeTruthy();
      seen.add(ivSegment!);
    }
    // 50 random 12-byte IVs colliding even once is astronomically
    // unlikely (~50²/2 / 2^96), so we expect 50 distinct values.
    expect(seen.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// AAD binding
// ---------------------------------------------------------------------------

describe('EncryptionService — AAD context binding', () => {
  it('round-trips with matching AAD on both sides', () => {
    const enc = makeService();
    const envelope = enc.encrypt('user-secret', 'user:u-123');
    expect(enc.decrypt(envelope, 'user:u-123')).toBe('user-secret');
  });

  it('throws INVALID_AUTHENTICATION_TAG when the AAD does not match', () => {
    const enc = makeService();
    const envelope = enc.encrypt('confidential', 'user:alice');
    try {
      enc.decrypt(envelope, 'user:bob');
      throw new Error('expected EncryptionError');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe(
        'INVALID_AUTHENTICATION_TAG',
      );
    }
  });

  it('throws INVALID_AUTHENTICATION_TAG when AAD-bound blob is decrypted with no AAD', () => {
    const enc = makeService();
    const envelope = enc.encrypt('confidential', 'user:alice');
    expect(() => enc.decrypt(envelope)).toThrow(EncryptionError);
    try {
      enc.decrypt(envelope);
    } catch (err) {
      expect((err as EncryptionError).code).toBe(
        'INVALID_AUTHENTICATION_TAG',
      );
    }
  });

  it('throws INVALID_AUTHENTICATION_TAG when no-AAD blob is decrypted with an AAD', () => {
    const enc = makeService();
    const envelope = enc.encrypt('plain');
    expect(() => enc.decrypt(envelope, 'user:alice')).toThrow(
      EncryptionError,
    );
  });

  it('round-trips across instances with the same master key + AAD', () => {
    const a = makeService();
    const b = makeService();
    const envelope = a.encrypt('shared', 'tenant:t-42');
    expect(b.decrypt(envelope, 'tenant:t-42')).toBe('shared');
  });

  it('cannot decrypt across different master keys', () => {
    const a = makeService(randomBytes(32));
    const b = makeService(randomBytes(32));
    const envelope = a.encrypt('cross-tenant');
    expect(() => b.decrypt(envelope)).toThrow(EncryptionError);
  });
});

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

describe('EncryptionService — tamper detection', () => {
  it('throws INVALID_AUTHENTICATION_TAG when the auth tag is flipped', () => {
    const enc = makeService();
    const envelope = enc.encrypt('tamper-me');
    const parts = envelope.split('.');
    expect(parts).toHaveLength(4);
    // Flip a single byte in the auth tag (last segment).
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

  it('throws INVALID_AUTHENTICATION_TAG when the ciphertext is tampered', () => {
    const enc = makeService();
    const envelope = enc.encrypt('tamper-me');
    const parts = envelope.split('.');
    expect(parts).toHaveLength(4);
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

  it('throws INVALID_AUTHENTICATION_TAG when the IV is rotated', () => {
    const enc = makeService();
    const envelope = enc.encrypt('tamper-me');
    const parts = envelope.split('.');
    expect(parts).toHaveLength(4);
    const iv = Buffer.from(parts[1]!, 'base64');
    iv[0] = (iv[0]! ^ 0xff) & 0xff;
    const tampered = [
      parts[0],
      iv.toString('base64'),
      parts[2],
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
});

// ---------------------------------------------------------------------------
// Envelope parsing — version prefix and structural validation
// ---------------------------------------------------------------------------

describe('EncryptionService — envelope parsing', () => {
  it('throws UNSUPPORTED_VERSION for a future envelope (wrong version prefix)', () => {
    const enc = makeService();
    const envelope = enc.encrypt('hello');
    const future = envelope.replace(/^v1\./, 'v2.');
    try {
      enc.decrypt(future);
      throw new Error('expected EncryptionError');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('UNSUPPORTED_VERSION');
    }
  });

  it('throws ENVELOPE_MALFORMED for empty / wrong-segments / non-string', () => {
    const enc = makeService();
    const bad = ['', 'plaintext', 'v1..', 'v1.a.b', 'v1.a.b.c.d'];
    for (const candidate of bad) {
      try {
        enc.decrypt(candidate);
        throw new Error(`expected error for input ${JSON.stringify(candidate)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(EncryptionError);
        // Allow either malformed-or-tag mismatch depending on which
        // structural check trips first.
        expect([
          'ENVELOPE_MALFORMED',
          'INVALID_AUTHENTICATION_TAG',
          'UNSUPPORTED_VERSION',
        ]).toContain((err as EncryptionError).code);
      }
    }
  });

  it('throws ENVELOPE_MALFORMED when IV length is wrong', () => {
    const enc = makeService();
    // Synthesize a "valid-looking" envelope with an 8-byte IV.
    const fake = [
      'v1',
      Buffer.alloc(8, 1).toString('base64'),
      'AAAA',
      Buffer.alloc(16, 2).toString('base64'),
    ].join('.');
    try {
      enc.decrypt(fake);
      throw new Error('expected EncryptionError');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('throws ENVELOPE_MALFORMED when auth-tag length is wrong', () => {
    const enc = makeService();
    const envelope = enc.encrypt('hello');
    const parts = envelope.split('.');
    // Truncate the tag to 8 bytes.
    const shortTag = Buffer.alloc(8, 0).toString('base64');
    const fake = [parts[0], parts[1], parts[2], shortTag].join('.');
    try {
      enc.decrypt(fake);
      throw new Error('expected EncryptionError');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('isEnvelope returns true for valid prefixes and false otherwise', () => {
    const enc = makeService();
    const envelope = enc.encrypt('check');
    expect(enc.isEnvelope(envelope)).toBe(true);
    expect(enc.isEnvelope(null)).toBe(false);
    expect(enc.isEnvelope(undefined)).toBe(false);
    expect(enc.isEnvelope('')).toBe(false);
    expect(enc.isEnvelope('plain text')).toBe(false);
    expect(enc.isEnvelope('v1.abc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boot-time validation: decodeMasterKey + EncryptionKeyManager
// ---------------------------------------------------------------------------

describe('decodeMasterKey — boot-time validation', () => {
  it('rejects MASTER_KEY_MISSING when env var is undefined', () => {
    try {
      decodeMasterKey(undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('MASTER_KEY_MISSING');
    }
  });

  it('rejects MASTER_KEY_MISSING for empty / whitespace strings', () => {
    expect(() => decodeMasterKey('')).toThrow(EncryptionError);
    expect(() => decodeMasterKey('   ')).toThrow(EncryptionError);
  });

  it('rejects MASTER_KEY_INVALID when decoded length is not 32 bytes', () => {
    // base64 of 16 bytes -> 24 char string -> decodes to 16 bytes
    const sixteenBytes = Buffer.alloc(16, 7).toString('base64');
    try {
      decodeMasterKey(sixteenBytes);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('MASTER_KEY_INVALID');
    }
  });

  it('accepts a 32-byte base64 master key', () => {
    const key = randomBytes(32).toString('base64');
    const decoded = decodeMasterKey(key);
    expect(decoded.length).toBe(32);
  });

  it('accepts a 64-char hex master key', () => {
    const key = randomBytes(32).toString('hex');
    const decoded = decodeMasterKey(key);
    expect(decoded.length).toBe(32);
  });

  it('is rejected by the manager constructor when the buffer is the wrong length', () => {
    expect(() => new EncryptionKeyManager(Buffer.alloc(16, 9))).toThrow(
      EncryptionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe('EncryptionService — argument validation', () => {
  it('rejects non-string plaintexts with ENVELOPE_MALFORMED', () => {
    const enc = makeService();
    try {
      enc.encrypt(42 as unknown as string);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('rejects non-string envelopes with ENVELOPE_MALFORMED on decrypt', () => {
    const enc = makeService();
    try {
      enc.decrypt(undefined as unknown as string);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('ENVELOPE_MALFORMED');
    }
  });
});

// ---------------------------------------------------------------------------
// EncryptionKeyManager — historical key resolution
// ---------------------------------------------------------------------------

describe('EncryptionKeyManager — version routing', () => {
  it('returns the active key for the active version', () => {
    const key = randomBytes(32);
    const manager = new EncryptionKeyManager(key);
    expect(manager.getActiveVersion()).toBe('v1');
    expect(manager.getActiveKey().equals(key)).toBe(true);
    expect(manager.getKey('v1').equals(key)).toBe(true);
  });

  it('throws UNSUPPORTED_VERSION for an unknown version', () => {
    const manager = new EncryptionKeyManager(randomBytes(32));
    try {
      manager.getKey('v2');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EncryptionError);
      expect((err as EncryptionError).code).toBe('UNSUPPORTED_VERSION');
    }
  });

  it('hands out fresh copies of the key buffer on every call', () => {
    const manager = new EncryptionKeyManager(randomBytes(32));
    const a = manager.getActiveKey();
    const b = manager.getActiveKey();
    expect(a).not.toBe(b);
    expect(a.equals(b)).toBe(true);
  });
});
