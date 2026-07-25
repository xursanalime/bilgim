import { WsException } from '@nestjs/websockets';
import type { PrismaClient } from '@prisma/client';

import { LiveGateway } from './live.gateway';
import { assertWsLessonAccess } from './access/ws-lesson-access';
import { parseWsOriginList, resolveWsCorsOptions } from './ws-cors';
import type { WsAuthUser } from './chat/ws-jwt.guard';

/**
 * Regression suite for the `LiveGateway` authorization boundary.
 *
 * Before these checks existed the gateway only verified "is this socket
 * logged in". Every handler then trusted a client-supplied `lessonId`,
 * which meant any authenticated account could:
 *   - join any teacher's live classroom (`live:join`),
 *   - consume its audio/video producers (`live:consume`) — i.e. silently
 *     watch a paid class it was never enrolled in,
 *   - publish its own media into it (`live:produce`),
 *   - draw on its whiteboard, and
 *   - kick its participants, as long as the account's role was TEACHER.
 */

// ---------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  join: jest.Mock;
  to: jest.Mock;
}

function makeSocket(user?: WsAuthUser, id = 'sock_1'): FakeSocket {
  return {
    id,
    data: user ? { user, authenticatedAt: Date.now() } : {},
    join: jest.fn(async () => undefined),
    to: jest.fn(() => ({ emit: jest.fn() })),
  };
}

const TEACHER: WsAuthUser = {
  sub: 'teacher-1',
  email: 't@x.io',
  role: 'TEACHER',
};
const OTHER_TEACHER: WsAuthUser = {
  sub: 'teacher-2',
  email: 't2@x.io',
  role: 'TEACHER',
};
const STUDENT: WsAuthUser = {
  sub: 'student-1',
  email: 's@x.io',
  role: 'STUDENT',
};
const OUTSIDER: WsAuthUser = {
  sub: 'student-9',
  email: 's9@x.io',
  role: 'STUDENT',
};

const LESSON_ID = 'lesson-1';
const GROUP_ID = 'group-1';

/**
 * Prisma double covering the two reads `assertWsLessonAccess` performs.
 * `approvedStudents` is the set of students with an APPROVED enrollment.
 */
function makePrisma(approvedStudents: string[] = [STUDENT.sub]) {
  return {
    lesson: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === LESSON_ID
          ? {
              id: LESSON_ID,
              groupId: GROUP_ID,
              group: { course: { teacherId: TEACHER.sub } },
            }
          : null,
      ),
    },
    enrollment: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { groupId_studentId: { studentId: string } };
        }) =>
          approvedStudents.includes(where.groupId_studentId.studentId)
            ? { status: 'APPROVED' }
            : null,
      ),
    },
  } as unknown as PrismaClient;
}

function makeGateway(prisma: PrismaClient = makePrisma()) {
  const sfuService = {
    ensureRoomForLesson: jest.fn(async () => ({ rtpCapabilities: {} })),
    listProducers: jest.fn(() => []),
    createTransport: jest.fn(async () => ({
      id: 'transport-1',
      iceParameters: {},
      iceCandidates: [],
      dtlsParameters: {},
      sctpParameters: {},
    })),
    connectTransport: jest.fn(async () => undefined),
    addProducer: jest.fn(async () => ({ id: 'producer-1', kind: 'video' })),
    addConsumer: jest.fn(async () => ({ id: 'consumer-1' })),
    resumeConsumer: jest.fn(async () => undefined),
  };
  const liveSessionRepository = {
    findActiveByLessonId: jest.fn(async () => ({ status: 'LIVE' })),
  };

  const gateway = new LiveGateway(
    prisma,
    {} as never, // TokensService        — only used by handleConnection
    {} as never, // SessionValidatorService — ditto
    {} as never, // LiveService
    sfuService as never,
    liveSessionRepository as never,
  );
  (gateway as unknown as { server: unknown }).server = {
    to: jest.fn(() => ({ emit: jest.fn() })),
  };
  return { gateway, sfuService, liveSessionRepository };
}

/** Drive a socket through a successful `live:join`. */
async function join(
  gateway: LiveGateway,
  socket: FakeSocket,
  lessonId = LESSON_ID,
) {
  return gateway.onJoin(socket as never, { lessonId, name: 'X' });
}

// ---------------------------------------------------------------------
// assertWsLessonAccess — the shared policy
// ---------------------------------------------------------------------

describe('assertWsLessonAccess', () => {
  it('admits the owning teacher as a moderator', async () => {
    await expect(
      assertWsLessonAccess(makePrisma(), TEACHER, LESSON_ID),
    ).resolves.toMatchObject({ isOwningTeacher: true });
  });

  it('admits an enrolled student as a non-moderator', async () => {
    await expect(
      assertWsLessonAccess(makePrisma(), STUDENT, LESSON_ID),
    ).resolves.toMatchObject({ isOwningTeacher: false });
  });

  it('rejects a teacher who does not own the lesson', async () => {
    await expect(
      assertWsLessonAccess(makePrisma(), OTHER_TEACHER, LESSON_ID),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects a student with no approved enrollment', async () => {
    await expect(
      assertWsLessonAccess(makePrisma(), OUTSIDER, LESSON_ID),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects an unknown lesson', async () => {
    await expect(
      assertWsLessonAccess(makePrisma(), TEACHER, 'nope'),
    ).rejects.toBeInstanceOf(WsException);
  });
});

// ---------------------------------------------------------------------
// live:join
// ---------------------------------------------------------------------

describe('LiveGateway live:join', () => {
  it('admits an enrolled student', async () => {
    const { gateway } = makeGateway();
    const res = await join(gateway, makeSocket(STUDENT));
    expect(res).not.toHaveProperty('error');
    expect(res).toMatchObject({ role: 'STUDENT', isModerator: false });
  });

  it('refuses a student with no approved enrollment', async () => {
    const { gateway, sfuService } = makeGateway();
    const res = await join(gateway, makeSocket(OUTSIDER));
    expect(res).toMatchObject({
      error: { code: 'LESSON_ACCESS_DENIED' },
    });
    // The room is never even created for an unauthorized caller.
    expect(sfuService.ensureRoomForLesson).not.toHaveBeenCalled();
  });

  it('refuses a teacher from a different course', async () => {
    const { gateway } = makeGateway();
    const res = await join(gateway, makeSocket(OTHER_TEACHER));
    expect(res).toMatchObject({ error: { code: 'NOT_OWNING_TEACHER' } });
  });

  it('marks the owning teacher as a moderator', async () => {
    const { gateway } = makeGateway();
    const res = await join(gateway, makeSocket(TEACHER));
    expect(res).toMatchObject({ isModerator: true });
  });
});

// ---------------------------------------------------------------------
// SFU handlers — must require a completed join
// ---------------------------------------------------------------------

describe('LiveGateway SFU handlers', () => {
  it('refuses transport creation from a socket that never joined', async () => {
    const { gateway, sfuService } = makeGateway();
    const res = await gateway.onCreateTransport(makeSocket(OUTSIDER) as never, {
      lessonId: LESSON_ID,
    });
    expect(res).toMatchObject({ error: { code: 'NOT_IN_LESSON' } });
    expect(sfuService.createTransport).not.toHaveBeenCalled();
  });

  it('refuses consuming another classroom’s producers', async () => {
    const { gateway, sfuService } = makeGateway();
    const outsider = makeSocket(OUTSIDER);

    const res = await gateway.onConsume(outsider as never, {
      lessonId: LESSON_ID,
      transportId: 'transport-1',
      producerId: 'producer-1',
      rtpCapabilities: {},
    });

    expect(res).toMatchObject({ error: { code: 'NOT_IN_LESSON' } });
    expect(sfuService.addConsumer).not.toHaveBeenCalled();
  });

  it('refuses producing into a lesson the socket did not join', async () => {
    const { gateway, sfuService } = makeGateway();
    const res = await gateway.onProduce(makeSocket(OUTSIDER) as never, {
      lessonId: LESSON_ID,
      transportId: 'transport-1',
      kind: 'audio',
      rtpParameters: {},
    });
    expect(res).toMatchObject({ error: { code: 'NOT_IN_LESSON' } });
    expect(sfuService.addProducer).not.toHaveBeenCalled();
  });

  it('refuses a transport id the socket does not own', async () => {
    const { gateway, sfuService } = makeGateway();
    const student = makeSocket(STUDENT);
    await join(gateway, student);

    // Joined, but `transport-999` belongs to a peer.
    const res = await gateway.onConnectTransport(student as never, {
      lessonId: LESSON_ID,
      transportId: 'transport-999',
      dtlsParameters: {},
    });

    expect(res).toMatchObject({ error: { code: 'TRANSPORT_NOT_OWNED' } });
    expect(sfuService.connectTransport).not.toHaveBeenCalled();
  });

  it('allows a joined participant to use its own transport', async () => {
    const { gateway, sfuService } = makeGateway();
    const student = makeSocket(STUDENT);
    await join(gateway, student);

    const created = await gateway.onCreateTransport(student as never, {
      lessonId: LESSON_ID,
    });
    expect(created).toMatchObject({ id: 'transport-1' });

    const connected = await gateway.onConnectTransport(student as never, {
      lessonId: LESSON_ID,
      transportId: 'transport-1',
      dtlsParameters: {},
    });
    expect(connected).toEqual({ ok: true });
    expect(sfuService.connectTransport).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// Classroom moderation
// ---------------------------------------------------------------------

describe('LiveGateway classroom moderation', () => {
  it('refuses whiteboard writes from a socket that never joined', async () => {
    const { gateway } = makeGateway();
    await expect(
      gateway.onWhiteboardDraw(makeSocket(OUTSIDER) as never, {
        lessonId: LESSON_ID,
        data: {},
      }),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('refuses a kick from an enrolled student', async () => {
    const { gateway } = makeGateway();
    const student = makeSocket(STUDENT);
    await join(gateway, student);

    await expect(
      gateway.onKickParticipant(student as never, {
        lessonId: LESSON_ID,
        targetSocketId: 'sock_other',
      }),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('refuses a kick targeting a socket outside the room', async () => {
    const { gateway } = makeGateway();
    const teacher = makeSocket(TEACHER, 'sock_teacher');
    await join(gateway, teacher);

    // `targetSocketId` is client-supplied — it must not be able to
    // address a participant of some other lesson.
    await expect(
      gateway.onKickParticipant(teacher as never, {
        lessonId: LESSON_ID,
        targetSocketId: 'sock_in_another_lesson',
      }),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('lets the owning teacher kick a participant in the room', async () => {
    const { gateway } = makeGateway();
    const teacher = makeSocket(TEACHER, 'sock_teacher');
    const student = makeSocket(STUDENT, 'sock_student');
    await join(gateway, teacher);
    await join(gateway, student);

    await expect(
      gateway.onKickParticipant(teacher as never, {
        lessonId: LESSON_ID,
        targetSocketId: 'sock_student',
      }),
    ).resolves.toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------
// WebSocket CORS
// ---------------------------------------------------------------------

describe('resolveWsCorsOptions', () => {
  const allow = (origin: string | undefined, env: NodeJS.ProcessEnv) =>
    new Promise<boolean>((resolve) => {
      resolveWsCorsOptions(env).origin(origin, (err, ok) =>
        resolve(!err && ok === true),
      );
    });

  const ENV = {
    WEB_ORIGIN: 'https://bilgim.uz,https://www.bilgim.uz',
  } as NodeJS.ProcessEnv;

  it('accepts an allow-listed origin', async () => {
    await expect(allow('https://bilgim.uz', ENV)).resolves.toBe(true);
  });

  it('rejects an arbitrary origin instead of reflecting it', async () => {
    // `origin: true` reflected anything back with credentials allowed —
    // the session cookie is scoped to `.bilgim.uz`, so that turned any
    // same-site page into an authenticated-socket vector.
    await expect(allow('https://evil.example', ENV)).resolves.toBe(false);
  });

  it('rejects a teacher subdomain that is not explicitly allow-listed', async () => {
    await expect(allow('https://aziz.bilgim.uz', ENV)).resolves.toBe(false);
  });

  it('allows non-browser callers that send no Origin', async () => {
    await expect(allow(undefined, ENV)).resolves.toBe(true);
  });

  it('normalises trailing slashes in the allow-list', () => {
    expect(parseWsOriginList('https://a.io/, https://b.io')).toEqual([
      'https://a.io',
      'https://b.io',
    ]);
  });
});
