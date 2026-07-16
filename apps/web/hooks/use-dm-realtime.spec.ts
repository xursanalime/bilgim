import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getLiveSocket } from '../lib/socket';
import { useDmRealtime } from './use-dm-realtime';
import type { DmMessageListResponse } from '../lib/api/dm';

jest.mock('../lib/socket', () => ({
  getLiveSocket: jest.fn(),
}));

const mockedGetLiveSocket = getLiveSocket as jest.MockedFunction<
  typeof getLiveSocket
>;

/** Minimal EventEmitter-style fake matching the bits useRealtime uses. */
function createFakeSocket(connected = true) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const register = (event: string, cb: (...args: unknown[]) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
  };
  const unregister = (event: string, cb: (...args: unknown[]) => void) => {
    listeners.get(event)?.delete(cb);
  };

  const socket = {
    connected,
    emit: jest.fn(),
    on: jest.fn(register),
    off: jest.fn(unregister),
    io: { on: jest.fn(), off: jest.fn() },
    __fire: (event: string, ...args: unknown[]) =>
      listeners.get(event)?.forEach((cb) => cb(...args)),
    __listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };

  return socket;
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

function seedMessages(
  queryClient: QueryClient,
  threadId: string,
  items: DmMessageListResponse['items'] = [],
) {
  queryClient.setQueryData<DmMessageListResponse>(['dm', 'messages', threadId], {
    items,
    nextCursor: null,
  });
}

describe('useDmRealtime (Req 14.3 / 14.4)', () => {
  const THREAD = 'thread-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('joins the DM room (dm:<threadId>) on mount when already connected', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { wrapper } = makeWrapper();

    renderHook(() => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }), {
      wrapper,
    });

    expect(socket.emit).toHaveBeenCalledWith('chat:join', {
      lessonId: `dm:${THREAD}`,
    });
  });

  it('appends an inbound peer message to the thread cache without a refetch', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { queryClient, wrapper } = makeWrapper();
    seedMessages(queryClient, THREAD);

    renderHook(() => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }), {
      wrapper,
    });

    act(() =>
      socket.__fire('chat:message', {
        lessonId: `dm:${THREAD}`,
        senderId: 'peer',
        text: 'salom',
        messageId: 'm1',
        ts: Date.now(),
      }),
    );

    const cached = queryClient.getQueryData<DmMessageListResponse>([
      'dm',
      'messages',
      THREAD,
    ]);
    expect(cached?.items).toHaveLength(1);
    expect(cached?.items[0]).toMatchObject({ id: 'm1', text: 'salom', authorId: 'peer' });
  });

  it('keeps the nav unread badge + thread list in sync on a peer message', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { queryClient, wrapper } = makeWrapper();
    seedMessages(queryClient, THREAD);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }), {
      wrapper,
    });

    act(() =>
      socket.__fire('chat:message', {
        lessonId: `dm:${THREAD}`,
        senderId: 'peer',
        text: 'salom',
        messageId: 'm1',
      }),
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['dm', 'unread-count'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dm', 'threads'] });
  });

  it('does not bump unread for the current user\'s own echo', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { queryClient, wrapper } = makeWrapper();
    seedMessages(queryClient, THREAD);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }), {
      wrapper,
    });

    act(() =>
      socket.__fire('chat:message', {
        lessonId: `dm:${THREAD}`,
        senderId: 'me',
        text: 'mening xabarim',
        messageId: 'm2',
      }),
    );

    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['dm', 'unread-count'],
    });
  });

  it('deduplicates a message already present in the cache', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { queryClient, wrapper } = makeWrapper();
    seedMessages(queryClient, THREAD, [
      {
        id: 'm1',
        threadId: THREAD,
        authorId: 'peer',
        text: 'salom',
        assetId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    renderHook(() => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }), {
      wrapper,
    });

    act(() =>
      socket.__fire('chat:message', {
        lessonId: `dm:${THREAD}`,
        senderId: 'peer',
        text: 'salom',
        messageId: 'm1',
      }),
    );

    const cached = queryClient.getQueryData<DmMessageListResponse>([
      'dm',
      'messages',
      THREAD,
    ]);
    expect(cached?.items).toHaveLength(1);
  });

  it('ignores broadcasts addressed to a different room', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { queryClient, wrapper } = makeWrapper();
    seedMessages(queryClient, THREAD);

    renderHook(() => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }), {
      wrapper,
    });

    act(() =>
      socket.__fire('chat:message', {
        lessonId: 'dm:other-thread',
        senderId: 'peer',
        text: 'boshqa suhbat',
        messageId: 'x1',
      }),
    );

    const cached = queryClient.getQueryData<DmMessageListResponse>([
      'dm',
      'messages',
      THREAD,
    ]);
    expect(cached?.items).toHaveLength(0);
  });

  it('uses the raw lessonId as room key and skips unread sync for lesson chat', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { queryClient, wrapper } = makeWrapper();
    seedMessages(queryClient, THREAD);
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    renderHook(
      () =>
        useDmRealtime({
          threadId: THREAD,
          lessonId: 'lesson-9',
          currentUserId: 'me',
        }),
      { wrapper },
    );

    expect(socket.emit).toHaveBeenCalledWith('chat:join', {
      lessonId: 'lesson-9',
    });

    act(() =>
      socket.__fire('chat:message', {
        lessonId: 'lesson-9',
        senderId: 'peer',
        text: 'guruh xabari',
        messageId: 'g1',
      }),
    );

    // Message still lands in the thread cache, but the DM unread badge is
    // not invalidated for group/lesson chat.
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['dm', 'unread-count'],
    });
  });

  it('leaves the room on unmount', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { wrapper } = makeWrapper();

    const { unmount } = renderHook(
      () => useDmRealtime({ threadId: THREAD, currentUserId: 'me' }),
      { wrapper },
    );

    unmount();
    expect(socket.emit).toHaveBeenCalledWith('chat:leave', {
      lessonId: `dm:${THREAD}`,
    });
  });
});
