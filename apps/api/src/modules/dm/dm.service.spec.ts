import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

import {
  DmService,
  buildDmScopeRef,
  peerFromScopeRef,
} from './dm.service';
import {
  DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT,
  DM_PRE_RECIPROCATION_WINDOW_SECONDS,
  dmRateLimitKey,
} from './dm.constants';

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const TEACHER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const STUDENT_TWO_ID = '55555555-5555-5555-5555-555555555555';
const ROOM_ID = '44444444-4444-4444-4444-444444444444';

interface FakeUser {
  id: string;
  role: string;
  status: string;
}

interface FakeMessage {
  id: string;
  roomId: string;
  seq: bigint;
  authorId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}

interface FakeRoom {
  id: string;
  scope: string;
  scopeRef: string;
  createdAt: Date;
}

interface FakeEnrollment {
  id: string;
  studentId: string;
  status: string;
  teacherId: string; // denormalised — for the visibility check
}

interface FakeTeacherProfile {
  userId: string;
  publicSlug: string | null;
}

/**
 * In-memory Prisma double exposing only the call surface the
 * `DmService` uses. We keep the implementation deliberately small —
 * just enough to drive the rate-limit / visibility / reciprocation
 * tests without spinning up Postgres.
 */
function makePrismaFake(opts: {
  users?: Record<string, FakeUser | undefined>;
  enrollments?: FakeEnrollment[];
  teacherProfiles?: Record<string, FakeTeacherProfile | undefined>;
}) {
  const users = opts.users ?? {};
  const enrollments = opts.enrollments ?? [];
  const teacherProfiles = opts.teacherProfiles ?? {};

  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    enrollment: {
      findFirst: jest.fn(async ({ where }: any) => {
        const studentId = where.studentId;
        const status = where.status;
        const teacherId = where.group?.course?.teacherId;
        return (
          enrollments.find(
            (e) =>
              e.studentId === studentId &&
              (status === undefined || e.status === status) &&
              (teacherId === undefined || e.teacherId === teacherId),
          ) ?? null
        );
      }),
    },
    teacherProfile: {
      findUnique: jest.fn(
        async ({ where }: any) => teacherProfiles[where.userId] ?? null,
      ),
    },
    chatMessage: {
      count: jest.fn().mockResolvedValue(0),
    },
    dmReadReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Backs `countUnreadBatch` (Task 24.2 follow-up) — the service no
    // longer calls `chatMessage.count()` per room in `listThreads` /
    // `getUnreadCount`, so tests that don't care about exact unread
    // numbers (all of them, today) just see an empty batch → 0 for
    // every room, matching the old `count: () => 0` behaviour.
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

/** Fake `DmRepository` backed by in-memory rows. */
function makeRepoFake(initialMessages: FakeMessage[] = []) {
  const messages: FakeMessage[] = initialMessages;
  const rooms = new Map<string, FakeRoom>();
  const lastSeqByRoom = new Map<string, bigint>();

  const repo = {
    upsertThreadForPair: jest.fn(async (a: string, b: string) => {
      const scopeRef = buildDmScopeRef(a, b);
      const key = `DM:${scopeRef}`;
      const existing = rooms.get(key);
      if (existing) return existing;
      const row: FakeRoom = {
        id: ROOM_ID,
        scope: 'DM',
        scopeRef,
        createdAt: new Date(),
      };
      rooms.set(key, row);
      return row;
    }),
    findThreadById: jest.fn(async (id: string) => {
      for (const r of rooms.values()) if (r.id === id) return r;
      return null;
    }),
    findThreadByPair: jest.fn(async (a: string, b: string) => {
      const scopeRef = buildDmScopeRef(a, b);
      return rooms.get(`DM:${scopeRef}`) ?? null;
    }),
    listThreadsForUser: jest.fn(async (userId: string) => {
      return Array.from(rooms.values()).filter(
        (r) =>
          r.scope === 'DM' &&
          (r.scopeRef.startsWith(`${userId}:`) ||
            r.scopeRef.endsWith(`:${userId}`)),
      );
    }),
    createMessage: jest.fn(
      async (input: { threadId: string; authorId: string; body: string }) => {
        const nextSeq = (lastSeqByRoom.get(input.threadId) ?? 0n) + 1n;
        lastSeqByRoom.set(input.threadId, nextSeq);
        const row: FakeMessage = {
          id: `msg-${messages.length + 1}`,
          roomId: input.threadId,
          seq: nextSeq,
          authorId: input.authorId,
          body: input.body,
          createdAt: new Date(),
          deletedAt: null,
        };
        messages.push(row);
        return {
          id: row.id,
          roomId: row.roomId,
          seq: row.seq,
          authorId: row.authorId,
          body: row.body,
          createdAt: row.createdAt,
        };
      },
    ),
    listMessages: jest.fn(
      async (
        threadId: string,
        opts: { cursor?: bigint; pageSize: number },
      ) => {
        const filtered = messages
          .filter((m) => m.deletedAt === null && m.roomId === threadId)
          .filter((m) => (opts.cursor !== undefined ? m.seq < opts.cursor : true))
          .sort((a, b) => (b.seq > a.seq ? 1 : b.seq < a.seq ? -1 : 0))
          .slice(0, opts.pageSize)
          .map((m) => ({
            id: m.id,
            roomId: m.roomId,
            seq: m.seq,
            authorId: m.authorId,
            body: m.body,
            createdAt: m.createdAt,
          }));
        return filtered;
      },
    ),
    findLatestMessage: jest.fn(async (threadId: string) => {
      const row = messages
        .filter((m) => m.deletedAt === null && m.roomId === threadId)
        .sort((a, b) => (b.seq > a.seq ? 1 : b.seq < a.seq ? -1 : 0))[0];
      if (!row) return null;
      return {
        id: row.id,
        roomId: row.roomId,
        seq: row.seq,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt,
      };
    }),
    findLatestMessagesByThread: jest.fn(async (threadIds: string[]) => {
      const out = new Map<string, {
        id: string;
        roomId: string;
        seq: bigint;
        authorId: string;
        body: string;
        createdAt: Date;
      }>();
      for (const tid of threadIds) {
        const row = messages
          .filter((m) => m.deletedAt === null && m.roomId === tid)
          .sort((a, b) => (b.seq > a.seq ? 1 : b.seq < a.seq ? -1 : 0))[0];
        if (row) {
          out.set(tid, {
            id: row.id,
            roomId: row.roomId,
            seq: row.seq,
            authorId: row.authorId,
            body: row.body,
            createdAt: row.createdAt,
          });
        }
      }
      return out;
    }),
    hasMessageFrom: jest.fn(async (threadId: string, authorId: string) => {
      return messages.some(
        (m) =>
          m.deletedAt === null &&
          m.roomId === threadId &&
          m.authorId === authorId,
      );
    }),
    _state: { messages, rooms },
  };

  return repo;
}

/** Fake `RedisService` backed by an in-memory Map. */
function makeRedisFake() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function alive(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return false;
    }
    return true;
  }

  return {
    get: jest.fn(async (key: string) => {
      if (!alive(key)) return null;
      return store.get(key)!.value;
    }),
    set: jest.fn(async (key: string, value: string, ttl?: number) => {
      store.set(key, {
        value,
        expiresAt: ttl ? Date.now() + ttl * 1000 : null,
      });
    }),
    del: jest.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    incr: jest.fn(async (key: string) => {
      if (!alive(key)) {
        store.set(key, { value: '1', expiresAt: null });
        return 1;
      }
      const cur = Number(store.get(key)!.value || '0');
      const next = cur + 1;
      store.set(key, { value: String(next), expiresAt: store.get(key)!.expiresAt });
      return next;
    }),
    expire: jest.fn(async (key: string, ttl: number) => {
      const entry = store.get(key);
      if (entry) {
        entry.expiresAt = Date.now() + ttl * 1000;
      }
    }),
    _store: store,
  };
}

const ACTIVE_STUDENT: FakeUser = {
  id: STUDENT_ID,
  role: 'STUDENT',
  status: 'ACTIVE',
};
const ACTIVE_TEACHER: FakeUser = {
  id: TEACHER_ID,
  role: 'TEACHER',
  status: 'ACTIVE',
};
const ACTIVE_ADMIN: FakeUser = {
  id: ADMIN_ID,
  role: 'ADMIN',
  status: 'ACTIVE',
};
const ACTIVE_STUDENT_TWO: FakeUser = {
  id: STUDENT_TWO_ID,
  role: 'STUDENT',
  status: 'ACTIVE',
};

function makeService(overrides?: {
  prisma?: any;
  repo?: any;
  redis?: any;
}) {
  const prisma =
    overrides?.prisma ??
    makePrismaFake({
      users: {
        [STUDENT_ID]: ACTIVE_STUDENT,
        [TEACHER_ID]: ACTIVE_TEACHER,
      },
      teacherProfiles: {
        [TEACHER_ID]: { userId: TEACHER_ID, publicSlug: 'teacher-x' },
      },
    });
  const repo = overrides?.repo ?? makeRepoFake();
  const redis = overrides?.redis ?? makeRedisFake();
  const config = {
    get: jest.fn((key: string, fallback: any) => fallback),
  };
  const service = new DmService(
    prisma as any,
    repo as any,
    redis as any,
    config as any,
    { server: { to: () => ({ emit: jest.fn() }) } } as any, // liveChatGateway
    {} as any, // mediaAccess
    {} as any, // r2
  );
  return { service, prisma, repo, redis };
}

describe('DmService', () => {
  // ------------------------------------------------------------------
  // Helper exports
  // ------------------------------------------------------------------

  describe('scopeRef helpers', () => {
    it('sorts the pair so the same two ids always produce the same key', () => {
      expect(buildDmScopeRef(STUDENT_ID, TEACHER_ID)).toBe(
        buildDmScopeRef(TEACHER_ID, STUDENT_ID),
      );
    });

    it('refuses self-pairs', () => {
      expect(() => buildDmScopeRef(STUDENT_ID, STUDENT_ID)).toThrow();
    });

    it('peerFromScopeRef returns the other half', () => {
      const ref = buildDmScopeRef(STUDENT_ID, TEACHER_ID);
      expect(peerFromScopeRef(ref, STUDENT_ID)).toBe(TEACHER_ID);
      expect(peerFromScopeRef(ref, TEACHER_ID)).toBe(STUDENT_ID);
    });
  });

  // ------------------------------------------------------------------
  // openThread
  // ------------------------------------------------------------------

  describe('openThread', () => {
    it('lazily creates a thread on first call and reuses it on the second', async () => {
      const { service, repo } = makeService();

      const first = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      const second = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(first.thread.id).toBe(second.thread.id);
      expect(first.thread.peerId).toBe(TEACHER_ID);
      expect(repo.upsertThreadForPair).toHaveBeenCalledTimes(1);
    });

    it('forbids ADMIN senders (Req 13.4)', async () => {
      const prisma = makePrismaFake({
        users: { [TEACHER_ID]: ACTIVE_TEACHER, [ADMIN_ID]: ACTIVE_ADMIN },
        teacherProfiles: {
          [TEACHER_ID]: { userId: TEACHER_ID, publicSlug: 'x' },
        },
      });
      const { service } = makeService({ prisma });

      await expect(
        service.openThread(
          { userId: ADMIN_ID, role: 'ADMIN' },
          TEACHER_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids ADMIN recipients', async () => {
      const prisma = makePrismaFake({
        users: { [STUDENT_ID]: ACTIVE_STUDENT, [ADMIN_ID]: ACTIVE_ADMIN },
      });
      const { service } = makeService({ prisma });

      await expect(
        service.openThread(
          { userId: STUDENT_ID, role: 'STUDENT' },
          ADMIN_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects self-DMs', async () => {
      const { service } = makeService();
      await expect(
        service.openThread(
          { userId: STUDENT_ID, role: 'STUDENT' },
          STUDENT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 404 when the recipient does not exist', async () => {
      const prisma = makePrismaFake({
        users: { [STUDENT_ID]: ACTIVE_STUDENT },
      });
      const { service } = makeService({ prisma });

      await expect(
        service.openThread(
          { userId: STUDENT_ID, role: 'STUDENT' },
          TEACHER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks DM when the teacher is not publicly discoverable and no shared group', async () => {
      const prisma = makePrismaFake({
        users: { [STUDENT_ID]: ACTIVE_STUDENT, [TEACHER_ID]: ACTIVE_TEACHER },
        // No teacherProfile.publicSlug, no enrollments.
      });
      const { service } = makeService({ prisma });

      await expect(
        service.openThread(
          { userId: STUDENT_ID, role: 'STUDENT' },
          TEACHER_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows DM when student is enrolled in one of the teacher’s groups', async () => {
      const prisma = makePrismaFake({
        users: { [STUDENT_ID]: ACTIVE_STUDENT, [TEACHER_ID]: ACTIVE_TEACHER },
        teacherProfiles: {
          [TEACHER_ID]: { userId: TEACHER_ID, publicSlug: null },
        },
        enrollments: [
          {
            id: 'e1',
            studentId: STUDENT_ID,
            status: 'APPROVED',
            teacherId: TEACHER_ID,
          },
        ],
      });
      const { service } = makeService({ prisma });

      const result = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      expect(result.thread.peerId).toBe(TEACHER_ID);
    });

    it('allows STUDENT ↔ STUDENT DMs (students may message each other freely outside a group chat)', async () => {
      const prisma = makePrismaFake({
        users: {
          [STUDENT_ID]: ACTIVE_STUDENT,
          [STUDENT_TWO_ID]: ACTIVE_STUDENT_TWO,
        },
      });
      const { service } = makeService({ prisma });

      const result = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        STUDENT_TWO_ID,
      );
      expect(result.thread.peerId).toBe(STUDENT_TWO_ID);
    });
  });

  // ------------------------------------------------------------------
  // sendMessage rate limit (Req 13.3, Property 11)
  // ------------------------------------------------------------------

  describe('sendMessage rate limit', () => {
    it(`allows exactly ${DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT} unreciprocated messages then 429s`, async () => {
      const { service, redis } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      const threadId = opened.thread.id;
      const actor = { userId: STUDENT_ID, role: 'STUDENT' };

      for (let i = 0; i < DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT; i++) {
        await service.sendMessage(actor, threadId, `ping ${i}`);
      }

      await expect(
        service.sendMessage(actor, threadId, 'one too many'),
      ).rejects.toMatchObject({ status: 429 });

      // Counter parked at exactly the limit (and was set with TTL on
      // first hit).
      const value = await redis.get(dmRateLimitKey(STUDENT_ID, TEACHER_ID));
      expect(Number(value)).toBe(DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT);
    });

    it('lifts the cap once the peer has replied (becameReciprocated)', async () => {
      const { service } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      const threadId = opened.thread.id;

      // Student fires the limit.
      const studentActor = { userId: STUDENT_ID, role: 'STUDENT' };
      for (let i = 0; i < DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT; i++) {
        await service.sendMessage(studentActor, threadId, `s${i}`);
      }

      // Teacher replies — first reply, so reciprocation flips.
      const teacherActor = { userId: TEACHER_ID, role: 'TEACHER' };
      const reply = await service.sendMessage(
        teacherActor,
        threadId,
        'thanks for reaching out',
      );
      expect(reply.becameReciprocated).toBe(true);
      // From the teacher's POV, the student had already sent → peerHasReplied=true.
      expect(reply.reciprocated).toBe(true);

      // Student can now exceed the previous cap.
      const followUp = await service.sendMessage(
        studentActor,
        threadId,
        'follow-up',
      );
      expect(followUp.reciprocated).toBe(true);
      expect(followUp.becameReciprocated).toBe(false);
    });

    it('429 payload exposes DM_RATE_LIMITED with the limit and window', async () => {
      const { service } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      const threadId = opened.thread.id;
      const actor = { userId: STUDENT_ID, role: 'STUDENT' };

      for (let i = 0; i < DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT; i++) {
        await service.sendMessage(actor, threadId, 'ping');
      }

      try {
        await service.sendMessage(actor, threadId, 'overflow');
        fail('expected DM_RATE_LIMITED to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const response = (err as HttpException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.code).toBe('DM_RATE_LIMITED');
        expect(response.limit).toBe(DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT);
        expect(response.windowSeconds).toBe(
          DM_PRE_RECIPROCATION_WINDOW_SECONDS,
        );
      }
    });

    it('uses the `dm:rate:{senderId}:{recipientId}` key with a 24h TTL', async () => {
      const { service, redis } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      const threadId = opened.thread.id;
      const actor = { userId: STUDENT_ID, role: 'STUDENT' };

      await service.sendMessage(actor, threadId, 'ping');

      expect(redis.incr).toHaveBeenCalledWith(
        dmRateLimitKey(STUDENT_ID, TEACHER_ID),
      );
      expect(redis.expire).toHaveBeenCalledWith(
        dmRateLimitKey(STUDENT_ID, TEACHER_ID),
        DM_PRE_RECIPROCATION_WINDOW_SECONDS,
      );
    });
  });

  // ------------------------------------------------------------------
  // Body validation
  // ------------------------------------------------------------------

  describe('body validation', () => {
    it('rejects empty bodies', async () => {
      const { service } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      await expect(
        service.sendMessage(
          { userId: STUDENT_ID, role: 'STUDENT' },
          opened.thread.id,
          '   ',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects bodies over 2000 chars', async () => {
      const { service } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      await expect(
        service.sendMessage(
          { userId: STUDENT_ID, role: 'STUDENT' },
          opened.thread.id,
          'a'.repeat(2001),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ------------------------------------------------------------------
  // Listing
  // ------------------------------------------------------------------

  describe('listMessages', () => {
    it('returns 404 when the thread does not exist', async () => {
      const { service } = makeService();
      await expect(
        service.listMessages(
          { userId: STUDENT_ID, role: 'STUDENT' },
          ROOM_ID,
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids non-participant access (403)', async () => {
      const prisma = makePrismaFake({
        users: {
          [STUDENT_ID]: ACTIVE_STUDENT,
          [STUDENT_TWO_ID]: ACTIVE_STUDENT_TWO,
          [TEACHER_ID]: ACTIVE_TEACHER,
        },
        teacherProfiles: {
          [TEACHER_ID]: { userId: TEACHER_ID, publicSlug: 'x' },
        },
      });
      const { service } = makeService({ prisma });

      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );

      await expect(
        service.listMessages(
          { userId: STUDENT_TWO_ID, role: 'STUDENT' },
          opened.thread.id,
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids ADMIN listing', async () => {
      const { service } = makeService();
      await expect(
        service.listMessages(
          { userId: ADMIN_ID, role: 'ADMIN' },
          ROOM_ID,
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listThreads', () => {
    it('returns the caller’s threads sorted by latest activity', async () => {
      const { service } = makeService();
      const opened = await service.openThread(
        { userId: STUDENT_ID, role: 'STUDENT' },
        TEACHER_ID,
      );
      await service.sendMessage(
        { userId: STUDENT_ID, role: 'STUDENT' },
        opened.thread.id,
        'hi',
      );

      const page = await service.listThreads(
        { userId: STUDENT_ID, role: 'STUDENT' },
        {},
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.peerId).toBe(TEACHER_ID);
      expect(page.items[0]!.lastMessage?.text).toBe('hi');
    });

    it('forbids ADMIN listing', async () => {
      const { service } = makeService();
      await expect(
        service.listThreads({ userId: ADMIN_ID, role: 'ADMIN' }, {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
