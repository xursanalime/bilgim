import { randomBytes } from 'node:crypto';
import fc from 'fast-check';

import { EncryptionService as MasterEncryptionService } from '../../../common/security/encryption/encryption.service';
import { KeyManagementService } from './key-management.service';
import { KmsEnvelopeService, KMS_ENVELOPE_VERSION } from './kms-envelope.service';
import type { KmsKey, KmsProvider } from './kms.port';

/**
 * Unit tests for `KmsEnvelopeService` (Task 28.2).
 *
 * Covers:
 *   - Round-trip encrypt → decrypt with the active key.
 *   - Embedded keyId can be extracted without decrypting.
 *   - Decryption succeeds against a previously-active key after
 *     rotation (zero-downtime read of historical rows).
 *   - AAD is bound — wrong AAD on decrypt fails the auth tag.
 *   - Backward-compat: v1 envelopes (master-key only) still decrypt.
 */

function makeKmsKey(id: string): KmsKey {
  return {
    id,
    material: randomBytes(32),
    status: 'ACTIVE',
    createdAt: new Date(),
    retiredAt: null,
    rotatedToId: null,
  };
}

class InMemoryProvider implements KmsProvider {
  active: KmsKey;
  history = new Map<string, KmsKey>();
  constructor(initial: KmsKey) {
    this.active = initial;
    this.history.set(initial.id, initial);
  }
  async getActiveKey() {
    return this.active;
  }
  async listKeys() {
    return [...this.history.values()];
  }
  async getKeyById(id: string) {
    return this.history.get(id) ?? null;
  }
  async createKey() {
    const next = makeKmsKey(`v${this.history.size + 1}`);
    this.active.status = 'RETIRED';
    this.history.set(next.id, next);
    this.active = next;
    return next;
  }
  async markRotated() {}
}

function makeStack() {
  const provider = new InMemoryProvider(makeKmsKey('k1'));
  const keyManagement = new KeyManagementService(provider);
  const envelope = new KmsEnvelopeService(keyManagement);
  return { provider, keyManagement, envelope };
}

describe('KmsEnvelopeService — round-trip', () => {
  it('Property 22: correctly round-trips any string under any AAD', async () => {
    const { envelope } = makeStack();
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.string(),
        async (input: string, aad: string) => {
          const ct = await envelope.encrypt(input, aad);
          expect(await envelope.decrypt(ct, aad)).toBe(input);
        },
      ),
    );
  });

  it('encrypts and decrypts strings under the active key', async () => {
    const { envelope } = makeStack();
    const ct = await envelope.encrypt('hello world');
    expect(ct.startsWith(`${KMS_ENVELOPE_VERSION}:`)).toBe(true);
    const pt = await envelope.decrypt(ct);
    expect(pt).toBe('hello world');
  });

  it('round-trips empty strings', async () => {
    const { envelope } = makeStack();
    const ct = await envelope.encrypt('');
    expect(await envelope.decrypt(ct)).toBe('');
  });

  it('embeds the active key id in a v2 envelope', async () => {
    const { envelope } = makeStack();
    const ct = await envelope.encrypt('payload');
    expect(envelope.extractKeyId(ct)).toBe('k1');
  });
});

describe('KmsEnvelopeService — rotation preserves access', () => {
  it('Property 22 (Rotation): preserves access to data after multiple rotations', async () => {
    const { envelope, keyManagement } = makeStack();
    const data = 'permanent-secret';
    const ct = await envelope.encrypt(data);

    // Rotate 5 times.
    for (let i = 0; i < 5; i++) {
      await keyManagement.rotate();
    }

    expect(await envelope.decrypt(ct)).toBe(data);
  });

  it('decrypts envelopes written under the previous key after rotation', async () => {
    const { envelope, keyManagement } = makeStack();
    const ct = await envelope.encrypt('legacy-row');
    await keyManagement.rotate();
    expect(envelope.extractKeyId(ct)).toBe('k1');
    const pt = await envelope.decrypt(ct);
    expect(pt).toBe('legacy-row');
  });

  it('newly-encrypted envelopes use the new active key id', async () => {
    const { envelope, keyManagement } = makeStack();
    await keyManagement.rotate();
    const ct = await envelope.encrypt('after-rotation');
    expect(envelope.extractKeyId(ct)).toBe('v2');
  });
});

describe('KmsEnvelopeService — AAD binding', () => {
  it('fails decrypt when AAD differs from encrypt-time value', async () => {
    const { envelope } = makeStack();
    const ct = await envelope.encrypt('secret', 'user:123');
    await expect(envelope.decrypt(ct, 'user:999')).rejects.toThrow();
  });

  it('round-trips when AAD matches', async () => {
    const { envelope } = makeStack();
    const ct = await envelope.encrypt('secret', 'user:123');
    expect(await envelope.decrypt(ct, 'user:123')).toBe('secret');
  });
});

describe('KmsEnvelopeService — backwards compat with v1 envelopes', () => {
  it('decrypts a legacy v1 envelope via the master-key service', async () => {
    const masterKey = randomBytes(32);
    const masterEncryption = new MasterEncryptionService(masterKey);
    const provider = new InMemoryProvider(makeKmsKey('k1'));
    const keyManagement = new KeyManagementService(provider);
    const envelope = new KmsEnvelopeService(keyManagement, masterEncryption);

    const v1 = masterEncryption.encryptField('legacy-payload', 'phone');
    expect(v1.startsWith('v1.')).toBe(true);
    expect(envelope.isEnvelope(v1)).toBe(true);

    const pt = await envelope.decrypt(v1, 'phone');
    expect(pt).toBe('legacy-payload');
  });

  it('refuses unknown envelope versions', async () => {
    const { envelope } = makeStack();
    await expect(envelope.decrypt('v999:fake')).rejects.toThrow();
  });
});

describe('KmsEnvelopeService — extractKeyId', () => {
  it('returns null for non-v2 inputs', async () => {
    const { envelope } = makeStack();
    expect(envelope.extractKeyId('plaintext')).toBeNull();
    expect(envelope.extractKeyId('v1.foo.bar')).toBeNull();
  });
});
