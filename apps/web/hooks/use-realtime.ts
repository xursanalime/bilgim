'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { getLiveSocket } from '../lib/socket';

/**
 * Connection lifecycle exposed by {@link useRealtime} (R14.4 — update
 * notifications, messages, requests, and live presence without manual
 * refresh where real-time transport is available).
 */
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export interface UseRealtimeOptions {
  /**
   * When `false`, the hook does not touch the socket (no connect, no
   * listeners). Useful for gating on auth/session readiness.
   * @default true
   */
  enabled?: boolean;
}

export interface UseRealtimeResult {
  /** Current connection state. */
  status: RealtimeStatus;
  /** Convenience flag, equivalent to `status === 'connected'`. */
  isConnected: boolean;
  /** The underlying shared socket, or `null` when unavailable. */
  socket: Socket | null;
  /**
   * Subscribe to a server event. Returns an unsubscribe function; all
   * active subscriptions are also cleaned up automatically on unmount.
   */
  subscribe: <T = unknown>(
    event: string,
    handler: (payload: T) => void,
  ) => () => void;
  /** Emit an event to the server. No-op when the socket is unavailable. */
  emit: (event: string, ...args: unknown[]) => void;
}

/**
 * Typed wrapper over the shared `socket.io-client` connection
 * (`lib/socket`). It tracks connect / disconnect / reconnect status,
 * lets callers subscribe to events with automatic cleanup on unmount,
 * and degrades gracefully (no throw, status `disconnected`) when the
 * socket client cannot be initialized (e.g. during SSR or before the
 * user has an access token).
 *
 * The hook intentionally does NOT disconnect the shared socket on
 * unmount — the connection is multiplexed across surfaces (DM,
 * notifications, live). It only removes the listeners it registered.
 */
export function useRealtime(
  options: UseRealtimeOptions = {},
): UseRealtimeResult {
  const { enabled = true } = options;

  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');

  // Track listeners this hook added so we can detach exactly those on
  // unmount without clobbering other consumers of the shared socket.
  const handlersRef = useRef<Map<string, Set<(...args: unknown[]) => void>>>(
    new Map(),
  );

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return;
    }

    let socket: Socket | null = null;
    try {
      socket = getLiveSocket();
    } catch {
      // Graceful degradation: socket client not available.
      socketRef.current = null;
      setStatus('disconnected');
      return;
    }

    if (!socket) {
      socketRef.current = null;
      setStatus('disconnected');
      return;
    }

    socketRef.current = socket;
    setStatus(socket.connected ? 'connected' : 'connecting');

    const handleConnect = () => setStatus('connected');
    const handleDisconnect = () => setStatus('disconnected');
    const handleConnectError = () => setStatus('disconnected');
    const handleReconnectAttempt = () => setStatus('connecting');
    const handleReconnect = () => setStatus('connected');

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    // Reconnection lifecycle lives on the manager (`socket.io`).
    const manager = socket.io;
    if (manager && typeof manager.on === 'function') {
      manager.on('reconnect_attempt', handleReconnectAttempt);
      manager.on('reconnect', handleReconnect);
    }

    return () => {
      socket?.off('connect', handleConnect);
      socket?.off('disconnect', handleDisconnect);
      socket?.off('connect_error', handleConnectError);
      if (manager && typeof manager.off === 'function') {
        manager.off('reconnect_attempt', handleReconnectAttempt);
        manager.off('reconnect', handleReconnect);
      }

      // Detach any event subscriptions registered through `subscribe`.
      for (const [event, handlers] of handlersRef.current.entries()) {
        for (const handler of handlers) {
          socket?.off(event, handler);
        }
      }
      handlersRef.current.clear();
    };
  }, [enabled]);

  const subscribe = useCallback(
    <T = unknown>(event: string, handler: (payload: T) => void) => {
      const socket = socketRef.current;
      const wrapped = handler as (...args: unknown[]) => void;

      if (!socket) {
        // Graceful degradation: nothing to subscribe to. Return a no-op
        // cleanup so callers can wire this into `useEffect` unchanged.
        return () => {};
      }

      socket.on(event, wrapped);

      let handlers = handlersRef.current.get(event);
      if (!handlers) {
        handlers = new Set();
        handlersRef.current.set(event, handlers);
      }
      handlers.add(wrapped);

      return () => {
        socket.off(event, wrapped);
        handlersRef.current.get(event)?.delete(wrapped);
      };
    },
    [],
  );

  const emit = useCallback((event: string, ...args: unknown[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  return {
    status,
    isConnected: status === 'connected',
    socket: socketRef.current,
    subscribe,
    emit,
  };
}
