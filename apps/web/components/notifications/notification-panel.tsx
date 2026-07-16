'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useFocusTrap } from '../../lib/a11y/use-focus-trap';
import { ApiClientError } from '../../lib/api-client';
import {
  notificationsApi,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationItem,
  type NotificationKind,
  type NotificationListResponse,
} from '../../lib/notifications-api';
import {
  getNotificationKindMeta,
  resolveNotificationDeeplink,
  toLocaleHref,
  TONE_BADGE_CLASS,
} from './notification-kinds';

// Query keys shared with the bell badge + sidebar count so optimistic
// updates and invalidations stay in sync across the app.
const INBOX_KEY = ['notifications', 'bell-inbox'] as const;
const UNREAD_KEY = ['notifications', 'unread-count'] as const;
const PANEL_LIMIT = 12;

interface NotificationPanelProps {
  locale: string;
  /** Whether the panel is open (drives polling). */
  open: boolean;
  /** Close the panel (after navigation / outside-click handled by parent). */
  onClose: () => void;
}

/**
 * Dropdown panel for the notification center (Task 10.1, Req 14.1/14.2).
 *
 * Responsibilities:
 *   - List the most recent notifications (newest first) while open.
 *   - Render each kind with an icon, localized (uz) label, and relative
 *     timestamp; unread rows are visually distinct.
 *   - Mark a single notification as read (optimistic) and deep-link to
 *     the relevant surface on click.
 *   - "Mark all as read" (optimistic) for the whole inbox.
 *
 * Counting/badge lives in `notification-bell.tsx`; this component owns
 * the list and the read mutations and keeps the shared caches coherent.
 */
export function NotificationPanel({
  locale,
  open,
  onClose,
}: NotificationPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  // Custom (non-Radix) popover: trap Tab/Shift+Tab within the panel, close on
  // Esc, and restore focus to the bell trigger when it closes (Req 7.1–7.3).
  useFocusTrap(panelRef, { active: open, onClose });

  const inboxQuery = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => notificationsApi.list({ limit: PANEL_LIMIT }),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    retry: 0,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const prevInbox =
        queryClient.getQueryData<NotificationListResponse>(INBOX_KEY);
      const prevCount =
        queryClient.getQueryData<{ count: number }>(UNREAD_KEY);

      const wasUnread =
        prevInbox?.items.find((n) => n.id === id)?.readAt === null;

      queryClient.setQueryData<NotificationListResponse>(INBOX_KEY, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((n) =>
                n.id === id && n.readAt === null
                  ? { ...n, readAt: new Date().toISOString() }
                  : n,
              ),
            }
          : old,
      );

      if (wasUnread) {
        queryClient.setQueryData<{ count: number }>(UNREAD_KEY, (old) =>
          old ? { count: Math.max(0, old.count - 1) } : old,
        );
      }

      return { prevInbox, prevCount };
    },
    onError: (_err, _id, context) => {
      if (context?.prevInbox) {
        queryClient.setQueryData(INBOX_KEY, context.prevInbox);
      }
      if (context?.prevCount) {
        queryClient.setQueryData(UNREAD_KEY, context.prevCount);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const prevInbox =
        queryClient.getQueryData<NotificationListResponse>(INBOX_KEY);
      const prevCount =
        queryClient.getQueryData<{ count: number }>(UNREAD_KEY);
      const now = new Date().toISOString();

      queryClient.setQueryData<NotificationListResponse>(INBOX_KEY, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((n) =>
                n.readAt === null ? { ...n, readAt: now } : n,
              ),
            }
          : old,
      );
      queryClient.setQueryData<{ count: number }>(UNREAD_KEY, { count: 0 });

      return { prevInbox, prevCount };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevInbox) {
        queryClient.setQueryData(INBOX_KEY, context.prevInbox);
      }
      if (context?.prevCount) {
        queryClient.setQueryData(UNREAD_KEY, context.prevCount);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const items = inboxQuery.data?.items ?? [];
  const hasUnread = items.some((n) => n.readAt === null);

  function handleItemClick(notification: NotificationItem) {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const deeplink = resolveNotificationDeeplink(notification);
    onClose();
    if (deeplink) {
      router.push(toLocaleHref(deeplink, locale));
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Bildirishnomalar"
      className="absolute right-0 z-50 mt-2 w-[360px] max-w-[92vw] overflow-hidden rounded-2xl border border-rim bg-white shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-rim px-4 py-3">
        <p className="text-sm font-extrabold tracking-tight text-ink-strong">
          Bildirishnomalar
        </p>
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={!hasUnread || markAllRead.isPending}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-blue transition-colors hover:bg-blue/10 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          {markAllRead.isPending
            ? 'Belgilanmoqda...'
            : "Barchasini o'qildi"}
        </button>
      </header>

      <div className="max-h-[440px] overflow-y-auto">
        {inboxQuery.isLoading ? (
          <div className="space-y-2 p-3" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-tint"
              />
            ))}
          </div>
        ) : inboxQuery.isError ? (
          <div role="alert" className="px-4 py-8 text-center">
            <p className="text-sm font-semibold text-ink-strong">
              Bildirishnomalarni yuklab bo&apos;lmadi
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              {inboxQuery.error instanceof ApiClientError
                ? inboxQuery.error.message
                : 'Keyinroq qayta urinib ko\u2019ring.'}
            </p>
            <button
              type="button"
              onClick={() => inboxQuery.refetch()}
              className="mt-3 rounded-xl border border-rim px-3 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:bg-tint"
            >
              Qayta urinish
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-soft">
            Hozircha bildirishnomalar yo&apos;q.
          </p>
        ) : (
          <ul className="divide-y divide-rim">
            {items.map((n) => {
              const meta = getNotificationKindMeta(n.kind);
              const Icon = meta.icon;
              const isUnread = n.readAt === null;
              const kindLabel =
                NOTIFICATION_KIND_LABELS_UZ[n.kind as NotificationKind] ??
                n.kind;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-tint ${
                      isUnread ? 'bg-blue/[0.035]' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        TONE_BADGE_CLASS[meta.tone]
                      }`}
                      aria-hidden
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-bold text-ink-strong">
                          {n.title}
                        </p>
                        {isUnread ? (
                          <span
                            className="mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-blue"
                            aria-label="o'qilmagan"
                          />
                        ) : null}
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                        <span className="truncate">{kindLabel}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">
                          {formatRelative(n.createdAt)}
                        </span>
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-rim p-2">
        <Link
          href={`/${locale}/notifications`}
          onClick={onClose}
          className="block rounded-xl px-3 py-2 text-center text-xs font-bold text-blue transition-colors hover:bg-blue/10"
        >
          Barcha bildirishnomalar
        </Link>
      </footer>
    </div>
  );
}

/** Compact Uzbek relative-time formatter ("hozir", "5 daq", "3 soat"). */
function formatRelative(input: string): string {
  try {
    const ms = Date.now() - Date.parse(input);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (ms < minute) return 'hozir';
    if (ms < hour) return `${Math.floor(ms / minute)} daq`;
    if (ms < day) return `${Math.floor(ms / hour)} soat`;
    if (ms < 7 * day) return `${Math.floor(ms / day)} kun`;
    return new Date(input).toLocaleDateString('uz-UZ', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return input;
  }
}
