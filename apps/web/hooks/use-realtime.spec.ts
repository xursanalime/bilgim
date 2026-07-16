import { act, renderHook } from '@testing-library/react';

import { getLiveSocket } from '../lib/socket';
import { useRealtime } from './use-realtime';

jest.mock('../lib/socket', () => ({
  getLiveSocket: jest.fn(),
}));

const mockedGetLiveSocket = getLiveSocket as jest.MockedFunction<
  typeof getLiveSocket
>;

/** Minimal EventEmitter-style fake matching the bits useRealtime uses. */
function createFakeSocket(connected = false) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const managerListeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const register = (
    store: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    cb: (...args: unknown[]) => void,
  ) => {
    if (!store.has(event)) store.set(event, new Set());
    store.get(event)!.add(cb);
  };
  const unregister = (
    store: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    cb: (...args: unknown[]) => void,
  ) => {
    store.get(event)?.delete(cb);
  };
  const fire = (
    store: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    ...args: unknown[]
  ) => {
    store.get(event)?.forEach((cb) => cb(...args));
  };

  const socket = {
    connected,
    emit: jest.fn(),
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) =>
      register(listeners, event, cb),
    ),
    off: jest.fn((event: string, cb: (...args: unknown[]) => void) =>
      unregister(listeners, event, cb),
    ),
    io: {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) =>
        register(managerListeners, event, cb),
      ),
      off: jest.fn((event: string, cb: (...args: unknown[]) => void) =>
        unregister(managerListeners, event, cb),
      ),
    },
    __fire: (event: string, ...args: unknown[]) =>
      fire(listeners, event, ...args),
    __fireManager: (event: string, ...args: unknown[]) =>
      fire(managerListeners, event, ...args),
    __listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };

  return socket;
}

describe('useRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts in connecting state when the socket is not yet connected', () => {
    mockedGetLiveSocket.mockReturnValue(createFakeSocket(false) as never);
    const { result } = renderHook(() => useRealtime());
    expect(result.current.status).toBe('connecting');
    expect(result.current.isConnected).toBe(false);
  });

  it('reports connected immediately when the socket is already connected', () => {
    mockedGetLiveSocket.mockReturnValue(createFakeSocket(true) as never);
    const { result } = renderHook(() => useRealtime());
    expect(result.current.status).toBe('connected');
    expect(result.current.isConnected).toBe(true);
  });

  it('transitions connecting -> connected -> disconnected on socket events', () => {
    const socket = createFakeSocket(false);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { result } = renderHook(() => useRealtime());

    expect(result.current.status).toBe('connecting');

    act(() => socket.__fire('connect'));
    expect(result.current.status).toBe('connected');

    act(() => socket.__fire('disconnect'));
    expect(result.current.status).toBe('disconnected');
  });

  it('tracks reconnection lifecycle via the manager', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { result } = renderHook(() => useRealtime());

    act(() => socket.__fireManager('reconnect_attempt'));
    expect(result.current.status).toBe('connecting');

    act(() => socket.__fireManager('reconnect'));
    expect(result.current.status).toBe('connected');
  });

  it('subscribes and unsubscribes from events', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { result } = renderHook(() => useRealtime());

    const handler = jest.fn();
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = result.current.subscribe('chat:message', handler);
    });
    expect(socket.__listenerCount('chat:message')).toBe(1);

    act(() => socket.__fire('chat:message', { text: 'hi' }));
    expect(handler).toHaveBeenCalledWith({ text: 'hi' });

    act(() => unsubscribe());
    expect(socket.__listenerCount('chat:message')).toBe(0);
  });

  it('cleans up listeners on unmount', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { result, unmount } = renderHook(() => useRealtime());

    act(() => {
      result.current.subscribe('chat:message', jest.fn());
    });
    expect(socket.__listenerCount('chat:message')).toBe(1);

    unmount();
    expect(socket.__listenerCount('chat:message')).toBe(0);
  });

  it('degrades gracefully when the socket client throws', () => {
    mockedGetLiveSocket.mockImplementation(() => {
      throw new Error('no token');
    });
    const { result } = renderHook(() => useRealtime());

    expect(result.current.status).toBe('disconnected');
    expect(result.current.socket).toBeNull();

    // subscribe / emit are safe no-ops.
    let cleanup = () => {};
    act(() => {
      cleanup = result.current.subscribe('chat:message', jest.fn());
    });
    expect(() => cleanup()).not.toThrow();
    expect(() => result.current.emit('ping')).not.toThrow();
  });

  it('does not touch the socket when disabled', () => {
    const socket = createFakeSocket(true);
    mockedGetLiveSocket.mockReturnValue(socket as never);
    const { result } = renderHook(() => useRealtime({ enabled: false }));

    expect(mockedGetLiveSocket).not.toHaveBeenCalled();
    expect(result.current.status).toBe('disconnected');
  });
});
