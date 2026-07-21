'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  notificationsApi,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationItem,
  type NotificationKind,
} from '../../lib/api/notifications';
import { ApiClientError } from '../../lib/api-client';

/**
 * Notification inbox (Task 25.6 / Req 16.1).
 *
 * Layout:
 *   [Header with "Mark all as read" + filter pill bar]
 *   [List of notifications (newest first)]
 *
 * Behavior:
 *   - Polls every 60s so the page stays fresh while open.
 *   - Click on an unread item → POST /notifications/:id/read.
 *   - "Barchasini o'qilgan deb belgilash" → mark-all-read.
 *   - Filter chips toggle a single `kind` filter (client-side over
 *     the most recent page; the API does not yet expose a kind
 *     filter so we restrict to the materialised page).
 */
export function NotificationInbox({ locale }: { locale: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filterKind, setFilterKind] = useState<NotificationKind | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const inboxQuery = useQuery({
    queryKey: ['notifications', 'inbox', { unreadOnly }],
    queryFn: () => notificationsApi.list({ limit: 50, unreadOnly }),
    refetchInterval: 60_000,
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

  const items = inboxQuery.data?.items ?? [];

  const filtered = useMemo(() => {
    if (!filterKind) return items;
    return items.filter((n) => n.kind === filterKind);
  }, [items, filterKind]);

  const hasUnread = items.some((n) => n.readAt === null);

  function handleRowClick(notification: NotificationItem) {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const deeplink = pickDeeplink(notification);
    if (deeplink) {
      router.push(
        deeplink.startsWith('/') ? deeplink : `/${locale}${deeplink}`,
      );
    }
  }

  if (inboxQuery.isLoading) {
    return <InboxSkeleton />;
  }

  if (inboxQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        {inboxQuery.error instanceof ApiClientError
          ? inboxQuery.error.message
          : "Xabarnomalarni yuklashda xato yuz berdi."}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
            Xabarnomalar
          </h1>
          <p className="mt-1 text-sm text-cream-dim">
            Eng yangilari yuqorida.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}/settings/notifications`}
            className="rounded-2xl border border-white/[0.07] px-3 py-1.5 text-xs font-bold text-cream-dim transition-colors hover:text-cream"
          >
            Sozlamalar
          </Link>
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={`rounded-2xl px-3 py-1.5 text-xs font-bold transition-colors ${
              unreadOnly
                ? 'bg-accent2-500/15 text-accent2-500'
                : 'border border-white/[0.07] text-cream-dim hover:text-cream'
            }`}
          >
            Faqat o&apos;qilmaganlar
          </button>
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={!hasUnread || markAllRead.isPending}
            className="rounded-2xl bg-accent2-500 px-4 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-accent2-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {markAllRead.isPending
              ? 'Belgilanmoqda...'
              : "Barchasini o'qilgan deb belgilash"}
          </button>
        </div>
      </header>

      {/* Kind filter chips */}
      <nav
        aria-label="Xabarnomalar bo'yicha filtr"
        className="-mx-1 flex flex-wrap gap-1"
      >
        <FilterChip
          label="Barchasi"
          active={filterKind === null}
          onClick={() => setFilterKind(null)}
        />
        {NOTIFICATION_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            label={NOTIFICATION_KIND_LABELS_UZ[kind]}
            active={filterKind === kind}
            onClick={() => setFilterKind(kind)}
          />
        ))}
      </nav>

      <section className="rounded-2xl border border-white/[0.07] bg-ink-surface">
        {filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-cream-dim">
            {unreadOnly
              ? "O'qilmagan xabarnomalar yo'q."
              : "Hozircha xabarnomalar yo'q."}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {filtered.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onClick={() => handleRowClick(n)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-accent2-500/15 text-accent2-500'
          : 'border border-white/[0.07] text-cream-dim hover:text-cream'
      }`}
    >
      {label}
    </button>
  );
}

function NotificationRow({
  notification,
  onClick,
}: {
  notification: NotificationItem;
  onClick: () => void;
}) {
  const isUnread = notification.readAt === null;
  const kindLabel =
    NOTIFICATION_KIND_LABELS_UZ[notification.kind as NotificationKind] ??
    notification.kind;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-start gap-4 px-5 py-4 text-left transition-colors ${
          isUnread ? 'bg-accent2-500/[0.04]' : ''
        } hover:bg-white/[0.03]`}
      >
        <span
          className={`mt-1 inline-flex h-2 w-2 shrink-0 rounded-full ${
            isUnread ? 'bg-accent2-500' : 'bg-transparent'
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-semibold text-cream">
              {notification.title}
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
              {formatRelative(notification.createdAt)}
            </span>
          </div>
          {notification.body ? (
            <p className="mt-1 text-sm text-cream-dim">{notification.body}</p>
          ) : null}
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            {kindLabel}
          </p>
        </div>
      </button>
    </li>
  );
}

function InboxSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="h-8 w-1/3 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="space-y-2 rounded-2xl border border-white/[0.07] bg-ink-surface p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl bg-white/[0.04]"
          />
        ))}
      </div>
    </div>
  );
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

/**
 * Best-effort extraction of a deeplink from a notification's data
 * payload. Mirrors the helper used by the navbar bell so the two
 * surfaces navigate consistently.
 */
function pickDeeplink(notification: NotificationItem): string | null {
  const data = notification.data;
  if (!data || typeof data !== 'object') return null;
  const direct = (data as Record<string, unknown>).deeplink;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const lessonId = (data as Record<string, unknown>).lessonId;
  if (typeof lessonId === 'string') return `/lessons/${lessonId}`;
  const assignmentId = (data as Record<string, unknown>).assignmentId;
  if (typeof assignmentId === 'string') return `/assignments/${assignmentId}`;
  const submissionId = (data as Record<string, unknown>).submissionId;
  if (typeof submissionId === 'string') return `/submissions/${submissionId}`;
  const groupId = (data as Record<string, unknown>).groupId;
  if (typeof groupId === 'string') return `/groups/${groupId}`;
  return null;
}
