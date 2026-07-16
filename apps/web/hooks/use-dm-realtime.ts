'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useRealtime } from './use-realtime';
import type { DmMessage, DmMessageListResponse } from '../lib/api/dm';

/**
 * Realtime transport for a single DM (or live-lesson) thread, built on
 * top of the shared {@link useRealtime} socket wrapper (Task 10.2,
 * Req 14.3 / 14.4).
 *
 * Backend contract (see `apps/api/src/modules/live/chat/live-chat.gateway.ts`
 * and `apps/api/src/modules/dm/dm.service.ts`):
 *   - The `/live` Socket.IO namespace broadcasts `chat:message` to the
 *     room `lesson:<roomKey>`.
 *   - For a DM thread the room key is `dm:<threadId>`; for a live lesson
 *     chat it is the raw `lessonId`.
 *   - A client joins a room by emitting `chat:join` with
 *     `{ lessonId: <roomKey> }` and leaves with `chat:leave`.
 *   - When a message is sent over HTTP (`POST /dm/threads/:id/messages`)
 *     the DM service re-emits `chat:message` into the same room, so a
 *     joined peer receives it without polling.
 *
 * Responsibilities:
 *   1. Join the thread room on connect (and re-join on reconnect).
 *   2. Append inbound messages to the `['dm','messages',threadId]` query
 *      cache (deduplicated) so the thread updates without a refetch.
 *   3. When the inbound message is from the peer (not the current user)
 *      invalidate `['dm','unread-count']` and `['dm','threads']` so the
 *      nav badge (see `use-unread-dm-count`) and conversation list stay
 *      in sync in real time.
 *
 * The hook degrades gracefully when the socket is unavailable (SSR, no
 * access token): {@link useRealtime} returns a disconnected status and
 * the surface falls back to the existing polling `refetchInterval`.
 */
export interface UseDmRealtimeOptions {
  /** DM thread id the surface is currently viewing. */
  threadId: string;
  /**
   * When set, the surface is a live-lesson (group) chat rather than a
   * 1:1 DM. The room key becomes the raw `lessonId` and unread-count
   * invalidation is skipped (lesson chat has no DM unread badge).
   */
  lessonId?: string | null;
  /** Current user id — inbound messages from this id never bump unread. */
  currentUserId?: string | null;
  /** Gate the subscription (e.g. until the thread id is known). */
  enabled?: boolean;
}

interface InboundChatMessage {
  lessonId?: string;
  senderId?: string;
  text?: string;
  assetId?: string;
  ts?: number;
  messageId?: string;
}

export function useDmRealtime({
  threadId,
  lessonId,
  currentUserId,
  enabled = true,
}: UseDmRealtimeOptions) {
  const queryClient = useQueryClient();
  const active = enabled && Boolean(threadId);
  const { status, isConnected, subscribe, emit } = useRealtime({
    enabled: active,
  });

  // Room key mirrors the gateway's `assertRoomAccess` switch: DM threads
  // are addressed as `dm:<threadId>`, live lessons by raw `lessonId`.
  const roomKey = lessonId ? lessonId : `dm:${threadId}`;

  useEffect(() => {
    if (!active) return;

    const join = () => emit('chat:join', { lessonId: roomKey });

    // Join immediately if the shared socket is already connected, and
    // (re)join on every (re)connect so a dropped link recovers cleanly.
    if (isConnected) join();
    const offConnect = subscribe('connect', () => join());

    const offMessage = subscribe<InboundChatMessage>(
      'chat:message',
      (payload) => {
        if (!payload || (typeof payload.text !== 'string' && !payload.assetId)) {
          return;
        }
        // Ignore broadcasts addressed to a different room.
        if (payload.lessonId && payload.lessonId !== roomKey) {
          return;
        }

        let appended = false;
        queryClient.setQueryData<DmMessageListResponse>(
          ['dm', 'messages', threadId],
          (prev) => {
            if (!prev) return prev;

            const isDuplicate = Boolean(
              payload.messageId &&
                prev.items.some((m) => m.id === payload.messageId),
            );
            if (isDuplicate) return prev;

            const message: DmMessage = {
              id:
                payload.messageId ??
                `socket-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              threadId,
              authorId: payload.senderId ?? 'unknown',
              text: payload.text ?? '',
              assetId: payload.assetId ?? null,
              createdAt: new Date(payload.ts ?? Date.now()).toISOString(),
            };
            appended = true;
            return { ...prev, items: [message, ...prev.items] };
          },
        );

        // Keep the nav badge + conversation list honest the moment a
        // peer message arrives. Skip for our own echo and for lesson
        // chat (which has no DM unread badge).
        const fromPeer =
          appended &&
          !lessonId &&
          payload.senderId != null &&
          payload.senderId !== currentUserId;
        if (fromPeer) {
          void queryClient.invalidateQueries({
            queryKey: ['dm', 'unread-count'],
          });
          void queryClient.invalidateQueries({ queryKey: ['dm', 'threads'] });
        }
      },
    );

    return () => {
      offConnect();
      offMessage();
      emit('chat:leave', { lessonId: roomKey });
    };
  }, [
    active,
    roomKey,
    threadId,
    lessonId,
    currentUserId,
    isConnected,
    subscribe,
    emit,
    queryClient,
  ]);

  return { status, isConnected };
}
