import { randomBytes } from 'node:crypto';

import { EncryptionService } from '../../../common/security/encryption/encryption.service';
import { LocalKmsProvider } from './local-kms.provider';

/**
 * Unit tests for `LocalKmsProvider` (Task 28.2).
 *
 * The provider talks to Prisma; we substitute a hand-rolled fake
 * `PrismaClient` that mirrors the EncryptionKey delegate so the
 * tests stay framework-light and don't need Postgres.
 *
 * Coverage:
 *   - Bootstrap: `getActiveKey()` lazily creates a fresh DEK on
 *     first use.
 *   - Rotation: a second `createKey()` retires the previous active
 *     row, links it via `rotatedToId`, and returns a new ACTIVE
 *     row.
 *   - Round-trip: every materialised key has 32 bytes of usable
 *     material (i.e. the wrap/unwrap path works against a real
 *     master key).
 *   - `markRotated` is idempotent.
 *   - `getKeyById` returns null for unknown ids.
 *   - `listKeys` orders rows by createdAt ascending.
 */

interface FakeRow {
  id: string;
  keyMaterial: string;
  status: 'ACTIVE' | 'RETIRED';
  rotatedToId: string | null;
  createdAt: Date;
  retiredAt: Date | null;
}

class FakePrismaClient {
  rows: FakeRow[] = [];
  private counter = 0;

  encryptionKey = {
    findFirst: async (args?: {
      where?: Partial<FakeRow>;
      orderBy?: { createdAt: 'asc' | 'desc' };
    }) => {
      const where = args?.where ?? {};
      let matches = this.rows.filter((r) =>
        Object.entries(where).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      );
      if (args?.orderBy?.createdAt === 'desc') {
        matches = [...matches].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      } else {
        matches = [...matches].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }
      return matches[0] ?? null;
    },
    findUnique: async (args: { where: { id: string } }) =>
      this.rows.find((r) => r.id === args.where.id) ?? null,
    findMany: async (args?: { orderBy?: { createdAt: 'asc' | 'desc' } }) => {
      const order = args?.orderBy?.createdAt === 'desc' ? -1 : 1;
      return [...this.rows].sort(
        (a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * order,
      );
    },
    create: async (args: { data: Partial<FakeRow> }) => {
      const id = `key-${++this.counter}`;
      const row: FakeRow = {
        id,
        keyMaterial: args.data.keyMaterial ?? '',
        status: args.data.status ?? 'ACTIVE',
        rotatedToId: args.data.rotatedToId ?? null,
        createdAt: new Date(Date.now() + this.counter), // monotonic ordering
        retiredAt: args.data.retiredAt ?? null,
      };
      this.rows.push(row);
      return row;
    },
    update: async (args: {
      where: { id: string };
      data: Partial<FakeRow>;
    }) => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`row ${args.where.id} not found`);
      Object.assign(row, args.data);
      return row;
    },
  };

  async $transaction<T>(fn: (tx: FakePrismaClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function makeProvider() {
  // Field-level master key used to wrap DEKs.
  const masterKey = randomBytes(32);
  const masterEncryption = new EncryptionService(masterKey);
  const prisma = new FakePrismaClient();
  // The provider expects a real PrismaClient — the unsafe cast is
  // bounded by the FakePrismaClient implementing the same delegate
  // surface used by `LocalKmsProvider`.
  const provider = new LocalKmsProvider(
    prisma as unknown as import('@prisma/client').PrismaClient,
    masterEncryption,
  );
  return { provider, prisma };
}

describe('LocalKmsProvider — bootstrap', () => {
  it('lazily creates a DEK on first getActiveKey() call', async () => {
    const { provider, prisma } = makeProvider();
    expect(prisma.rows).toHaveLength(0);

    const key = await provider.getActiveKey();

    expect(prisma.rows).toHaveLength(1);
    expect(key.status).toBe('ACTIVE');
    expect(key.material.length).toBe(32);
    expect(key.id).toMatch(/^key-/);
  });

  it('returns the same id on subsequent reads (no double-creation)', async () => {
    const { provider } = makeProvider();
    const a = await provider.getActiveKey();
    const b = await provider.getActiveKey();
    expect(a.id).toBe(b.id);
  });
});

describe('LocalKmsProvider — rotation', () => {
  it('createKey retires the previous active row and links it forward', async () => {
    const { provider, prisma } = makeProvider();
    const first = await provider.createKey();
    const second = await provider.createKey();

    expect(first.id).not.toBe(second.id);
    expect(second.status).toBe('ACTIVE');
    expect(prisma.rows).toHaveLength(2);

    const retired = prisma.rows.find((r) => r.id === first.id);
    expect(retired?.status).toBe('RETIRED');
    expect(retired?.rotatedToId).toBe(second.id);
    expect(retired?.retiredAt).toBeInstanceOf(Date);
  });

  it('listKeys orders rows by createdAt ascending', async () => {
    const { provider } = makeProvider();
    const a = await provider.createKey();
    const b = await provider.createKey();
    const c = await provider.createKey();
    const list = await provider.listKeys();
    expect(list.map((k) => k.id)).toEqual([a.id, b.id, c.id]);
  });

  it('every materialised key has a 32-byte buffer (wrap/unwrap round-trip)', async () => {
    const { provider } = makeProvider();
    await provider.createKey();
    await provider.createKey();
    const list = await provider.listKeys();
    for (const key of list) {
      expect(key.material.length).toBe(32);
      expect(Buffer.isBuffer(key.material)).toBe(true);
    }
  });
});

describe('LocalKmsProvider — getKeyById', () => {
  it('returns null for unknown id', async () => {
    const { provider } = makeProvider();
    const key = await provider.getKeyById('nope');
    expect(key).toBeNull();
  });

  it('returns the row for a known id, including retired ones', async () => {
    const { provider } = makeProvider();
    const first = await provider.createKey();
    await provider.createKey();
    const retired = await provider.getKeyById(first.id);
    expect(retired).not.toBeNull();
    expect(retired?.status).toBe('RETIRED');
    expect(retired?.material.length).toBe(32);
  });
});

describe('LocalKmsProvider — markRotated', () => {
  it('is idempotent when the link is already in place', async () => {
    const { provider, prisma } = makeProvider();
    const first = await provider.createKey();
    const second = await provider.createKey();
    const before = prisma.rows.find((r) => r.id === first.id);
    const initialRetiredAt = before?.retiredAt?.getTime();

    await provider.markRotated(first.id, second.id);
    await provider.markRotated(first.id, second.id);

    const after = prisma.rows.find((r) => r.id === first.id);
    expect(after?.retiredAt?.getTime()).toBe(initialRetiredAt);
    expect(after?.rotatedToId).toBe(second.id);
  });

  it('quietly no-ops when the old key id is unknown', async () => {
    const { provider } = makeProvider();
    await expect(
      provider.markRotated('nope', 'also-nope'),
    ).resolves.toBeUndefined();
  });
});
