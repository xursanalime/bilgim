import { Prisma, PrismaClient, PushDevice } from '@prisma/client';

import { PushDeviceRepository } from './push-device.repository';

const USER_ID = '00000000-0000-0000-0000-000000000099';
const TOKEN = 'ExpoPushToken[abc123]';

/**
 * PushDeviceRepository unit tests (Task 22.2, Req 16.1).
 *
 * The Prisma client is mocked so the suite is hermetic. We verify:
 *   - `register` upserts on `(userId, token)` and re-activates a
 *     previously revoked row (sets `revokedAt = null`).
 *   - Nullable `deviceInfo` is mapped to `Prisma.JsonNull` so the
 *     Prisma typings stay happy when the mobile client doesn't
 *     supply metadata.
 *   - `revoke` updates only un-revoked rows that match the token.
 *   - `unregister` reports `deleted: true` only when at least one row
 *     was removed.
 *   - `clearForUser` returns the row count for diagnostics.
 *   - `listActiveForUser` filters out revoked rows and orders by the
 *     LRU-style `lastSeenAt DESC`.
 */
describe('PushDeviceRepository', () => {
  let prisma: jest.Mocked<PrismaClient> & {
    pushDevice: {
      upsert: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let repo: PushDeviceRepository;

  beforeEach(() => {
    prisma = {
      pushDevice: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    } as any;
    repo = new PushDeviceRepository(prisma as unknown as PrismaClient);
  });

  // ------------------------------------------------------------------
  // register
  // ------------------------------------------------------------------

  describe('register', () => {
    it('upserts on (userId, token) and clears revokedAt', async () => {
      const fakeRow: PushDevice = {
        id: 'row-1',
        userId: USER_ID,
        token: TOKEN,
        platform: 'ios',
        deviceInfo: null,
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      prisma.pushDevice.upsert.mockResolvedValue(fakeRow);

      const result = await repo.register({
        userId: USER_ID,
        token: TOKEN,
        platform: 'ios',
      });

      expect(result).toBe(fakeRow);
      expect(prisma.pushDevice.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.pushDevice.upsert.mock.calls[0]![0];
      expect(arg.where).toEqual({
        userId_token: { userId: USER_ID, token: TOKEN },
      });
      // create branch
      expect(arg.create.platform).toBe('ios');
      expect(arg.create.userId).toBe(USER_ID);
      expect(arg.create.token).toBe(TOKEN);
      // missing deviceInfo → Prisma.JsonNull (not raw null)
      expect(arg.create.deviceInfo).toBe(Prisma.JsonNull);
      // update branch re-activates the row
      expect(arg.update.revokedAt).toBeNull();
      expect(arg.update.platform).toBe('ios');
      expect(arg.update.deviceInfo).toBe(Prisma.JsonNull);
    });

    it('serialises a non-null deviceInfo blob through to Prisma', async () => {
      prisma.pushDevice.upsert.mockResolvedValue({} as any);
      await repo.register({
        userId: USER_ID,
        token: TOKEN,
        platform: 'android',
        deviceInfo: { modelName: 'Pixel 8', osVersion: '14' },
      });

      const arg = prisma.pushDevice.upsert.mock.calls[0]![0];
      expect(arg.create.deviceInfo).toEqual({
        modelName: 'Pixel 8',
        osVersion: '14',
      });
      expect(arg.update.deviceInfo).toEqual({
        modelName: 'Pixel 8',
        osVersion: '14',
      });
    });
  });

  // ------------------------------------------------------------------
  // revoke
  // ------------------------------------------------------------------

  describe('revoke', () => {
    it('updates only rows that are not already revoked', async () => {
      prisma.pushDevice.updateMany.mockResolvedValue({ count: 2 });
      const result = await repo.revoke(TOKEN);

      expect(result).toEqual({ count: 2 });
      expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({
        where: { token: TOKEN, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  // ------------------------------------------------------------------
  // listActiveForUser
  // ------------------------------------------------------------------

  describe('listActiveForUser', () => {
    it('filters out revoked rows and orders by lastSeenAt DESC', async () => {
      prisma.pushDevice.findMany.mockResolvedValue([]);
      await repo.listActiveForUser(USER_ID);

      expect(prisma.pushDevice.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, revokedAt: null },
        orderBy: { lastSeenAt: 'desc' },
      });
    });
  });

  // ------------------------------------------------------------------
  // unregister / clearForUser
  // ------------------------------------------------------------------

  describe('unregister', () => {
    it('returns deleted=true when a row was removed', async () => {
      prisma.pushDevice.deleteMany.mockResolvedValue({ count: 1 });
      const result = await repo.unregister(USER_ID, TOKEN);
      expect(result).toEqual({ deleted: true });
      expect(prisma.pushDevice.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, token: TOKEN },
      });
    });

    it('returns deleted=false when nothing matched', async () => {
      prisma.pushDevice.deleteMany.mockResolvedValue({ count: 0 });
      const result = await repo.unregister(USER_ID, TOKEN);
      expect(result).toEqual({ deleted: false });
    });
  });

  describe('clearForUser', () => {
    it('returns the row count', async () => {
      prisma.pushDevice.deleteMany.mockResolvedValue({ count: 3 });
      const result = await repo.clearForUser(USER_ID);
      expect(result).toEqual({ deleted: 3 });
    });
  });
});
