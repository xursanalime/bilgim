'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  notificationsApi,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationItem,
  type NotificationKind,
} from '../../lib/api/notifications';

interface NotificationBellProps {
  locale: string;
}

/**
 * Header bell with an unread-count badge and a click-to-open drawer
 * (Task 25.6, Req 16.1).
 *
 * Behavior:
 *   - Polls `GET /notifications/unread-count` every 30s for the badge.
 *   - When opened, renders the latest 10 notifications inline.
 *   - Clicking on a notification calls `POST /notifications/:id/read`
 *     and navigates to `data.deeplink` (or another deeplink-shaped
 *     field) when present.
 *   - "Barchasini o'qilgan deb belgilash" calls `POST /notifications/mark-all-read`.
 *   - The header still exposes a link to the full inbox page.
 */
export function NotificationBell({ locale }: NotificationBellProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 30_000,
    retry: 0,
  });

  const inboxQuery = useQuery({
    queryKey: ['notifications', 'bell-inbox'],
    queryFn: () => notificationsApi.list({ limit: 10 }),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    retry: 0,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Click outside / Escape to close.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = unreadQuery.data?.count ?? 0;
  const display = count > 99 ? '99+' : String(count);
  const items = inboxQuery.data?.items ?? [];

  function handleItemClick(notification: NotificationItem) {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const deeplink = pickDeeplink(notification);
    setOpen(false);
    if (deeplink) {
      router.push(deeplink.startsWith('/') ? deeplink : `/${locale}${deeplink}`);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Xabarnomalar${count ? ` (${display} o'qilmagan)` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-cream-dim transition-colors hover:bg-white/[0.04] hover:text-cream"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {count > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent2-500 px-1 text-[10px] font-bold leading-[16px] text-ink"
            aria-hidden
          >
            {display}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Xabarnomalar"
          className="absolute right-0 z-50 mt-2 w-[340px] max-w-[92vw] rounded-2xl border border-white/[0.07] bg-ink-surface shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <p className="text-sm font-extrabold tracking-tight text-cream">
              Xabarnomalar
            </p>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={count === 0 || markAllRead.isPending}
              className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cream-dim transition-colors hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              {markAllRead.isPending
                ? 'Belgilanmoqda...'
                : "Barchasini o'qilgan"}
            </button>
          </header>

          <div className="max-h-[420px] overflow-y-auto">
            {inboxQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-xl bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : inboxQuery.isError ? (
              <p className="px-4 py-6 text-center text-sm text-red-300">
                Xabarnomalarni yuklab bo&apos;lmadi.
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-cream-dim">
                Hozircha xabarnomalar yo&apos;q.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] ${
                        n.readAt === null ? 'bg-accent2-500/[0.04]' : ''
                      }`}
                    >
                      <span
                        className={`mt-1 inline-flex h-2 w-2 shrink-0 rounded-full ${
                          n.readAt === null ? 'bg-accent2-500' : 'bg-transparent'
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-cream">
                          {n.title}
                        </p>
                        {n.body ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-cream-dim">
                            {n.body}
                          </p>
                        ) : null}
                        <p className="mt-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-cream-dim">
                          <span>
                            {NOTIFICATION_KIND_LABELS_UZ[
                              n.kind as NotificationKind
                            ] ?? n.kind}
                          </span>
                          <span>·</span>
                          <span>{formatRelative(n.createdAt)}</span>
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="border-t border-white/[0.06] p-2">
            <Link
              href={`/${locale}/notifications`}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2 text-center text-xs font-semibold text-accent2-500 hover:bg-white/[0.03]"
            >
              Barcha xabarnomalarni ko&apos;rish
            </Link>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Best-effort extraction of a deeplink from a notification's data
 * payload. The API stores route hints under different keys depending
 * on the topic (`lessonId`, `groupId`, etc.) — we look for an
 * explicit `deeplink` field first, then fall back to a few common
 * shape conventions.
 */
function pickDeeplink(notification: NotificationItem): string | null {
  const data = notification.data;
  if (!data || typeof data !== 'object') return null;
  const direct = (data as Record<string, unknown>).deeplink;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const lessonId = (data as Record<string, unknown>).lessonId;
  if (typeof lessonId === 'string') return `/lessons/${lessonId}`;
  const assignmentId = (data as Record<string, unknown>).assignmentId;
  if (typeof assignmentId === 'string') {
    return `/assignments/${assignmentId}`;
  }
  const submissionId = (data as Record<string, unknown>).submissionId;
  if (typeof submissionId === 'string') {
    return `/submissions/${submissionId}`;
  }
  const groupId = (data as Record<string, unknown>).groupId;
  if (typeof groupId === 'string') return `/groups/${groupId}`;
  return null;
}

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
