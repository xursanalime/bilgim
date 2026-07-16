import { randomBytes } from 'node:crypto';

import {
  EncryptionService,
  EncryptionKeyManager,
} from './encryption.service';
import {
  createEncryptionAllOperationsHook,
  DEFAULT_ENCRYPTED_FIELDS,
} from './prisma-encryption.extension';

/**
 * Task 28.1 — SecurityModule-scoped wiring tests for the Prisma
 * column-encryption extension.
 *
 * The full write-path / read-path / rollout-safety matrix lives at
 * `common/crypto/prisma-encryption.extension.spec.ts`. These tests
 * cover the contract guarantee specific to the Task 28.1 mandate:
 * the default encrypted-field map must include every column called
 * out by Req 28.3.
 */

function makeService(): EncryptionService {
  return new EncryptionService(new EncryptionKeyManager(randomBytes(32)));
}

describe('modules/security/encryption — DEFAULT_ENCRYPTED_FIELDS', () => {
  it('covers every Req 28.3 column-level encryption mandate', () => {
    expect(DEFAULT_ENCRYPTED_FIELDS.User?.phone).toEqual({ kind: 'string' });
    expect(DEFAULT_ENCRYPTED_FIELDS.User?.address).toEqual({
      kind: 'string',
    });
    expect(
      DEFAULT_ENCRYPTED_FIELDS.PaymeTransaction?.cardLastFour,
    ).toEqual({ kind: 'string' });
    // Existing demonstration field — preserved for Phase 9 callers.
    expect(DEFAULT_ENCRYPTED_FIELDS.PaymeTransaction?.account).toEqual({
      kind: 'json',
    });
  });

  it('encrypts User.address via the default hook', async () => {
    const enc = makeService();
    const hook = createEncryptionAllOperationsHook(
      enc,
      DEFAULT_ENCRYPTED_FIELDS,
    );

    let addressAtDispatch = '';
    await hook({
      model: 'User',
      operation: 'create',
      args: {
        data: {
          email: 'user@example.com',
          phone: '+998901234567',
          address: 'Tashkent, Mustaqillik 1',
        },
      },
      query: async (a) => {
        addressAtDispatch = (a as { data: { address: string } }).data
          .address;
        return { id: 'u-1' };
      },
    });

    expect(addressAtDispatch).not.toBe('Tashkent, Mustaqillik 1');
    expect(addressAtDispatch).toMatch(/^v1\./);
    expect(enc.decrypt(addressAtDispatch)).toBe('Tashkent, Mustaqillik 1');
  });

  it('encrypts PaymeTransaction.cardLastFour via the default hook', async () => {
    const enc = makeService();
    const hook = createEncryptionAllOperationsHook(
      enc,
      DEFAULT_ENCRYPTED_FIELDS,
    );

    let cardAtDispatch = '';
    await hook({
      model: 'PaymeTransaction',
      operation: 'create',
      args: {
        data: {
          paymeId: 'pm-1',
          account: { user_id: 'u-1' },
          cardLastFour: '4242',
          amountUzs: 100_000,
          idempotencyKey: 'key-1',
        },
      },
      query: async (a) => {
        cardAtDispatch = (a as { data: { cardLastFour: string } }).data
          .cardLastFour;
        return { id: 'pm-1' };
      },
    });

    expect(cardAtDispatch).not.toBe('4242');
    expect(cardAtDispatch).toMatch(/^v1\./);
    expect(enc.decrypt(cardAtDispatch)).toBe('4242');
  });

  it('decrypts User.address and PaymeTransaction.cardLastFour on read', async () => {
    const enc = makeService();
    const hook = createEncryptionAllOperationsHook(
      enc,
      DEFAULT_ENCRYPTED_FIELDS,
    );

    const addressCipher = enc.encrypt('Tashkent, Mustaqillik 1');
    const cardCipher = enc.encrypt('4242');

    const userResult = await hook({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'u-1' } },
      query: async () => ({
        id: 'u-1',
        email: 'a@x',
        address: addressCipher,
      }),
    });
    expect((userResult as { address: string }).address).toBe(
      'Tashkent, Mustaqillik 1',
    );

    const txResult = await hook({
      model: 'PaymeTransaction',
      operation: 'findUnique',
      args: { where: { id: 'pm-1' } },
      query: async () => ({ id: 'pm-1', cardLastFour: cardCipher }),
    });
    expect((txResult as { cardLastFour: string }).cardLastFour).toBe(
      '4242',
    );
  });
});
