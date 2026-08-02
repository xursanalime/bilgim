/**
 * Unit tests for the field-level AES-256-GCM `EncryptionService`
 * (Task 28.1).
 *
 * Coverage of the task brief:
 *   - Boot guard rejects short / missing keys.
 *   - AAD mismatch fails decrypt.
 *   - Version prefix is enforced on decrypt.
 *   - Empty string round-trip works.
 *
 * Property-style invariants (round-trip across many random inputs,
 * tampering detection, IV randomness) live in the sibling
 * `encryption.property.spec.ts` so each suite stays focused.
 *
 * Validates: Requirements 28.1, 28.3.
 */

import { randomBytes } from 'node:crypto';

import {
  ENCRYPTION_KEY_ENV_VAR,
  ENVELOPE_VERSION,
  EncryptionService,
  decodeEncryptionKey,
} from './encryption.service';

const MASTER_KEY_HEX = randomBytes(32).toString('hex');
const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, 'hex');

function makeService(key: Buffer = MASTER_KEY): EncryptionService {
  return new EncryptionService(key);
}

// ---------------------------------------------------------------------------
// decodeEncryptionKey — boot validation
// ---------------------------------------------------------------------------

describe('decodeEncryptionKey — boot guard', () => {
  it('decodes a 64-char hex string into a 32-byte buffer', () => {
    const decoded = decodeEncryptionKey(MASTER_KEY_HEX);
    expect(decoded.length).toBe(32);
    expect(decoded.equals(MASTER_KEY)).toBe(true);
  });

  it('accepts upper- and lower-case hex equivalently', () => {
    const upper = decodeEncryptionKey(MASTER_KEY_HEX.toUpperCase());
    const lower = decodeEncryptionKey(MASTER_KEY_HEX.toLowerCase());
    expect(upper.equals(lower)).toBe(true);
  });

  it.each([undefined, '', '   '])(
    'throws when the value is missing / blank (%p)',
    (value) => {
      expect(() => decodeEncryptionKey(value as string | undefined)).toThrow(
        new RegExp(`${ENCRYPTION_KEY_ENV_VAR} is required`),
      );
    },
  );

  it('throws when the value contains non-hex characters', () => {
    // 64 chars but `g` is outside [0-9a-f].
    const garbage = 'g'.repeat(64);
    expect(() => decodeEncryptionKey(garbage)).toThrow(
      /must be hex-encoded/i,
    );
  });

  it('throws when the value decodes to fewer than 32 bytes', () => {
    const tooShort = '00'.repeat(16); // 16 bytes
    expect(() => decodeEncryptionKey(tooShort)).toThrow(
      /must decode to exactly 32 bytes/,
    );
  });

  it('throws when the value decodes to more than 32 bytes', () => {
    const tooLong = '00'.repeat(48); // 48 bytes
    expect(() => decodeEncryptionKey(tooLong)).toThrow(
      /must decode to exactly 32 bytes/,
    );
  });
});

// ---------------------------------------------------------------------------
// Constructor / fromEnv — boot guard at the service layer
// ---------------------------------------------------------------------------

describe('EncryptionService — constructor guard', () => {
  it('refuses a non-Buffer key', () => {
    expect(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new EncryptionService(MASTER_KEY_HEX as any),
    ).toThrow(/must be a Buffer/i);
  });

  it('refuses a key shorter than 32 bytes', () => {
    expect(() => new EncryptionService(randomBytes(16))).toThrow(
      /must be exactly 32 bytes/i,
    );
  });

  it('refuses a key longer than 32 bytes', () => {
    expect(() => new EncryptionService(randomBytes(48))).toThrow(
      /must be exactly 32 bytes/i,
    );
  });

  it('accepts a 32-byte buffer', () => {
    expect(() => new EncryptionService(MASTER_KEY)).not.toThrow();
  });

  describe('fromEnv', () => {
    it('builds a working service from a valid ENCRYPTION_KEY env value', () => {
      const svc = EncryptionService.fromEnv({
        [ENCRYPTION_KEY_ENV_VAR]: MASTER_KEY_HEX,
      } as NodeJS.ProcessEnv);
      const env = svc.encrypt('hello');
      expect(svc.decrypt(env)).toBe('hello');
    });

    it('throws when ENCRYPTION_KEY is missing', () => {
      expect(() =>
        EncryptionService.fromEnv({} as NodeJS.ProcessEnv),
      ).toThrow(new RegExp(`${ENCRYPTION_KEY_ENV_VAR} is required`));
    });

    it('throws when ENCRYPTION_KEY has the wrong length', () => {
      expect(() =>
        EncryptionService.fromEnv({
          [ENCRYPTION_KEY_ENV_VAR]: 'deadbeef',
        } as NodeJS.ProcessEnv),
      ).toThrow(/must decode to exactly 32 bytes/);
    });
  });
});

// ---------------------------------------------------------------------------
// Round-trip examples
// ---------------------------------------------------------------------------

describe('EncryptionService — round-trip', () => {
  it('round-trips a simple ASCII string', () => {
    const svc = makeService();
    const env = svc.encrypt('hello, world');
    expect(svc.decrypt(env)).toBe('hello, world');
  });

  it('round-trips an empty string and emits a non-empty envelope', () => {
    const svc = makeService();
    const env = svc.encrypt('');
    // Structural shape: v1:<iv>:<tag>:<empty-ciphertext>
    expect(env).toMatch(
      new RegExp(`^${ENVELOPE_VERSION}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:$`),
    );
    expect(svc.decrypt(env)).toBe('');
  });

  it('round-trips unicode, emoji, and embedded NUL bytes', () => {
    const svc = makeService();
    const cases = [
      'O‘zbekiston',
      'Привет мир',
      '你好世界',
      '👨‍👩‍👧‍👦 family',
      '\u0000nul-byte\u0000inside',
      'tabs\tand\nnewlines\r',
      'a'.repeat(10_000),
    ];
    for (const value of cases) {
      expect(svc.decrypt(svc.encrypt(value))).toBe(value);
    }
  });

  it('emits the current version prefix', () => {
    const svc = makeService();
    expect(svc.encrypt('x').startsWith(`${ENVELOPE_VERSION}:`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AAD context binding
// ---------------------------------------------------------------------------

describe('EncryptionService — AAD context binding', () => {
  it('round-trips when the same aad is supplied on both sides', () => {
    const svc = makeService();
    const env = svc.encrypt('+998901234567', 'user:u-123');
    expect(svc.decrypt(env, 'user:u-123')).toBe('+998901234567');
  });

  it('fails decrypt when aad differs from the value used at encrypt time', () => {
    const svc = makeService();
    const env = svc.encrypt('confidential', 'user:alice');
    expect(() => svc.decrypt(env, 'user:bob')).toThrow(
      /authentication tag mismatch/i,
    );
  });

  it('fails decrypt when an aad-bound envelope is decrypted without aad', () => {
    const svc = makeService();
    const env = svc.encrypt('confidential', 'user:alice');
    expect(() => svc.decrypt(env)).toThrow(/authentication tag mismatch/i);
  });

  it('fails decrypt when a no-aad envelope is decrypted with an aad', () => {
    const svc = makeService();
    const env = svc.encrypt('plain');
    expect(() => svc.decrypt(env, 'user:alice')).toThrow(
      /authentication tag mismatch/i,
    );
  });

  it('treats empty aad and missing aad as equivalent (no binding)', () => {
    // The service skips `setAAD` when the supplied value is an empty
    // string, so an envelope produced with `aad=''` must round-trip
    // either with `''` or no second argument at all.
    const svc = makeService();
    const env = svc.encrypt('plain', '');
    expect(svc.decrypt(env)).toBe('plain');
    expect(svc.decrypt(env, '')).toBe('plain');
  });
});

// ---------------------------------------------------------------------------
// Version prefix enforcement
// ---------------------------------------------------------------------------

describe('EncryptionService — version prefix enforcement', () => {
  it('rejects an envelope whose version prefix is unknown', () => {
    const svc = makeService();
    const env = svc.encrypt('hello');
    const future = env.replace(`${ENVELOPE_VERSION}:`, 'v99:');
    expect(future).not.toBe(env);
    expect(() => svc.decrypt(future)).toThrow(
      /unsupported envelope version/i,
    );
  });

  it('rejects an envelope with no version segment at all', () => {
    const svc = makeService();
    expect(() => svc.decrypt('not-an-envelope')).toThrow(
      /malformed envelope/i,
    );
  });

  it('rejects an envelope with the wrong number of segments', () => {
    const svc = makeService();
    const env = svc.encrypt('x');
    const truncated = env.split(':').slice(0, 3).join(':');
    expect(() => svc.decrypt(truncated)).toThrow(
      /expected 4 segments/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Structural / cross-instance behaviour
// ---------------------------------------------------------------------------

describe('EncryptionService — structural behaviour', () => {
  it('rejects an empty envelope string', () => {
    const svc = makeService();
    expect(() => svc.decrypt('')).toThrow(/non-empty envelope/i);
  });

  it('rejects a non-string plaintext at encrypt time', () => {
    const svc = makeService();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc.encrypt(123 as any),
    ).toThrow(/string plaintext/i);
  });

  it('round-trips across different service instances with the same key', () => {
    const a = makeService();
    const b = new EncryptionService(MASTER_KEY);
    expect(b.decrypt(a.encrypt('shared'))).toBe('shared');
  });

  it('cannot decrypt with a different master key', () => {
    const a = makeService();
    const b = makeService(randomBytes(32));
    expect(() => b.decrypt(a.encrypt('cross-tenant'))).toThrow(
      /authentication tag mismatch/i,
    );
  });

  it('isEnvelope distinguishes versioned envelopes from plaintext', () => {
    const svc = makeService();
    const env = svc.encrypt('hi');
    expect(svc.isEnvelope(env)).toBe(true);
    expect(svc.isEnvelope('not an envelope')).toBe(false);
    expect(svc.isEnvelope('')).toBe(false);
    expect(svc.isEnvelope(null)).toBe(false);
    expect(svc.isEnvelope(undefined)).toBe(false);
    expect(svc.isEnvelope(42)).toBe(false);
  });
});
