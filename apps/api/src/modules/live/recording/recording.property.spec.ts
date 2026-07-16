import * as fc from 'fast-check';
import { Prisma } from '@prisma/client';

import { OutboxService } from '../../../infra/outbox/outbox.service';
import { LiveSessionRepository } from '../repositories/live-session.repository';
import { FakeRecorderAdapter } from './fake-recorder.adapter';
import { RECORDING_STATUS, RecordingRepository } from './recording.repository';
import { RecordingService } from './recording.service';

/**
 * Property 6 — Live recording completion
 * (Task 12.5 from .kiro/specs/bilgim-platform/tasks.md)
 *
 *   ∀ liveSession s where s.status reached LIVE:
 *     eventually s.status ∈ {ENDED, RECORDING_FAILED}
 *     ∧ if s.status = ENDED then
 *        ∃ recording r where r.sessionId = s.id ∧ r.status = "READY"
 *        ∧ ∃ asset a where a.id = r.assetId ∧ a.kind = VIDEO ∧ a.status = UPLOADED
 *        ∧ ∃ attachment att where att.lessonId = s.lessonId ∧ att.assetId = r.assetId
 *     ∧ idempotent: re-running finalize never produces duplicate Recording rows.
 *
 * This file ONLY implements Property 6 from the design document.
 *
 * Validates: Requirements 9.5, 9.6, 9.7, 9.8
 *
 * Approach: drive the real `RecordingService` (the only authorized writer for
 * Recording / MediaAsset / Attachment rows in the recorder lifecycle) over an
 * in-memory Prisma fake. The fake faithfully reproduces the parts of the
 * production schema RecordingService relies on for correctness:
 *
 *   - `Recording.sessionId @unique` — a duplicate insert raises a Prisma
 *     `P2002` so the service's idempotent-collision branch can engage.
 *   - `LiveSession.updateMany WHERE status IN (...)` — the optimistic
 *     transition the failure branch uses to flip LIVE/ENDED → RECORDING_FAILED
 *     even when racing against another finalize attempt.
 *
 * fast-check generates a fresh world per run (a set of LiveSessions, each
 * with a designated finalize outcome and a finalize-retry count) and an
 * interleaved sequence of lifecycle operations (start, end, finalize) where
 * per-session order is preserved (you can't finalize before you start, and
 * the production end → finalize ordering is preserved so the success branch
 * sees the ENDED status it expects).
 *
 * After the sequence completes we assert these invariants on the fake DB:
 *
 *   I1 (Req 9.8): every LiveSession that ever reached LIVE has terminal
 *      status (ENDED or RECORDING_FAILED). No row stuck in LIVE / STARTING.
 *
 *   I2 (Req 9.6): for each session whose recorder reported success
 *      (designated outcome = 'success'):
 *        ∃! Recording(sessionId=s.id, status=READY)
 *        ∃! MediaAsset(id=r.assetId, kind=VIDEO, status=UPLOADED)
 *        ∃! Attachment(lessonId=s.lessonId, assetId=r.assetId, kind=VIDEO,
 *                      role='recording')
 *        LiveSession.status = ENDED
 *
 *   I3 (Req 9.7): for each session whose recorder reported failure:
 *        ∃! Recording(sessionId=s.id, status=FAILED)
 *        no MediaAsset / Attachment was created
 *        LiveSession.status = RECORDING_FAILED
 *
 *   I4 (idempotency, Req 9.8 / 18.6): regardless of how many times finalize
 *      was retried for a session, total Recording rows for that session = 1.
 */

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

interface FakeLiveSession {
  id: string;
  lessonId: string;
  status: 'STARTING' | 'LIVE' | 'ENDED' | 'RECORDING_FAILED';
  startedAt: Date | null;
  endedAt: Date | null;
  roomId: string | null;
  recorderRef: string | null;
}

interface FakeRecording {
  id: string;
  lessonId: string;
  sessionId: string;
  status: 'RECORDING' | 'READY' | 'FAILED';
  assetId: string | null;
  durationMs: number | null;
  createdAt: Date;
}

interface FakeMediaAsset {
  id: string;
  ownerUserId: string;
  kind: 'VIDEO' | 'AUDIO' | 'IMAGE' | 'DOC' | 'PDF';
  status: 'UPLOADING' | 'UPLOADED' | 'READY' | 'FAILED';
  bytes: bigint;
  contentType: string | null;
  originalKey: string | null;
  durationMs: number | null;
  metadata: unknown;
}

interface FakeAttachment {
  id: string;
  lessonId: string;
  assetId: string;
  kind: 'VIDEO' | 'AUDIO' | 'IMAGE' | 'DOC' | 'PDF';
  role: string;
  position: number;
}

interface FakeLesson {
  id: string;
  groupId: string;
  teacherId: string;
}

class FakeDB {
  liveSessions = new Map<string, FakeLiveSession>();
  recordings = new Map<string, FakeRecording>();
  recordingsBySession = new Map<string, string>();
  mediaAssets = new Map<string, FakeMediaAsset>();
  attachments: FakeAttachment[] = [];
  lessons = new Map<string, FakeLesson>();
  outboxKeys = new Set<string>();
  /** Sessions that have ever reached LIVE (i.e. were created by start). */
  everReachedLive = new Set<string>();

  private seq = 0;
  nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }
}

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on (${target.join(',')})`,
    { code: 'P2002', clientVersion: 'test', meta: { target } },
  );
}

/**
 * Build a Prisma-shaped fake. Only the surface RecordingService /
 * LiveSessionRepository / RecordingRepository / OutboxService actually use
 * is implemented; anything else throws so unintended writes surface loudly.
 */
function buildFakePrisma(db: FakeDB): {
  client: any;
  outboxCreate: jest.Mock;
} {
  const liveSessionTable = {
    findUnique: jest.fn(async (args: any) => {
      const id = args?.where?.id;
      const row = id ? db.liveSessions.get(id) : undefined;
      return row ? { ...row } : null;
    }),
    findFirst: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      for (const row of db.liveSessions.values()) {
        if (where.lessonId && row.lessonId !== where.lessonId) continue;
        if (where.status?.in && !where.status.in.includes(row.status)) continue;
        return { ...row };
      }
      return null;
    }),
    findMany: jest.fn(async () => []),
    create: jest.fn(async (args: any) => {
      const data = args.data;
      // Enforce roomId @unique
      if (data.roomId) {
        for (const r of db.liveSessions.values()) {
          if (r.roomId === data.roomId) throw p2002(['roomId']);
        }
      }
      const row: FakeLiveSession = {
        id: data.id ?? db.nextId('sess'),
        lessonId: data.lessonId,
        status: data.status,
        startedAt: data.startedAt ?? null,
        endedAt: null,
        roomId: data.roomId ?? null,
        recorderRef: null,
      };
      db.liveSessions.set(row.id, row);
      return { ...row };
    }),
    updateMany: jest.fn(async (args: any) => {
      const where = args.where;
      const data = args.data;
      let count = 0;
      for (const row of db.liveSessions.values()) {
        if (where.id && row.id !== where.id) continue;
        if (where.recorderRef === null && row.recorderRef !== null) continue;
        if (where.status?.in && !where.status.in.includes(row.status)) continue;
        if (data.status !== undefined) row.status = data.status;
        if (data.recorderRef !== undefined) row.recorderRef = data.recorderRef;
        if (data.endedAt !== undefined) row.endedAt = data.endedAt;
        count++;
      }
      return { count };
    }),
  };

  const lessonTable = {
    findUnique: jest.fn(async (args: any) => {
      const id = args?.where?.id;
      const lesson = id ? db.lessons.get(id) : undefined;
      if (!lesson) return null;
      // Mirror the production include shape used by both
      // RecordingService.loadOwnerUserId and LiveService.assertTeacherOwnsLesson.
      return {
        id: lesson.id,
        groupId: lesson.groupId,
        group: { course: { teacherId: lesson.teacherId } },
      };
    }),
  };

  const recordingTable = {
    findUnique: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      let id: string | undefined;
      if (where.sessionId) {
        id = db.recordingsBySession.get(where.sessionId);
      } else if (where.id) {
        id = where.id;
      }
      const row = id ? db.recordings.get(id) : undefined;
      return row ? { ...row } : null;
    }),
    create: jest.fn(async (args: any) => {
      const data = args.data;
      // Enforce Recording.sessionId @unique — production relies on this for
      // the idempotent retry path.
      if (db.recordingsBySession.has(data.sessionId)) {
        throw p2002(['sessionId']);
      }
      const row: FakeRecording = {
        id: db.nextId('rec'),
        lessonId: data.lessonId,
        sessionId: data.sessionId,
        status: data.status,
        assetId: data.assetId ?? null,
        durationMs: data.durationMs ?? null,
        createdAt: new Date(),
      };
      db.recordings.set(row.id, row);
      db.recordingsBySession.set(row.sessionId, row.id);
      return { ...row };
    }),
  };

  const mediaAssetTable = {
    create: jest.fn(async (args: any) => {
      const data = args.data;
      const row: FakeMediaAsset = {
        id: db.nextId('asset'),
        ownerUserId: data.ownerUserId,
        kind: data.kind,
        status: data.status,
        bytes: data.bytes ?? BigInt(0),
        contentType: data.contentType ?? null,
        originalKey: data.originalKey ?? null,
        durationMs: data.durationMs ?? null,
        metadata: data.metadata ?? null,
      };
      db.mediaAssets.set(row.id, row);
      return { ...row };
    }),
  };

  const attachmentTable = {
    count: jest.fn(async (args: any) => {
      const lessonId = args?.where?.lessonId;
      return db.attachments.filter((a) => a.lessonId === lessonId).length;
    }),
    create: jest.fn(async (args: any) => {
      const data = args.data;
      const row: FakeAttachment = {
        id: db.nextId('att'),
        lessonId: data.lessonId,
        assetId: data.assetId,
        kind: data.kind,
        role: data.role,
        position: data.position ?? 0,
      };
      db.attachments.push(row);
      return { ...row };
    }),
  };

  const outboxCreate = jest.fn(async (tx: any, evt: any) => {
    if (db.outboxKeys.has(evt.idempotencyKey)) return null;
    db.outboxKeys.add(evt.idempotencyKey);
    return 'outbox-id';
  });

  const client: any = {
    liveSession: liveSessionTable,
    lesson: lessonTable,
    recording: recordingTable,
    mediaAsset: mediaAssetTable,
    attachment: attachmentTable,
    $transaction: jest.fn(async (fn: any) => fn(client)),
  };

  return { client, outboxCreate };
}

// ---------------------------------------------------------------------------
// Lifecycle helpers — exercised in place of LiveService (which is out of
// scope for Property 6; we drive the LiveSession state machine directly so
// the test focuses on the recorder lifecycle).
// ---------------------------------------------------------------------------

interface SessionWorld {
  /** Populated by the `start` op once the LiveSession row exists in the fake DB. */
  sessionId: string | null;
  lessonId: string;
  teacherId: string;
  /** Recorder outcome on the FIRST finalize call. Subsequent retries hit
   *  the idempotent fast path and never reach the recorder. */
  outcome: 'success' | 'failure';
  /** Number of finalize attempts (≥1). */
  retries: number;
}

async function startSessionInWorld(
  db: FakeDB,
  liveSessionRepository: LiveSessionRepository,
  recordingService: RecordingService,
  world: SessionWorld,
  index: number,
): Promise<void> {
  // Insert the LiveSession in LIVE state — this is what
  // LiveSessionRepository.createActive does in production.
  const created = await liveSessionRepository.createActive({
    lessonId: world.lessonId,
    roomId: `router-${index}-${world.lessonId}`,
  });
  world.sessionId = created.id;
  db.everReachedLive.add(created.id);

  // Start the recorder so finalize has a recorderRef to consume.
  await recordingService.startRecording(created.id);
}

async function endSessionInWorld(
  liveSessionRepository: LiveSessionRepository,
  world: SessionWorld,
): Promise<void> {
  if (!world.sessionId) return;
  await liveSessionRepository.transitionToEnded(world.sessionId);
}

async function finalizeSessionInWorld(
  recorder: FakeRecorderAdapter,
  recordingService: RecordingService,
  world: SessionWorld,
  finalizeIdx: number,
): Promise<void> {
  if (!world.sessionId) return;
  // Only the FIRST finalize call actually drives the recorder — every
  // retry hits the recordingRepository.findBySessionId fast-path. For the
  // first call we enqueue the desired outcome on the FIFO queue so the
  // adapter returns it on this exact call.
  if (finalizeIdx === 0 && world.outcome === 'failure') {
    recorder.enqueueFinalizeResult({
      failure: `simulated finalize failure for ${world.sessionId}`,
    });
  }
  await recordingService.finalizeRecording(world.sessionId);
}

// ---------------------------------------------------------------------------
// Operation interleaving
// ---------------------------------------------------------------------------

type OpKind = 'start' | 'end' | 'finalize';
interface Op {
  worldIdx: number;
  kind: OpKind;
  /** Index among that session's finalize calls (0 = first, 1 = first retry, ...). */
  finalizeIdx?: number;
}

/**
 * Build the per-session ordered op list:
 *   [start, end, finalize×retries]
 *
 * This preserves the production ordering (end happens before finalize) so
 * the success branch of `applySuccess` observes LiveSession.status = ENDED
 * — RecordingService.applySuccess doesn't itself flip the LiveSession to
 * ENDED, that's the responsibility of `LiveService.endSession` /
 * `live.ended` outbox processing in production.
 */
function buildPerSessionOps(world: SessionWorld, idx: number): Op[] {
  const ops: Op[] = [
    { worldIdx: idx, kind: 'start' },
    { worldIdx: idx, kind: 'end' },
  ];
  for (let i = 0; i < world.retries; i++) {
    ops.push({ worldIdx: idx, kind: 'finalize', finalizeIdx: i });
  }
  return ops;
}

/**
 * Interleave per-session op lists into a single sequence while preserving
 * each session's intra-order. Driven by a stream of session-index picks
 * from fast-check; once a session's queue is drained the pick is ignored.
 * Any leftover ops are appended at the end so every operation runs.
 */
function interleavePicks(
  perSessionOps: Op[][],
  picks: number[],
): Op[] {
  const cursors: number[] = new Array(perSessionOps.length).fill(0);
  const out: Op[] = [];
  for (const pick of picks) {
    if (pick < 0 || pick >= perSessionOps.length) continue;
    const ops = perSessionOps[pick];
    if (!ops) continue;
    const cursor = cursors[pick] ?? 0;
    if (cursor < ops.length) {
      const op = ops[cursor];
      if (op) {
        out.push(op);
        cursors[pick] = cursor + 1;
      }
    }
  }
  // Drain anything left so every session reaches a terminal state.
  for (let i = 0; i < perSessionOps.length; i++) {
    const ops = perSessionOps[i];
    if (!ops) continue;
    while ((cursors[i] ?? 0) < ops.length) {
      const op = ops[cursors[i] ?? 0];
      if (op) {
        out.push(op);
        cursors[i] = (cursors[i] ?? 0) + 1;
      } else {
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Invariant checks (asserted on the post-state)
// ---------------------------------------------------------------------------

function assertInvariants(db: FakeDB, worlds: SessionWorld[]): void {
  // I1 — Req 9.8: every LiveSession that reached LIVE is terminal.
  for (const sessionId of db.everReachedLive) {
    const row = db.liveSessions.get(sessionId);
    if (!row) {
      throw new Error(`[I1] LiveSession ${sessionId} disappeared from DB`);
    }
    if (row.status !== 'ENDED' && row.status !== 'RECORDING_FAILED') {
      throw new Error(
        `[I1] LiveSession ${sessionId} stuck in non-terminal status=${row.status}`,
      );
    }
  }

  for (const world of worlds) {
    if (!world.sessionId) {
      // The world never ran its `start` op (e.g. the picks drained the
      // queue before reaching it). The drain pass guarantees this only
      // happens if `start` was never queued, which contradicts
      // `buildPerSessionOps`. Treat as a test bug.
      throw new Error(
        `[setup] world for lesson ${world.lessonId} never started`,
      );
    }
    // I4 — idempotency: exactly one Recording row per session, regardless
    // of retry count.
    const recordingsForSession = [...db.recordings.values()].filter(
      (r) => r.sessionId === world.sessionId,
    );
    if (recordingsForSession.length !== 1) {
      throw new Error(
        `[I4] session ${world.sessionId} has ${recordingsForSession.length} Recording rows ` +
          `(expected exactly 1 across ${world.retries} finalize attempts)`,
      );
    }
    const recording = recordingsForSession[0]!;

    if (world.outcome === 'success') {
      // I2 — Req 9.6: success branch produces READY recording + UPLOADED
      // VIDEO MediaAsset + Attachment, LiveSession ENDED.
      if (recording.status !== RECORDING_STATUS.READY) {
        throw new Error(
          `[I2] session ${world.sessionId} expected Recording.status=READY ` +
            `but got ${recording.status}`,
        );
      }
      if (!recording.assetId) {
        throw new Error(
          `[I2] session ${world.sessionId} READY recording has no assetId`,
        );
      }
      const asset = db.mediaAssets.get(recording.assetId);
      if (!asset) {
        throw new Error(
          `[I2] session ${world.sessionId} READY recording references missing asset ${recording.assetId}`,
        );
      }
      if (asset.kind !== 'VIDEO' || asset.status !== 'UPLOADED') {
        throw new Error(
          `[I2] session ${world.sessionId} asset has kind=${asset.kind} status=${asset.status} ` +
            `(expected VIDEO/UPLOADED)`,
        );
      }
      // Exactly one MediaAsset created for this session — duplicates would
      // mean a non-idempotent retry. We track this by metadata.sessionId.
      const assetsForSession = [...db.mediaAssets.values()].filter(
        (a) =>
          a.metadata &&
          typeof a.metadata === 'object' &&
          (a.metadata as { sessionId?: string }).sessionId === world.sessionId,
      );
      if (assetsForSession.length !== 1) {
        throw new Error(
          `[I2] session ${world.sessionId} has ${assetsForSession.length} MediaAsset rows ` +
            `(expected exactly 1)`,
        );
      }
      // Exactly one Attachment for the asset.
      const attachments = db.attachments.filter(
        (a) => a.assetId === recording.assetId,
      );
      if (attachments.length !== 1) {
        throw new Error(
          `[I2] session ${world.sessionId} has ${attachments.length} Attachment rows ` +
            `(expected exactly 1)`,
        );
      }
      const att = attachments[0]!;
      if (
        att.lessonId !== world.lessonId ||
        att.kind !== 'VIDEO' ||
        att.role !== 'recording'
      ) {
        throw new Error(
          `[I2] session ${world.sessionId} attachment shape unexpected: ${JSON.stringify(att)}`,
        );
      }
      // LiveSession must be ENDED on success path.
      const sess = db.liveSessions.get(world.sessionId)!;
      if (sess.status !== 'ENDED') {
        throw new Error(
          `[I2] session ${world.sessionId} expected ENDED on success path, got ${sess.status}`,
        );
      }
    } else {
      // I3 — Req 9.7: failure branch produces FAILED Recording, no asset /
      // attachment, LiveSession RECORDING_FAILED.
      if (recording.status !== RECORDING_STATUS.FAILED) {
        throw new Error(
          `[I3] session ${world.sessionId} expected Recording.status=FAILED ` +
            `but got ${recording.status}`,
        );
      }
      if (recording.assetId !== null) {
        throw new Error(
          `[I3] session ${world.sessionId} FAILED recording must have assetId=null, ` +
            `got ${recording.assetId}`,
        );
      }
      const assetsForSession = [...db.mediaAssets.values()].filter(
        (a) =>
          a.metadata &&
          typeof a.metadata === 'object' &&
          (a.metadata as { sessionId?: string }).sessionId === world.sessionId,
      );
      if (assetsForSession.length !== 0) {
        throw new Error(
          `[I3] session ${world.sessionId} has ${assetsForSession.length} MediaAsset rows ` +
            `(expected 0 on failure path)`,
        );
      }
      const sess = db.liveSessions.get(world.sessionId)!;
      if (sess.status !== 'RECORDING_FAILED') {
        throw new Error(
          `[I3] session ${world.sessionId} expected RECORDING_FAILED on failure path, ` +
            `got ${sess.status}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

const sessionSpecArb = fc.record({
  outcome: fc.constantFrom<'success' | 'failure'>('success', 'failure'),
  retries: fc.integer({ min: 1, max: 3 }),
});

describe('RecordingService — Property 6: Live recording completion', () => {
  it('every LiveSession reaches a terminal status with a single Recording, MediaAsset and Attachment shaped to the outcome [Validates: Requirements 9.5, 9.6, 9.7, 9.8]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(sessionSpecArb, { minLength: 1, maxLength: 6 }),
        // Pick stream for interleaving — at most ~ N*8 picks so a session
        // can be advanced through start, end, and several finalize retries
        // even if some picks land on already-drained sessions.
        fc
          .array(fc.nat({ max: 5 }), { minLength: 0, maxLength: 60 })
          .map((picks) => picks),
        async (specs, picks) => {
          // ---- Build the world ----
          const db = new FakeDB();
          const worlds: SessionWorld[] = specs.map((spec, i) => {
            const lessonId = `lesson-${i}`;
            const teacherId = `teacher-${i}`;
            db.lessons.set(lessonId, {
              id: lessonId,
              groupId: `group-${i}`,
              teacherId,
            });
            return {
              sessionId: null,
              lessonId,
              teacherId,
              outcome: spec.outcome,
              retries: spec.retries,
            };
          });

          const { client: prisma, outboxCreate } = buildFakePrisma(db);
          const liveSessionRepository = new LiveSessionRepository(prisma);
          const recordingRepository = new RecordingRepository(prisma);
          const outboxService = {
            create: outboxCreate,
          } as unknown as OutboxService;

          const recorder = new FakeRecorderAdapter();
          const transcodingQueue = {
            // The transcode queue is irrelevant to Property 6 — we still
            // need the .add jest.fn so the service's enqueue path doesn't
            // explode.
            add: jest.fn().mockResolvedValue({ id: 'job-x' }),
          };

          const service = new RecordingService(
            prisma,
            liveSessionRepository,
            recordingRepository,
            outboxService,
            recorder,
            transcodingQueue as never,
          );

          // ---- Build interleaved op stream ----
          const perSessionOps = worlds.map((w, i) => buildPerSessionOps(w, i));
          // Cap picks so they only reference valid session indices.
          const cappedPicks = picks.map((p) => p % Math.max(1, worlds.length));
          const ops = interleavePicks(perSessionOps, cappedPicks);

          // ---- Apply ----
          for (const op of ops) {
            const world = worlds[op.worldIdx]!;
            switch (op.kind) {
              case 'start':
                await startSessionInWorld(
                  db,
                  liveSessionRepository,
                  service,
                  world,
                  op.worldIdx,
                );
                break;
              case 'end':
                await endSessionInWorld(liveSessionRepository, world);
                break;
              case 'finalize':
                await finalizeSessionInWorld(
                  recorder,
                  service,
                  world,
                  op.finalizeIdx ?? 0,
                );
                break;
            }
          }

          // ---- Assert post-state invariants ----
          assertInvariants(db, worlds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
