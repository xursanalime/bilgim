import { WsException } from '@nestjs/websockets';

import {
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  LiveChatGateway,
  MAX_CHAT_MESSAGE_LENGTH,
} from './live-chat.gateway';
import {
  WS_REVALIDATE_INTERVAL_MS,
  authenticateSocket,
  WsJwtGuard,
} from './ws-jwt.guard';
import type { SessionValidatorService } from '../../auth/session-validator.service';
import type { TokensService } from '../../auth/tokens.service';

/**
 * Lightweight Socket.io stand-in. We don't spin up a real server here:
 * the gateway is a thin shell over `socket.join/leave/emit` and a few
 * helpers, and the tests are clearer when we can read back the exact
 * sequence of emitted events.
 */
interface EmittedEvent {
  scope: 'self' | 'others' | 'room';
  event: string;
  payload: unknown;
}

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  handshake: {
    auth: { token?: string };
    query: Record<string, string | string[] | undefined>;
    headers: Record<string, string>;
  };
  rooms: Set<string>;
  emitted: EmittedEvent[];
  disconnected: boolean;
  join: (room: string) => Promise<void>;
  leave: (room: string) => Promise<void>;
  emit: (event: string, payload: unknown) => boolean;
  disconnect: (close?: boolean) => void;
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
}

function makeSocket(opts: { id?: string; token?: string } = {}): FakeSocket {
  const id = opts.id ?? `sock_${Math.random().toString(36).slice(2, 8)}`;
  const socket: FakeSocket = {
    id,
    data: {},
    handshake: {
      auth: opts.token ? { token: opts.token } : {},
      query: {},
      headers: {},
    },
    rooms: new Set([id]),
    emitted: [],
    disconnected: false,
    join: jest.fn(async (room: string) => {
      socket.rooms.add(room);
    }),
    leave: jest.fn(async (room: string) => {
      socket.rooms.delete(room);
    }),
    emit: jest.fn((event: string, payload: unknown) => {
      socket.emitted.push({ scope: 'self', event, payload });
      return true;
    }),
    disconnect: jest.fn((_close?: boolean) => {
      socket.disconnected = true;
    }),
    to: jest.fn((room: string) => ({
      emit: (event: string, payload: unknown) => {
        socket.emitted.push({
          scope: 'others',
          event,
          payload: { __room: room, ...((payload as object) ?? {}) },
        });
      },
    })),
  };
  return socket;
}

interface FakeServer {
  emitted: EmittedEvent[];
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
}

function makeServer(): FakeServer {
  const server: FakeServer = {
    emitted: [],
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        server.emitted.push({
          scope: 'room',
          event,
          payload: { __room: room, ...((payload as object) ?? {}) },
        });
      },
    }),
  };
  return server;
}

interface FakePrisma {
  lesson: { findUnique: jest.Mock };
  enrollment: { findUnique: jest.Mock };
  chatRoom: { upsert: jest.Mock };
  chatMessage: { create: jest.Mock };
}

function makePrisma(overrides: Partial<FakePrisma> = {}): FakePrisma {
  return {
    lesson: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lesson-1',
        groupId: 'group-1',
        group: { course: { teacherId: 'teacher-1' } },
      }),
    },
    enrollment: {
      findUnique: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    },
    chatRoom: {
      upsert: jest.fn().mockResolvedValue({ id: 'room-1' }),
    },
    chatMessage: {
      create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    },
    ...overrides,
  };
}

function makeTokens(payload?: {
  sub: string;
  email: string;
  role: string;
}): TokensService {
  return {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === 'bad') throw new Error('jwt malformed');
      return (
        payload ?? { sub: 'student-1', email: 's@x.io', role: 'STUDENT' }
      );
    }),
  } as unknown as TokensService;
}

/**
 * Pass-through `SessionValidatorService` double.
 *
 * The real one re-reads the user to enforce status/revocation and returns
 * the DB role; these gateway specs care about transport-level auth, so the
 * double just echoes the verified payload back. `session-validator` has
 * its own unit tests for the revocation rules.
 */
function makeSessions(): SessionValidatorService {
  return {
    validate: jest.fn(async (payload) => payload),
    invalidate: jest.fn(async () => undefined),
    revokeAllSessions: jest.fn(async () => undefined),
  } as unknown as SessionValidatorService;
}

function makeGateway(opts: {
  user?: { sub: string; email: string; role: string };
  prisma?: FakePrisma;
}): {
  gateway: LiveChatGateway;
  prisma: FakePrisma;
  server: FakeServer;
  tokens: TokensService;
} {
  const tokens = makeTokens(opts.user);
  const prisma = opts.prisma ?? makePrisma();
  const gateway = new LiveChatGateway(
    tokens,
    makeSessions(),
    prisma as unknown as ConstructorParameters<typeof LiveChatGateway>[2],
  );
  const server = makeServer();
  (gateway as unknown as { server: FakeServer }).server = server;
  return { gateway, prisma, server, tokens };
}

// --------------------------------------------------------------------
// authenticateSocket / WsJwtGuard
// --------------------------------------------------------------------

describe('authenticateSocket', () => {
  it('reads the token from handshake.auth and sets socket.data.user', async () => {
    const tokens = makeTokens({
      sub: 'u1',
      email: 'u@x.io',
      role: 'STUDENT',
    });
    const socket = makeSocket({ token: 'good' });

    const user = await authenticateSocket(
      socket as unknown as Parameters<typeof authenticateSocket>[0],
      tokens,
    );

    expect(user?.sub).toBe('u1');
    expect((socket.data as { user?: { sub: string } }).user?.sub).toBe('u1');
  });

  it('reads the token from the Authorization header as a fallback', async () => {
    const tokens = makeTokens();
    const socket = makeSocket();
    socket.handshake.headers.authorization = 'Bearer good';
    const user = await authenticateSocket(
      socket as unknown as Parameters<typeof authenticateSocket>[0],
      tokens,
    );
    expect(user?.sub).toBe('student-1');
  });

  it('returns null when no token is present', async () => {
    const tokens = makeTokens();
    const socket = makeSocket();
    const user = await authenticateSocket(
      socket as unknown as Parameters<typeof authenticateSocket>[0],
      tokens,
    );
    expect(user).toBeNull();
  });

  it('throws WsException when the token is invalid', async () => {
    const tokens = makeTokens();
    const socket = makeSocket({ token: 'bad' });
    await expect(
      authenticateSocket(
        socket as unknown as Parameters<typeof authenticateSocket>[0],
        tokens,
      ),
    ).rejects.toBeInstanceOf(WsException);
  });
});

describe('WsJwtGuard', () => {
  function buildContext(socket: FakeSocket) {
    return {
      switchToWs: () => ({
        getClient: <T,>() => socket as unknown as T,
      }),
    } as unknown as Parameters<WsJwtGuard['canActivate']>[0];
  }

  it('allows when socket.data.user was authenticated recently', async () => {
    const guard = new WsJwtGuard(makeTokens(), makeSessions());
    const socket = makeSocket();
    socket.data.user = { sub: 'u1', email: 'e', role: 'STUDENT' };
    socket.data.authenticatedAt = Date.now();
    await expect(guard.canActivate(buildContext(socket))).resolves.toBe(true);
  });

  it('re-authenticates once the cached principal goes stale', async () => {
    // A live-class socket stays open for the length of a lesson. Trusting
    // `socket.data.user` for the whole connection meant an expired token
    // or a suspended account kept full access until the client
    // disconnected, because the check only ever ran on connect.
    const guard = new WsJwtGuard(makeTokens(), makeSessions());
    const socket = makeSocket(); // no token on the handshake
    socket.data.user = { sub: 'u1', email: 'e', role: 'STUDENT' };
    socket.data.authenticatedAt = Date.now() - WS_REVALIDATE_INTERVAL_MS - 1;

    await expect(
      guard.canActivate(buildContext(socket)),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('authenticates from the handshake when missing', async () => {
    const guard = new WsJwtGuard(makeTokens(), makeSessions());
    const socket = makeSocket({ token: 'good' });
    await expect(guard.canActivate(buildContext(socket))).resolves.toBe(true);
    expect(
      (socket.data as { user?: { sub: string } }).user?.sub,
    ).toBeDefined();
  });

  it('rejects unauthenticated sockets with WsException', async () => {
    const guard = new WsJwtGuard(makeTokens(), makeSessions());
    const socket = makeSocket();
    await expect(guard.canActivate(buildContext(socket))).rejects.toBeInstanceOf(
      WsException,
    );
  });
});

// --------------------------------------------------------------------
// handleConnection
// --------------------------------------------------------------------

describe('LiveChatGateway.handleConnection', () => {
  it('initialises socket state for an authenticated socket', async () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket({ token: 'good' });

    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );

    expect(socket.disconnected).toBe(false);
    expect((socket.data as { user?: { sub: string } }).user?.sub).toBe(
      'student-1',
    );
    expect(
      (socket.data as { lessons?: Set<string> }).lessons instanceof Set,
    ).toBe(true);
  });

  it('disconnects sockets that arrive without a token', async () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket();
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    expect(socket.disconnected).toBe(true);
    expect(socket.emitted.find((e) => e.event === 'chat:error')).toBeDefined();
  });

  it('disconnects sockets with an invalid token', async () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket({ token: 'bad' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    expect(socket.disconnected).toBe(true);
    const err = socket.emitted.find((e) => e.event === 'chat:error');
    expect(err?.payload).toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

// --------------------------------------------------------------------
// chat:join
// --------------------------------------------------------------------

describe('LiveChatGateway.onJoin', () => {
  async function setup(
    user = { sub: 'student-1', email: 's@x.io', role: 'STUDENT' },
  ) {
    const { gateway, prisma, server } = makeGateway({ user });
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    return { gateway, prisma, server, socket };
  }

  it('joins lesson room for an APPROVED student (Req 9.9, Req 6)', async () => {
    const { gateway, socket } = await setup();
    const result = await gateway.onJoin(
      socket as unknown as Parameters<typeof gateway.onJoin>[0],
      { lessonId: 'lesson-1' },
    );
    expect(result).toEqual({ ok: true, lessonId: 'lesson-1' });
    expect(socket.rooms.has('lesson:lesson-1')).toBe(true);
    const others = socket.emitted.find(
      (e) => e.event === 'chat:joined' && e.scope === 'others',
    );
    expect(others?.payload).toMatchObject({
      lessonId: 'lesson-1',
      userId: 'student-1',
    });
  });

  it('rejects students without an APPROVED enrollment', async () => {
    const prisma = makePrisma({
      enrollment: {
        findUnique: jest.fn().mockResolvedValue({ status: 'PENDING' }),
      },
    });
    const { gateway } = makeGateway({ prisma });
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await expect(
      gateway.onJoin(
        socket as unknown as Parameters<typeof gateway.onJoin>[0],
        { lessonId: 'lesson-1' },
      ),
    ).rejects.toBeInstanceOf(WsException);
    expect(socket.rooms.has('lesson:lesson-1')).toBe(false);
  });

  it('lets the owning teacher join', async () => {
    const { gateway, socket } = await setup({
      sub: 'teacher-1',
      email: 't@x.io',
      role: 'TEACHER',
    });
    const result = await gateway.onJoin(
      socket as unknown as Parameters<typeof gateway.onJoin>[0],
      { lessonId: 'lesson-1' },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a non-owning teacher', async () => {
    const { gateway, socket } = await setup({
      sub: 'teacher-2',
      email: 't2@x.io',
      role: 'TEACHER',
    });
    await expect(
      gateway.onJoin(
        socket as unknown as Parameters<typeof gateway.onJoin>[0],
        { lessonId: 'lesson-1' },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects when lesson is missing', async () => {
    const prisma = makePrisma({
      lesson: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const { gateway } = makeGateway({ prisma });
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await expect(
      gateway.onJoin(
        socket as unknown as Parameters<typeof gateway.onJoin>[0],
        { lessonId: 'lesson-x' },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects when payload is malformed', async () => {
    const { gateway, socket } = await setup();
    await expect(
      gateway.onJoin(
        socket as unknown as Parameters<typeof gateway.onJoin>[0],
        {} as unknown as { lessonId: string },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });
});

// --------------------------------------------------------------------
// chat:message
// --------------------------------------------------------------------

describe('LiveChatGateway.onMessage', () => {
  async function joinedSetup(
    user = { sub: 'student-1', email: 's@x.io', role: 'STUDENT' },
  ) {
    const { gateway, prisma, server } = makeGateway({ user });
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await gateway.onJoin(
      socket as unknown as Parameters<typeof gateway.onJoin>[0],
      { lessonId: 'lesson-1' },
    );
    return { gateway, prisma, server, socket };
  }

  it('broadcasts to the lesson room and persists the message (Req 9.9)', async () => {
    const { gateway, prisma, server, socket } = await joinedSetup();

    const ack = await gateway.onMessage(
      socket as unknown as Parameters<typeof gateway.onMessage>[0],
      { lessonId: 'lesson-1', text: 'hello' },
    );

    expect(ack).toMatchObject({ ok: true, messageId: 'msg-1' });
    expect(prisma.chatRoom.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scope_scopeRef: { scope: 'LIVE_SESSION', scopeRef: 'lesson-1' },
        },
      }),
    );
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { roomId: 'room-1', authorId: 'student-1', body: 'hello' },
      }),
    );

    const broadcast = server.emitted.find((e) => e.event === 'chat:message');
    expect(broadcast?.payload).toMatchObject({
      __room: 'lesson:lesson-1',
      lessonId: 'lesson-1',
      senderId: 'student-1',
      text: 'hello',
      messageId: 'msg-1',
    });
  });

  it('still broadcasts even if persistence fails', async () => {
    const prisma = makePrisma();
    prisma.chatMessage.create.mockRejectedValueOnce(new Error('db down'));
    const { gateway } = makeGateway({ prisma });
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await gateway.onJoin(
      socket as unknown as Parameters<typeof gateway.onJoin>[0],
      { lessonId: 'lesson-1' },
    );

    const server = (gateway as unknown as { server: FakeServer }).server;
    const ack = await gateway.onMessage(
      socket as unknown as Parameters<typeof gateway.onMessage>[0],
      { lessonId: 'lesson-1', text: 'hi' },
    );
    expect(ack.ok).toBe(true);
    expect(ack.messageId).toBeUndefined();
    expect(server.emitted.some((e) => e.event === 'chat:message')).toBe(true);
  });

  it('rejects a message before chat:join', async () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await expect(
      gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: 'hi' },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects empty or whitespace-only text', async () => {
    const { gateway, socket } = await joinedSetup();
    await expect(
      gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: '   ' },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('rejects text over MAX_CHAT_MESSAGE_LENGTH', async () => {
    const { gateway, socket } = await joinedSetup();
    const tooLong = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
    await expect(
      gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: tooLong },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('enforces rate limit of 5 messages / second', async () => {
    const { gateway, socket } = await joinedSetup();
    for (let i = 0; i < CHAT_RATE_LIMIT_MAX; i++) {
      await gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: `msg-${i}` },
      );
    }
    await expect(
      gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: 'over' },
      ),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('resets the rate-limit window after CHAT_RATE_LIMIT_WINDOW_MS', async () => {
    const { gateway, socket } = await joinedSetup();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);

    for (let i = 0; i < CHAT_RATE_LIMIT_MAX; i++) {
      await gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: `msg-${i}` },
      );
    }

    spy.mockReturnValue(now + CHAT_RATE_LIMIT_WINDOW_MS + 1);
    // Should now be allowed again.
    await expect(
      gateway.onMessage(
        socket as unknown as Parameters<typeof gateway.onMessage>[0],
        { lessonId: 'lesson-1', text: 'after-window' },
      ),
    ).resolves.toMatchObject({ ok: true });

    spy.mockRestore();
  });
});

// --------------------------------------------------------------------
// chat:leave + handleDisconnect
// --------------------------------------------------------------------

describe('LiveChatGateway.onLeave', () => {
  async function joinedSetup() {
    const { gateway, prisma, server } = makeGateway({});
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await gateway.onJoin(
      socket as unknown as Parameters<typeof gateway.onJoin>[0],
      { lessonId: 'lesson-1' },
    );
    return { gateway, prisma, server, socket };
  }

  it('removes the socket from the room and notifies peers', async () => {
    const { gateway, socket } = await joinedSetup();
    const result = await gateway.onLeave(
      socket as unknown as Parameters<typeof gateway.onLeave>[0],
      { lessonId: 'lesson-1' },
    );
    expect(result).toEqual({ ok: true, lessonId: 'lesson-1' });
    expect(socket.rooms.has('lesson:lesson-1')).toBe(false);
    expect(
      socket.emitted.some(
        (e) => e.event === 'chat:left' && e.scope === 'others',
      ),
    ).toBe(true);
  });

  it('is idempotent for an unjoined lesson', async () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    const result = await gateway.onLeave(
      socket as unknown as Parameters<typeof gateway.onLeave>[0],
      { lessonId: 'lesson-1' },
    );
    expect(result.ok).toBe(true);
  });
});

describe('LiveChatGateway.handleDisconnect', () => {
  it('cleans up every joined room and emits chat:left for peers', async () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket({ token: 'good' });
    await gateway.handleConnection(
      socket as unknown as Parameters<typeof gateway.handleConnection>[0],
    );
    await gateway.onJoin(
      socket as unknown as Parameters<typeof gateway.onJoin>[0],
      { lessonId: 'lesson-1' },
    );

    socket.emitted.length = 0; // clear chat:joined leftovers

    gateway.handleDisconnect(
      socket as unknown as Parameters<typeof gateway.handleDisconnect>[0],
    );

    expect(socket.rooms.has('lesson:lesson-1')).toBe(false);
    expect(
      (socket.data as { lessons?: Set<string> }).lessons?.size ?? 0,
    ).toBe(0);
    const left = socket.emitted.find(
      (e) => e.event === 'chat:left' && e.scope === 'others',
    );
    expect(left).toBeDefined();
  });

  it('is a no-op when the socket never joined a room', () => {
    const { gateway } = makeGateway({});
    const socket = makeSocket({ token: 'good' });
    expect(() =>
      gateway.handleDisconnect(
        socket as unknown as Parameters<typeof gateway.handleDisconnect>[0],
      ),
    ).not.toThrow();
  });
});
