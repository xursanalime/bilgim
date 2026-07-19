import { randomBytes } from 'node:crypto';

import { EncryptionKeyManager } from './encryption-key-manager';
import { EncryptionService } from './encryption.service';
import {
  createEncryptionAllOperationsHook,
  DEFAULT_ENCRYPTED_FIELDS,
  EncryptedFieldMap,
  PrismaAllOperationsHook,
} from './prisma-encryption.extension';

/**
 * Unit tests for the Prisma encryption extension.
 *
 * The Prisma `defineExtension` API wraps the user-supplied callback in
 * an opaque function, so we exercise the underlying
 * `$allOperations` hook directly via `createEncryptionAllOperationsHook`
 * — that is the same function `defineExtension` ultimately calls at
 * runtime. This keeps the test independent of a live Postgres
 * connection while still validating the encrypt-on-write /
 * decrypt-on-read contract.
 */

function makeService(masterKey: Buffer): EncryptionService {
  return new EncryptionService(new EncryptionKeyManager(masterKey));
}

function getHook(
  enc: EncryptionService,
  fields: EncryptedFieldMap = DEFAULT_ENCRYPTED_FIELDS,
): PrismaAllOperationsHook {
  return createEncryptionAllOperationsHook(enc, fields);
}

const masterKey = randomBytes(32);

describe('createPrismaEncryptionExtension — write path', () => {
  it('encrypts User.phone before dispatch on create', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    let phoneAtDispatch = '';
    const result = await hook({
      model: 'User',
      operation: 'create',
      args: {
        data: {
          email: 'user@example.com',
          phone: '+998901234567',
          fullName: 'Demo User',
        },
      },
      query: async (a) => {
        // Capture the encrypted phone exactly at dispatch time. We
        // can't compare on the returned object because the read-side
        // pass will decrypt it back before the hook resolves.
        phoneAtDispatch = (a as any).data.phone;
        // Return a fresh row clone so the read-decrypt pass operates
        // on a separate object from the captured snapshot.
        return { ...(a as any).data };
      },
    });

    expect(phoneAtDispatch).not.toBe('+998901234567');
    expect(phoneAtDispatch).toMatch(/^v1\./);
    expect(enc.decrypt(phoneAtDispatch)).toBe('+998901234567');
    // The result returned to the caller has been decrypted on read.
    expect((result as any).phone).toBe('+998901234567');
    expect((result as any).email).toBe('user@example.com');
  });

  it('encrypts User.phone on update with `{ set: ... }` operator', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    let setAtDispatch: any;
    await hook({
      model: 'User',
      operation: 'update',
      args: {
        where: { id: 'u-1' },
        data: { phone: { set: '+998900000000' } },
      },
      query: async (a) => {
        setAtDispatch = (a as any).data.phone.set;
        return { id: 'u-1' };
      },
    });

    expect(setAtDispatch).toMatch(/^v1\./);
    expect(enc.decrypt(setAtDispatch)).toBe('+998900000000');
  });

  it('encrypts PaymeTransaction.account JSON on create', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const accountJson = { user_id: 'usr-7', phone: '+998900112233' };
    let accountAtDispatch = '';
    await hook({
      model: 'PaymeTransaction',
      operation: 'create',
      args: {
        data: {
          paymeId: 'pm-1',
          account: accountJson,
          amountUzs: 100_000,
          idempotencyKey: 'key-1',
        },
      },
      query: async (a) => {
        accountAtDispatch = (a as any).data.account;
        return { id: 'pm-1' };
      },
    });

    expect(typeof accountAtDispatch).toBe('string');
    expect(accountAtDispatch).toMatch(/^v1\./);
    expect(JSON.parse(enc.decrypt(accountAtDispatch))).toEqual(accountJson);
  });

  it('encrypts each row in createMany batches', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    let captured: Array<{ phone: unknown }> = [];
    await hook({
      model: 'User',
      operation: 'createMany',
      args: {
        data: [
          { email: 'a@x', phone: '+1' },
          { email: 'b@x', phone: '+2' },
          { email: 'c@x', phone: null },
        ],
      },
      query: async (a) => {
        // Snapshot the encrypted values before returning a fresh shape
        // unaffected by the read-side decrypt pass.
        const rows = (a as { data: Array<{ phone: unknown }> }).data;
        captured = rows.map((r) => ({ phone: r.phone }));
        return { count: rows.length };
      },
    });

    expect(captured[0]!.phone).toMatch(/^v1\./);
    expect(captured[1]!.phone).toMatch(/^v1\./);
    expect(captured[2]!.phone).toBeNull();
    expect(enc.decrypt(captured[0]!.phone as string)).toBe('+1');
    expect(enc.decrypt(captured[1]!.phone as string)).toBe('+2');
  });

  it('handles upsert(create + update) shape', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    let createAtDispatch = '';
    let updateAtDispatch = '';
    await hook({
      model: 'User',
      operation: 'upsert',
      args: {
        where: { id: 'u-2' },
        create: { email: 'u@x', phone: '+1112223333' },
        update: { phone: '+9998887777' },
      },
      query: async (a) => {
        createAtDispatch = (a as any).create.phone;
        updateAtDispatch = (a as any).update.phone;
        return { id: 'u-2' };
      },
    });

    expect(createAtDispatch).toMatch(/^v1\./);
    expect(updateAtDispatch).toMatch(/^v1\./);
    expect(enc.decrypt(createAtDispatch)).toBe('+1112223333');
    expect(enc.decrypt(updateAtDispatch)).toBe('+9998887777');
  });

  it('is idempotent — pre-encrypted values pass through unchanged', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const preEncrypted = enc.encrypt('+998777888999');
    let phoneAtDispatch = '';
    await hook({
      model: 'User',
      operation: 'create',
      args: {
        data: { email: 'a@x', phone: preEncrypted },
      },
      query: async (a) => {
        phoneAtDispatch = (a as any).data.phone;
        return { id: 'u-3' };
      },
    });

    // Already-encrypted values pass through unchanged (no double
    // encryption, no decryption attempt prior to dispatch).
    expect(phoneAtDispatch).toBe(preEncrypted);
  });

  it('passes through models that are not in the encrypted-field map', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    let snapshot: any;
    const result = await hook({
      model: 'Course',
      operation: 'create',
      args: { data: { title: 'Algebra', description: 'Lessons' } },
      query: async (a) => {
        snapshot = JSON.parse(JSON.stringify((a as any).data));
        return (a as any).data;
      },
    });

    expect(snapshot.title).toBe('Algebra');
    expect(snapshot.description).toBe('Lessons');
    expect((result as any).title).toBe('Algebra');
  });
});

describe('createPrismaEncryptionExtension — read path', () => {
  it('decrypts User.phone on a single-object result', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const phoneCipher = enc.encrypt('+998901234567');
    const result = await hook({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'u-1' } },
      query: async () => ({
        id: 'u-1',
        email: 'a@x',
        phone: phoneCipher,
      }),
    });

    expect((result as any).phone).toBe('+998901234567');
  });

  it('decrypts User.phone across an array (findMany)', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const result = await hook({
      model: 'User',
      operation: 'findMany',
      args: {},
      query: async () => [
        { id: 'u-1', phone: enc.encrypt('+998101010101') },
        { id: 'u-2', phone: enc.encrypt('+998202020202') },
        { id: 'u-3', phone: null },
      ],
    });

    const rows = result as any[];
    expect(rows[0].phone).toBe('+998101010101');
    expect(rows[1].phone).toBe('+998202020202');
    expect(rows[2].phone).toBeNull();
  });

  it('decrypts PaymeTransaction.account back to the original JSON', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const accountJson = { phone: '+998900112233', user_id: 'u-7' };
    const cipher = enc.encrypt(JSON.stringify(accountJson));
    const result = await hook({
      model: 'PaymeTransaction',
      operation: 'findUnique',
      args: { where: { id: 't-1' } },
      query: async () => ({ id: 't-1', account: cipher }),
    });

    expect((result as any).account).toEqual(accountJson);
  });

  it('passes through legacy plaintext rows untouched (rollout-safe)', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const result = await hook({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'u-1' } },
      query: async () => ({ id: 'u-1', phone: '+998000000000' }),
    });

    // No envelope prefix → extension leaves the value alone so the
    // backfill can run without breaking reads.
    expect((result as any).phone).toBe('+998000000000');
  });

  it('returns null/undefined results unchanged', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    const r1 = await hook({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'missing' } },
      query: async () => null,
    });
    expect(r1).toBeNull();
  });

  it('round-trips end-to-end via the extension hook (write → read)', async () => {
    const enc = makeService(masterKey);
    const hook = getHook(enc);

    let storedPhone = '';
    await hook({
      model: 'User',
      operation: 'create',
      args: { data: { email: 'a@x', phone: '+998923456789' } },
      query: async (a) => {
        storedPhone = (a as any).data.phone;
        return { id: 'u-1' };
      },
    });

    // Confirm the stored value is ciphertext.
    expect(storedPhone).toMatch(/^v1\./);

    // Now read it back via the same hook.
    const read = await hook({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'u-1' } },
      query: async () => ({ id: 'u-1', phone: storedPhone }),
    });

    expect((read as any).phone).toBe('+998923456789');
  });
});
