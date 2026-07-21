import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { GroupChatService } from './group-chat.service';

const GROUP_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const MEMBER_ID = '44444444-4444-4444-4444-444444444444';
const OUTSIDER_ID = '55555555-5555-5555-5555-555555555555';
const ROOM_ID = '66666666-6666-6666-6666-666666666666';

interface FakeMember {
  groupId: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: Date;
  removedAt: Date | null;
}

/** In-memory `GroupChatRepository` double covering only what the service calls. */
function makeRepoFake(initialMembers: FakeMember[]) {
  const members = new Map<string, FakeMember>(
    initialMembers.map((m) => [`${m.groupId}:${m.userId}`, m]),
  );
  const messages: Array<{ id: string; roomId: string; authorId: string; body: string; assetId: string | null; createdAt: Date }> = [];

  return {
    upsertRoomForGroup: jest.fn(async (groupId: string) => ({
      id: ROOM_ID,
      scopeRef: groupId,
      createdAt: new Date(),
    })),
    findRoomByGroupId: jest.fn(async (groupId: string) => ({
      id: ROOM_ID,
      scopeRef: groupId,
      createdAt: new Date(),
    })),
    findActiveMember: jest.fn(async (groupId: string, userId: string) => {
      const m = members.get(`${groupId}:${userId}`);
      return m && m.removedAt === null ? m : null;
    }),
    findMember: jest.fn(async (groupId: string, userId: string) => members.get(`${groupId}:${userId}`) ?? null),
    listActiveMembers: jest.fn(async (groupId: string) =>
      Array.from(members.values()).filter((m) => m.groupId === groupId && m.removedAt === null),
    ),
    upsertMember: jest.fn(async (groupId: string, userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => {
      const row: FakeMember = { groupId, userId, role, joinedAt: new Date(), removedAt: null };
      members.set(`${groupId}:${userId}`, row);
      return row;
    }),
    removeMember: jest.fn(async (groupId: string, userId: string) => {
      const row = members.get(`${groupId}:${userId}`);
      if (row) row.removedAt = new Date();
    }),
    setRole: jest.fn(async (groupId: string, userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => {
      const row = members.get(`${groupId}:${userId}`);
      if (row) row.role = role;
    }),
    createMessage: jest.fn(async (input: { roomId: string; authorId: string; body: string; assetId?: string }) => {
      const row = {
        id: `msg-${messages.length + 1}`,
        roomId: input.roomId,
        authorId: input.authorId,
        body: input.body,
        assetId: input.assetId ?? null,
        createdAt: new Date(),
      };
      messages.push(row);
      return row;
    }),
    listMessages: jest.fn(async () => []),
    findLatestMessagesByRoom: jest.fn(async () => new Map()),
    listGroupIdsForUser: jest.fn(async () => []),
    _members: members,
  };
}

function makePrismaFake(overrides?: { users?: Record<string, { id: string; role: string; status: string } | undefined> }) {
  const users = overrides?.users ?? {};
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    group: {
      findUnique: jest.fn().mockResolvedValue({ id: GROUP_ID, name: 'Test Group', avatarAssetId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    mediaAsset: { findUnique: jest.fn().mockResolvedValue(null) },
    chatMessage: { count: jest.fn().mockResolvedValue(0) },
    dmReadReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    groupChatMember: { findMany: jest.fn().mockResolvedValue([]) },
    chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeGatewayFake() {
  return { server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } };
}

function makeService(members: FakeMember[]) {
  const repo = makeRepoFake(members);
  const prisma = makePrismaFake();
  const gateway = makeGatewayFake();
  const r2 = { signObjectGet: jest.fn().mockResolvedValue('https://signed.example/asset') };
  const service = new GroupChatService(prisma as any, repo as any, gateway as any, r2 as any);
  return { service, repo, prisma, gateway, r2 };
}

const ownerActor = { userId: OWNER_ID, role: 'TEACHER' };
const adminActor = { userId: ADMIN_ID, role: 'STUDENT' };
const memberActor = { userId: MEMBER_ID, role: 'STUDENT' };
const outsiderActor = { userId: OUTSIDER_ID, role: 'STUDENT' };

function baseMembers(): FakeMember[] {
  return [
    { groupId: GROUP_ID, userId: OWNER_ID, role: 'OWNER', joinedAt: new Date(), removedAt: null },
    { groupId: GROUP_ID, userId: ADMIN_ID, role: 'ADMIN', joinedAt: new Date(), removedAt: null },
    { groupId: GROUP_ID, userId: MEMBER_ID, role: 'MEMBER', joinedAt: new Date(), removedAt: null },
  ];
}

describe('GroupChatService', () => {
  describe('sendMessage', () => {
    it('allows an active member to send a message', async () => {
      const { service, repo } = makeService(baseMembers());
      const result = await service.sendMessage(memberActor, GROUP_ID, 'salom guruh');
      expect(result.message.text).toBe('salom guruh');
      expect(repo.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: ROOM_ID, authorId: MEMBER_ID, body: 'salom guruh' }),
      );
    });

    it('forbids a non-member from sending a message', async () => {
      const { service } = makeService(baseMembers());
      await expect(
        service.sendMessage(outsiderActor, GROUP_ID, 'salom'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an empty body with no attachment', async () => {
      const { service } = makeService(baseMembers());
      await expect(
        service.sendMessage(memberActor, GROUP_ID, ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addMember', () => {
    it('lets an ADMIN add a new member', async () => {
      const { service, repo, prisma } = makeService(baseMembers());
      prisma.user.findUnique.mockResolvedValueOnce({ id: OUTSIDER_ID, role: 'STUDENT', status: 'ACTIVE' });
      await service.addMember(adminActor, GROUP_ID, OUTSIDER_ID);
      expect(repo.upsertMember).toHaveBeenCalledWith(GROUP_ID, OUTSIDER_ID, 'MEMBER');
    });

    it('forbids a plain MEMBER from adding people', async () => {
      const { service, prisma } = makeService(baseMembers());
      prisma.user.findUnique.mockResolvedValueOnce({ id: OUTSIDER_ID, role: 'STUDENT', status: 'ACTIVE' });
      await expect(
        service.addMember(memberActor, GROUP_ID, OUTSIDER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('lets the OWNER remove an ADMIN', async () => {
      const { service, repo } = makeService(baseMembers());
      await service.removeMember(ownerActor, GROUP_ID, ADMIN_ID);
      expect(repo.removeMember).toHaveBeenCalledWith(GROUP_ID, ADMIN_ID);
    });

    it('forbids an ADMIN from removing another ADMIN', async () => {
      const members = baseMembers();
      members.push({ groupId: GROUP_ID, userId: 'admin-2', role: 'ADMIN', joinedAt: new Date(), removedAt: null });
      const { service } = makeService(members);
      await expect(
        service.removeMember(adminActor, GROUP_ID, 'admin-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('never allows removing the OWNER', async () => {
      const { service } = makeService(baseMembers());
      await expect(
        service.removeMember(adminActor, GROUP_ID, OWNER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects self-removal in favor of the leave endpoint', async () => {
      const { service } = makeService(baseMembers());
      await expect(
        service.removeMember(adminActor, GROUP_ID, ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setRole', () => {
    it('lets the OWNER promote a MEMBER to ADMIN', async () => {
      const { service, repo } = makeService(baseMembers());
      await service.setRole(ownerActor, GROUP_ID, MEMBER_ID, 'ADMIN');
      expect(repo.setRole).toHaveBeenCalledWith(GROUP_ID, MEMBER_ID, 'ADMIN');
    });

    it('forbids an ADMIN from changing roles (owner-only)', async () => {
      const { service } = makeService(baseMembers());
      await expect(
        service.setRole(adminActor, GROUP_ID, MEMBER_ID, 'ADMIN'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('leaveGroup', () => {
    it('lets a MEMBER leave', async () => {
      const { service, repo } = makeService(baseMembers());
      await service.leaveGroup(memberActor, GROUP_ID);
      expect(repo.removeMember).toHaveBeenCalledWith(GROUP_ID, MEMBER_ID);
    });

    it('forbids the OWNER from leaving', async () => {
      const { service } = makeService(baseMembers());
      await expect(service.leaveGroup(ownerActor, GROUP_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
