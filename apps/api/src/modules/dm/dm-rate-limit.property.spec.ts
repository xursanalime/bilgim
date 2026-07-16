import { HttpException } from '@nestjs/common';
import * as fc from 'fast-check';

import {
  DmService,
  buildDmScopeRef,
} from './dm.service';
import {
  DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT,
  DM_PRE_RECIPROCATION_WINDOW_SECONDS,
  dmRateLimitKey,
} from './dm.constants';

/**
 * Property 11 — DM rate-limit until reciprocated
 * (Task 15.4 from .kiro/specs/bilgim-platform/tasks.md)
 *
 * Spec (design.md, Property 11):
 *
 *   ∀ DM message m authored by `a` to `b`:
 *     if ∄ prior message from b → a (not reciprocated):
 *       a may send at most N = DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT
 *       messages in the 24-hour window; the (N+1)-th request is
 *       rejected with 429 DM_RATE_LIMITED.
 *     if ∃ prior message from b → a (reciprocated):
 *       only the global per-user chat limit applies (~30 msg/min).
 *
 *   ∀ unordered pair (a, b):
 *     at most ONE ChatRoom row exists with scope="DM" and
 *     scopeRef=`${min(a,b)}:${max(a,b)}`.
 *
 *   Idempotency:
 *     incrementing the directional Redis counter only happens for
 *     *successful* sends; a 429-rejected send does NOT erode the
 *     remaining quota.
 *
 * fast-check generates random sequences of (A → B, B → A) sends and
 * we assert the SUT's outcomes match an independently-derived model
 * of the spec. The same property is checked symmetrically (B as the
 * initiator) to confirm the rule is direction-agnostic.
 *
 * **Validates: Requirements 13.3, 15.3**
 */

// ---------------------------------------------------------------------------
// IDs / fixtures
// ---------------------------------------------------------------------------

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const TEACHER_ID = '22222222-2222-2222-2222-222222222222';
const ROOM_ID = '44444444-4444-4444-4444-444444444444';

const N = DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT;

interface FakeUser {
  id: string;
  role: string;
  status: string;
}
interface FakeMessage {
  id: string;
  roomId: string;
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
interface FakeTeacherProfile {
  userId: string;
  publicSlug: string | null;
}

// ---------------------------------------------------------------------------
// Fakes (mirror the pattern in dm.service.spec.ts)
// ---------------------------------------------------------------------------

function makePrismaFake(
  users: Record<string, FakeUser>,
  profiles: Record<string, FakeTeacherProfile>,
) {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    enrollment: {
      // No shared groups in this scenario — visibility is satisfied via
      // the teacher's public profile slug.
      findFirst: jest.fn(async () => null),
    },
    teacherProfile: {
      findUnique: jest.fn(
        async ({ where }: any) => profiles[where.userId] ?? null,
      ),
    },
    chatMessage: {
      count: jest.fn().mockResolvedValue(0),
    },
    dmReadReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

function makeRepoFake() {
  const messages: FakeMessage[] = [];
  const rooms = new Map<string, FakeRoom>();

  return {
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
    listThreadsForUser: jest.fn(async () => Array.from(rooms.values())),
    createMessage: jest.fn(
      async (input: { threadId: string; authorId: string; body: string }) => {
        const row: FakeMessage = {
          id: `msg-${messages.length + 1}`,
          roomId: input.threadId,
          authorId: input.authorId,
          body: input.body,
          createdAt: new Date(),
          deletedAt: null,
        };
        messages.push(row);
        return {
          id: row.id,
          roomId: row.roomId,
          authorId: row.authorId,
          body: row.body,
          createdAt: row.createdAt,
        };
      },
    ),
    listMessages: jest.fn(),
    findLatestMessage: jest.fn(async (threadId: string) => {
      const row = messages
        .filter((m) => m.deletedAt === null && m.roomId === threadId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return row
        ? {
            id: row.id,
            roomId: row.roomId,
            authorId: row.authorId,
            body: row.body,
            createdAt: row.createdAt,
          }
        : null;
    }),
    findLatestMessagesByThread: jest.fn(async (threadIds: string[]) => {
      const out = new Map<string, {
        id: string;
        roomId: string;
        authorId: string;
        body: string;
        createdAt: Date;
      }>();
      for (const tid of threadIds) {
        const row = messages
          .filter((m) => m.deletedAt === null && m.roomId === tid)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (row) {
          out.set(tid, {
            id: row.id,
            roomId: row.roomId,
            authorId: row.authorId,
            body: row.body,
            createdAt: row.createdAt,
          });
        }
      }
      return out;
    }),
    hasMessageFrom: jest.fn(async (threadId: string, authorId: string) =>
      messages.some(
        (m) =>
          m.deletedAt === null &&
          m.roomId === threadId &&
          m.authorId === authorId,
      ),
    ),
    _state: { messages, rooms },
  };
}

function makeRedisFake() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const alive = (key: string): boolean => {
    const e = store.get(key);
    if (!e) return false;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      store.delete(key);
      return false;
    }
    return true;
  };
  return {
    get: jest.fn(async (key: string) =>
      alive(key) ? store.get(key)!.value : null,
    ),
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
      store.set(key, {
        value: String(next),
        expiresAt: store.get(key)!.expiresAt,
      });
      return next;
    }),
    expire: jest.fn(async (key: string, ttl: number) => {
      const e = store.get(key);
      if (e) e.expiresAt = Date.now() + ttl * 1000;
    }),
    _store: store,
  };
}

function makeService() {
  const users: Record<string, FakeUser> = {
    [STUDENT_ID]: { id: STUDENT_ID, role: 'STUDENT', status: 'ACTIVE' },
    [TEACHER_ID]: { id: TEACHER_ID, role: 'TEACHER', status: 'ACTIVE' },
  };
  const profiles: Record<string, FakeTeacherProfile> = {
    [TEACHER_ID]: { userId: TEACHER_ID, publicSlug: 'teacher-public' },
  };
  const prisma = makePrismaFake(users, profiles);
  const repo = makeRepoFake();
  const redis = makeRedisFake();
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

// "A" is the student, "B" is the teacher — visibility check passes
// because the teacher has a publicSlug.
type Side = 'A' | 'B';

function actorForSide(side: Side) {
  return side === 'A'
    ? { userId: STUDENT_ID, role: 'STUDENT' }
    : { userId: TEACHER_ID, role: 'TEACHER' };
}

function peerOf(side: Side): string {
  return side === 'A' ? TEACHER_ID : STUDENT_ID;
}

async function setup(initiator: Side = 'A') {
  const ctx = makeService();
  const opened = await ctx.service.openThread(
    actorForSide(initiator),
    peerOf(initiator),
  );
  return { ...ctx, threadId: opened.thread.id };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('DmService — Property 11: DM rate-limit until reciprocated [Validates: Requirements 13.3, 15.3]', () => {
  it(`A → B: before B replies, exactly ${N} sends succeed; further sends throw 429 DM_RATE_LIMITED`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: N + 5 }),
        async (count) => {
          const { service, threadId, redis } = await setup('A');
          const actor = actorForSide('A');

          let succeeded = 0;
          let rateLimited = 0;
          for (let i = 0; i < count; i++) {
            try {
              await service.sendMessage(actor, threadId, `m-${i}`);
              succeeded++;
            } catch (err) {
              if (err instanceof HttpException && err.getStatus() === 429) {
                const body = err.getResponse() as Record<string, unknown>;
                expect(body.code).toBe('DM_RATE_LIMITED');
                expect(body.limit).toBe(N);
                expect(body.windowSeconds).toBe(
                  DM_PRE_RECIPROCATION_WINDOW_SECONDS,
                );
                rateLimited++;
              } else {
                throw err;
              }
            }
          }

          const expectedOk = Math.min(count, N);
          const expectedBlocked = Math.max(count - N, 0);
          expect(succeeded).toBe(expectedOk);
          expect(rateLimited).toBe(expectedBlocked);

          // Idempotency invariant: the directional counter only
          // tracks *successful* sends, never blocked ones.
          const raw = await redis.get(dmRateLimitKey(STUDENT_ID, TEACHER_ID));
          expect(Number(raw ?? '0')).toBe(expectedOk);
        },
      ),
      { numRuns: 30 },
    );
  });

  it(`B → A (symmetric): before A replies, exactly ${N} sends succeed; further sends throw 429`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: N + 5 }),
        async (count) => {
          const { service, threadId, redis } = await setup('B');
          const actor = actorForSide('B');

          let succeeded = 0;
          let rateLimited = 0;
          for (let i = 0; i < count; i++) {
            try {
              await service.sendMessage(actor, threadId, `b-${i}`);
              succeeded++;
            } catch (err) {
              if (err instanceof HttpException && err.getStatus() === 429) {
                rateLimited++;
              } else {
                throw err;
              }
            }
          }

          expect(succeeded).toBe(Math.min(count, N));
          expect(rateLimited).toBe(Math.max(count - N, 0));

          const raw = await redis.get(dmRateLimitKey(TEACHER_ID, STUDENT_ID));
          expect(Number(raw ?? '0')).toBe(Math.min(count, N));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('once the peer replies, the pre-reciprocation cap is lifted (only the global limit applies)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: N - 1 }),
        fc.integer({ min: 1, max: 20 }),
        async (preCount, postCount) => {
          const { service, threadId } = await setup('A');
          const aActor = actorForSide('A');
          const bActor = actorForSide('B');

          for (let i = 0; i < preCount; i++) {
            await service.sendMessage(aActor, threadId, `pre-${i}`);
          }

          // First peer reply — flips reciprocation. When preCount=0,
          // B is initiating, so B's first send falls under B's own
          // (still empty) pre-reciprocation budget — always allowed
          // because bQuota = 0 < N.
          await service.sendMessage(bActor, threadId, 'reply');

          // A may now exceed N freely — the service no longer enforces
          // the per-pair daily cap once both sides have spoken.
          for (let i = 0; i < postCount; i++) {
            const result = await service.sendMessage(
              aActor,
              threadId,
              `post-${i}`,
            );
            expect(result.reciprocated).toBe(true);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('random A↔B send sequences match the abstract rate-limit model and never violate the (scope, scopeRef) UNIQUE invariant', async () => {
    type Op = { side: Side };
    const opArb: fc.Arbitrary<Op> = fc.record({
      side: fc.constantFrom<Side>('A', 'B'),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 30 }),
        async (ops) => {
          const { service, threadId, repo } = await setup('A');

          // Independent abstract model. State per side: how many
          // messages they've sent and how many remain in their
          // pre-reciprocation quota. Both quotas reset to zero once
          // the conversation is reciprocated (the SUT clears both
          // directional Redis counters on every accepted send while
          // peerHasReplied is true).
          let aSent = 0;
          let bSent = 0;
          let aQuota = 0;
          let bQuota = 0;

          for (let i = 0; i < ops.length; i++) {
            const op = ops[i]!;
            const sender = actorForSide(op.side);
            const peerHasReplied =
              op.side === 'A' ? bSent > 0 : aSent > 0;

            const expected: 'OK' | '429' = peerHasReplied
              ? 'OK'
              : (op.side === 'A' ? aQuota : bQuota) >= N
                ? '429'
                : 'OK';

            let actual: 'OK' | '429';
            try {
              await service.sendMessage(sender, threadId, `op-${i}`);
              actual = 'OK';
            } catch (err) {
              if (err instanceof HttpException && err.getStatus() === 429) {
                const body = err.getResponse() as Record<string, unknown>;
                expect(body.code).toBe('DM_RATE_LIMITED');
                actual = '429';
              } else {
                throw err;
              }
            }

            expect(actual).toBe(expected);

            if (actual === 'OK') {
              if (peerHasReplied) {
                // Counters cleared by service on reciprocated sends.
                aQuota = 0;
                bQuota = 0;
              } else if (op.side === 'A') {
                aQuota++;
              } else {
                bQuota++;
              }
              if (op.side === 'A') aSent++;
              else bSent++;
            }
            // On '429' nothing changes — failed sends never erode quota.
          }

          // UNIQUE invariant: a single ChatRoom for the unordered pair.
          const rooms = repo._state.rooms;
          expect(rooms.size).toBe(1);
          const onlyRoom = Array.from(rooms.values())[0]!;
          expect(onlyRoom.scope).toBe('DM');
          expect(onlyRoom.scopeRef).toBe(
            buildDmScopeRef(STUDENT_ID, TEACHER_ID),
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  it('idempotency: 429-rejected sends never advance the directional Redis counter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 25 }),
        async (overflow) => {
          const { service, threadId, redis } = await setup('A');
          const actor = actorForSide('A');

          // Saturate the quota with N successful sends.
          for (let i = 0; i < N; i++) {
            await service.sendMessage(actor, threadId, `fill-${i}`);
          }

          // Repeated rejections — the counter must remain pinned at N.
          for (let i = 0; i < overflow; i++) {
            await expect(
              service.sendMessage(actor, threadId, `over-${i}`),
            ).rejects.toMatchObject({ status: 429 });
          }

          const raw = await redis.get(dmRateLimitKey(STUDENT_ID, TEACHER_ID));
          expect(Number(raw ?? '0')).toBe(N);
        },
      ),
      { numRuns: 25 },
    );
  });
});
