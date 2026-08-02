import * as fc from 'fast-check';
import {
  Notification,
  NotificationChannel,
  NotificationKind,
} from '@prisma/client';

import { NotificationFanoutProcessor } from './notification-fanout.processor';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';
import { CreateNotificationInput } from '../repositories/notification.repository';

/**
 * Property 3 — Notification fan-out idempotency
 * (Task 8.3 from .kiro/specs/edubridge-platform/tasks.md)
 *
 *   ∀ groupId, version, studentId in approvedEnrolledOf(groupId):
 *     |{ n ∈ Notification |
 *          n.userId = studentId
 *          ∧ n.kind = SCHEDULE_CHANGED
 *          ∧ n.idempotencyKey = "schedule.changed:" + groupId
 *                              + ":v" + version + ":" + studentId }| = 1
 *
 *   regardless of how many times the worker re-processes the same
 *   OutboxEvent.
 *
 * This file ONLY implements Property 3 from the design document.
 *
 * Validates: Requirements 10.2, 10.3, 10.4, 10.6
 *
 * Approach: drive the real `NotificationFanoutProcessor` over an in-memory
 * fake `NotificationsService` whose `createNotification` mirrors the
 * production `INSERT ... ON CONFLICT (idempotencyKey) DO NOTHING` semantics
 * (Req 10.4, 16.4). fast-check generates a fresh world per run
 * (groupId, version, approved students, retry count) and re-runs the
 * processor `retries` times against the same fake — i.e. exactly the
 * scenario where BullMQ delivers the same job N times.
 *
 * Invariants asserted on the post-state (after `retries` invocations):
 *
 *   I1. |store| = |students|             (one row per recipient, no dupes)
 *   I2. ∀ s ∈ students :
 *         ∃! n ∈ store with n.idempotencyKey
 *           = `schedule.changed:${groupId}:v${version}:${s}`
 *         ∧ n.userId = s
 *         ∧ n.kind = SCHEDULE_CHANGED
 *   I3. created-counter accumulated across all retries = |students|
 *       (i.e. only the first run's createIdempotent calls are observed
 *        as `created=true` — every retry returns `created=false`).
 *   I4. lesson.published replays with disjoint `(lessonId, groupId)` pairs
 *       each contribute exactly |students| rows and never collide with
 *       schedule.changed keys, proving the topic is part of the key
 *       namespace.
 */

// ---------------------------------------------------------------------------
// Fake NotificationsService — emulates ON CONFLICT (idempotencyKey) DO NOTHING
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  idempotencyKey: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
}

class FakeNotificationStore {
  /** keyed by `idempotencyKey` — guarantees uniqueness like the DB does. */
  rows = new Map<string, FakeRow>();
  private seq = 0;

  insertIfAbsent(input: CreateNotificationInput): {
    notification: FakeRow;
    created: boolean;
  } {
    const existing = this.rows.get(input.idempotencyKey);
    if (existing) {
      return { notification: existing, created: false };
    }
    const row: FakeRow = {
      id: `notif-${++this.seq}`,
      userId: input.userId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
    };
    this.rows.set(input.idempotencyKey, row);
    return { notification: row, created: true };
  }

  /** Inspect rows for a given (kind, userId). */
  forUser(userId: string, kind: NotificationKind): FakeRow[] {
    return [...this.rows.values()].filter(
      (r) => r.userId === userId && r.kind === kind,
    );
  }
}

function buildFakeNotificationsService(
  store: FakeNotificationStore,
): jest.Mocked<NotificationsService> {
  return {
    createNotification: jest.fn(
      async (input: CreateNotificationInput) =>
        store.insertIfAbsent(input) as {
          notification: Notification;
          created: boolean;
        },
    ),
    resolveChannelsForUser: jest.fn(
      async (_userId: string, _kind: NotificationKind) =>
        ({
          IN_APP: true,
          EMAIL: false,
          TELEGRAM: false,
          PUSH: false,
        }) as Record<NotificationChannel, boolean>,
    ),
  } as unknown as jest.Mocked<NotificationsService>;
}

function buildFakeRepository(): jest.Mocked<NotificationRepository> {
  return {
    upsertDelivery: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<NotificationRepository>;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const uuidArb = fc.uuid();

/**
 * Sized list of distinct student UUIDs (1..8 entries, deduplicated).
 * Distinctness mirrors the DB-level guarantee that an Enrollment is unique
 * on `(groupId, studentId)` — the worker therefore only ever sees a
 * deduped list.
 */
const studentsArb: fc.Arbitrary<string[]> = fc
  .uniqueArray(uuidArb, { minLength: 1, maxLength: 8 })
  .map((arr) => arr.slice());

/**
 * Worlds that exercise schedule.changed:
 *
 *   - groupId  : random UUID
 *   - version  : monotonic version number (≥ 1, per Req 10.1)
 *   - students : approved enrollment list (deduped)
 *   - retries  : how many times the worker re-processes the same job
 *                (1..5 — covers the design doc's "3× retry" target plus
 *                margin)
 */
const scheduleChangedWorldArb = fc.record({
  groupId: uuidArb,
  version: fc.integer({ min: 1, max: 1_000 }),
  students: studentsArb,
  retries: fc.integer({ min: 1, max: 5 }),
});

type ScheduleChangedWorld = {
  groupId: string;
  version: number;
  students: string[];
  retries: number;
};

/** Build the prisma fake the processor needs for `schedule.changed`. */
function buildSchedulePrisma(world: ScheduleChangedWorld): any {
  return {
    enrollment: {
      findMany: jest.fn(async () =>
        world.students.map((studentId) => ({ studentId })),
      ),
    },
    group: {
      findUnique: jest.fn(async () => ({ name: 'g' })),
    },
    // Unused for schedule.changed, but referenced by other paths.
    lesson: { findUnique: jest.fn() },
  };
}

/**
 * Worlds that exercise lesson.published. Used to prove that the topic is
 * part of the idempotency-key namespace so two events with the same
 * `(groupId, students)` but different topics never collide.
 */
const lessonPublishedWorldArb = fc.record({
  lessonId: uuidArb,
  groupId: uuidArb,
  students: studentsArb,
  retries: fc.integer({ min: 1, max: 5 }),
});

type LessonPublishedWorld = {
  lessonId: string;
  groupId: string;
  students: string[];
  retries: number;
};

function buildLessonPrisma(world: LessonPublishedWorld): any {
  return {
    enrollment: {
      findMany: jest.fn(async () =>
        world.students.map((studentId) => ({ studentId })),
      ),
    },
    lesson: {
      findUnique: jest.fn(async () => ({
        id: world.lessonId,
        title: 'Lesson',
        groupId: world.groupId,
      })),
    },
    group: { findUnique: jest.fn() },
  };
}

// ---------------------------------------------------------------------------
// Processor wiring
// ---------------------------------------------------------------------------

function buildProcessor(prisma: any, store: FakeNotificationStore) {
  const notificationsService = buildFakeNotificationsService(store);
  const repo = buildFakeRepository();
  const emailQueue = { add: jest.fn().mockResolvedValue({ id: 'e' }) } as any;
  const telegramQueue = {
    add: jest.fn().mockResolvedValue({ id: 't' }),
  } as any;
  const pushQueue = { add: jest.fn().mockResolvedValue({ id: 'p' }) } as any;
  const processor = new NotificationFanoutProcessor(
    prisma,
    notificationsService,
    repo,
    emailQueue,
    telegramQueue,
    pushQueue,
  );
  return { processor, notificationsService, repo };
}

async function runJobNTimes(
  processor: NotificationFanoutProcessor,
  topic: string,
  payload: Record<string, unknown>,
  times: number,
): Promise<{ created: number; results: number }> {
  let created = 0;
  let results = 0;
  for (let i = 0; i < times; i++) {
    const r = await processor.process({
      id: `job-${i}`,
      data: { topic, payload, outboxEventId: 'evt-1' },
    } as any);
    created += r.notificationsCreated;
    results += 1;
  }
  return { created, results };
}

// ---------------------------------------------------------------------------
// Property 3 tests
// ---------------------------------------------------------------------------

describe('NotificationFanoutProcessor — Property 3: fan-out idempotency', () => {
  it('schedule.changed: |Notification rows| = |students| regardless of retry count', async () => {
    await fc.assert(
      fc.asyncProperty(scheduleChangedWorldArb, async (world) => {
        const store = new FakeNotificationStore();
        const prisma = buildSchedulePrisma(world);
        const { processor } = buildProcessor(prisma, store);

        const payload = {
          groupId: world.groupId,
          version: world.version,
        };

        const { created } = await runJobNTimes(
          processor,
          'schedule.changed',
          payload,
          world.retries,
        );

        // I1 — total rows match the recipient count, no duplicates.
        expect(store.rows.size).toBe(world.students.length);

        // I3 — the cumulative `created=true` count over all retries is
        // exactly |students|. Every retry past the first contributes 0.
        expect(created).toBe(world.students.length);

        // I2 — for every student there is exactly one row, with the
        // canonical idempotency key shape and the right kind/user.
        for (const studentId of world.students) {
          const expectedKey = `schedule.changed:${world.groupId}:v${world.version}:${studentId}`;
          const row = store.rows.get(expectedKey);
          expect(row).toBeDefined();
          expect(row!.userId).toBe(studentId);
          expect(row!.kind).toBe('SCHEDULE_CHANGED');

          // No second row exists for the same (userId, kind) — this is
          // the rephrased Property 3 invariant.
          const all = store.forUser(studentId, 'SCHEDULE_CHANGED');
          expect(all).toHaveLength(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('topic is part of the idempotency-key namespace (lesson.published does not collide with schedule.changed)', async () => {
    // Per Req 10.3 + 16.4: the key MUST encode the topic so two distinct
    // events (e.g. schedule.changed + lesson.published) for the same
    // student set never collide on the same key.
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          groupId: uuidArb,
          version: fc.integer({ min: 1, max: 100 }),
          lessonId: uuidArb,
          students: studentsArb,
          retries: fc.integer({ min: 1, max: 4 }),
        }),
        async ({ groupId, version, lessonId, students, retries }) => {
          const store = new FakeNotificationStore();
          // Single shared prisma fake covering both code paths.
          const prisma = {
            enrollment: {
              findMany: jest.fn(async () =>
                students.map((studentId) => ({ studentId })),
              ),
            },
            group: { findUnique: jest.fn(async () => ({ name: 'g' })) },
            lesson: {
              findUnique: jest.fn(async () => ({
                id: lessonId,
                title: 'Lesson',
                groupId,
              })),
            },
          };
          const { processor } = buildProcessor(prisma, store);

          await runJobNTimes(
            processor,
            'schedule.changed',
            { groupId, version },
            retries,
          );
          await runJobNTimes(
            processor,
            'lesson.published',
            { lessonId, groupId },
            retries,
          );

          // Two distinct topics, |students| rows each ⇒ 2 × |students| total.
          expect(store.rows.size).toBe(students.length * 2);

          for (const studentId of students) {
            const scheduleKey = `schedule.changed:${groupId}:v${version}:${studentId}`;
            const lessonKey = `lesson.published:${lessonId}:${studentId}`;
            expect(store.rows.has(scheduleKey)).toBe(true);
            expect(store.rows.has(lessonKey)).toBe(true);

            // Each (kind, user) pair has exactly one row.
            expect(store.forUser(studentId, 'SCHEDULE_CHANGED')).toHaveLength(
              1,
            );
            expect(store.forUser(studentId, 'LESSON_PUBLISHED')).toHaveLength(
              1,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lesson.published: replay produces |students| rows and version-irrelevant key shape', async () => {
    // Sanity replay test for the second handled topic with version-less
    // keys (`lesson.published:{lessonId}:{studentId}` per the design).
    await fc.assert(
      fc.asyncProperty(lessonPublishedWorldArb, async (world) => {
        const store = new FakeNotificationStore();
        const prisma = buildLessonPrisma(world);
        const { processor } = buildProcessor(prisma, store);

        const { created } = await runJobNTimes(
          processor,
          'lesson.published',
          { lessonId: world.lessonId, groupId: world.groupId },
          world.retries,
        );

        expect(store.rows.size).toBe(world.students.length);
        expect(created).toBe(world.students.length);

        for (const studentId of world.students) {
          const expectedKey = `lesson.published:${world.lessonId}:${studentId}`;
          const row = store.rows.get(expectedKey);
          expect(row).toBeDefined();
          expect(row!.userId).toBe(studentId);
          expect(row!.kind).toBe('LESSON_PUBLISHED');
        }
      }),
      { numRuns: 100 },
    );
  });
});
