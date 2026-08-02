'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellOff,
  CheckCheck,
  ChevronRight,
  Inbox,
  Settings2,
} from 'lucide-react';

import {
  notificationsApi,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationItem,
  type NotificationKind,
} from '../../lib/api/notifications';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import {
  GROUP_LABELS,
  TONE_TILE,
  kindMeta,
  type NotificationKindMeta,
} from './notification-kind-meta';

/**
 * Notification inbox (Task 25.6 / Req 16.1).
 *
 * Rebuilt onto the current design system. What changed and why:
 *
 *   - The filter bar rendered all 14 kinds as chips unconditionally, wrapping
 *     into a three-row wall that dwarfed the list itself. It now shows four
 *     category filters, only the ones the inbox actually contains, each with
 *     a count.
 *   - Every row looked identical — same grey block, with the kind repeated
 *     underneath in monospace caps. Rows now carry a colour-coded icon per
 *     kind, so a failed payment reads differently from a new lesson at a
 *     glance, and the redundant caps label is gone.
 *   - Items are grouped under Bugun / Kecha / Shu hafta / Oldinroq headings
 *     instead of forming one undifferentiated stream.
 *
 * Behaviour is unchanged: polls every 60s, a click marks read and follows the
 * deeplink, mark-all-read stays.
 */
export function NotificationInbox({ locale }: { locale: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filterGroup, setFilterGroup] = useState<
    NotificationKindMeta['group'] | null
  >(null);
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

  // Only offer a filter for categories actually present — an empty filter is
  // a dead end the user has to discover by clicking.
  const groupCounts = useMemo(() => {
    const counts = new Map<NotificationKindMeta['group'], number>();
    for (const n of items) {
      const g = kindMeta(n.kind).group;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    if (!filterGroup) return items;
    return items.filter((n) => kindMeta(n.kind).group === filterGroup);
  }, [items, filterGroup]);

  const sections = useMemo(() => groupByRecency(filtered), [filtered]);
  const unreadCount = items.filter((n) => n.readAt === null).length;

  function handleRowClick(notification: NotificationItem) {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const deeplink = pickDeeplink(notification);
    if (deeplink) {
      router.push(deeplink.startsWith('/') ? deeplink : `/${locale}${deeplink}`);
    }
  }

  if (inboxQuery.isLoading) return <InboxSkeleton />;

  if (inboxQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-red/20 bg-red-tint p-5 text-sm font-medium text-red">
          {inboxQuery.error instanceof ApiClientError
            ? inboxQuery.error.message
            : 'Xabarnomalarni yuklashda xato yuz berdi.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-tint text-blue">
              <Inbox className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                Xabarnomalar
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                {unreadCount > 0
                  ? `${unreadCount} ta o'qilmagan xabar`
                  : "Hammasi o'qilgan"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/${locale}/settings/notifications`}
              aria-label="Xabarnoma sozlamalari"
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rim text-ink-soft transition-all hover:border-blue/20 hover:text-blue"
            >
              <Settings2 className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={unreadCount === 0 || markAllRead.isPending}
              className="flex items-center gap-2 rounded-2xl bg-blue px-4 py-2.5 text-xs font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,113,227,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            >
              <CheckCheck className="h-4 w-4" />
              {markAllRead.isPending ? 'Belgilanmoqda…' : "Hammasini o'qildi"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          label="Barchasi"
          count={items.length}
          active={filterGroup === null}
          onClick={() => setFilterGroup(null)}
        />
        {(
          Object.keys(GROUP_LABELS) as Array<NotificationKindMeta['group']>
        ).map((g) => {
          const count = groupCounts.get(g) ?? 0;
          if (count === 0) return null;
          return (
            <FilterPill
              key={g}
              label={GROUP_LABELS[g]}
              count={count}
              active={filterGroup === g}
              onClick={() => setFilterGroup(g)}
            />
          );
        })}

        <button
          type="button"
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            'ml-auto rounded-full px-4 py-1.5 text-xs font-bold transition-all',
            unreadOnly
              ? 'bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]'
              : 'border border-rim text-ink-soft hover:border-blue/20 hover:text-blue',
          )}
        >
          Faqat o&apos;qilmagan
        </button>
      </div>

      {/* ── List ───────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState unreadOnly={unreadOnly} filtered={filterGroup !== null} />
      ) : (
        <div className="space-y-6">
          {sections.map(({ label, rows }) => (
            <section key={label} className="space-y-2">
              <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-faint">
                {label}
              </h2>
              <ul className="space-y-2">
                {rows.map((n) => (
                  <NotificationCard
                    key={n.id}
                    notification={n}
                    onClick={() => handleRowClick(n)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all',
        active
          ? 'bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]'
          : 'border border-rim text-ink-soft hover:border-blue/20 hover:text-blue',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 text-[10px] font-black tabular-nums',
          active ? 'bg-white/20 text-white' : 'bg-tint text-ink-faint',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function NotificationCard({
  notification,
  onClick,
}: {
  notification: NotificationItem;
  onClick: () => void;
}) {
  const isUnread = notification.readAt === null;
  const meta = kindMeta(notification.kind);
  const Icon = meta.icon;
  const kindLabel =
    NOTIFICATION_KIND_LABELS_UZ[notification.kind as NotificationKind] ??
    notification.kind;
  const hasLink = pickDeeplink(notification) !== null;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex w-full items-start gap-4 rounded-3xl border p-4 text-left transition-all sm:p-5',
          isUnread
            ? 'border-blue/20 bg-blue/[0.03] shadow-soft'
            : 'border-rim bg-canvas hover:border-blue/20 hover:shadow-soft',
        )}
      >
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-105',
            TONE_TILE[meta.tone],
          )}
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p
              className={cn(
                'text-sm leading-snug text-ink-strong',
                isUnread ? 'font-bold' : 'font-semibold',
              )}
            >
              {notification.title}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] font-medium tabular-nums text-ink-faint">
                {formatRelative(notification.createdAt)}
              </span>
              {isUnread && (
                <span
                  className="h-2 w-2 rounded-full bg-blue"
                  aria-label="O'qilmagan"
                />
              )}
            </div>
          </div>

          {notification.body ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
              {notification.body}
            </p>
          ) : null}

          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-ink-faint">
              {kindLabel}
            </span>
            {hasLink && (
              <ChevronRight className="h-3 w-3 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-blue" />
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function EmptyState({
  unreadOnly,
  filtered,
}: {
  unreadOnly: boolean;
  filtered: boolean;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-rim bg-canvas px-6 py-16 text-center shadow-soft">
      <span className="flex h-16 w-16 items-center justify-center rounded-[2rem] bg-blue-tint text-blue">
        <BellOff className="h-7 w-7" />
      </span>
      <p className="mt-5 font-display text-lg font-bold tracking-tight text-ink-strong">
        {unreadOnly
          ? "O'qilmagan xabar yo'q"
          : filtered
            ? "Bu turdagi xabar yo'q"
            : "Hozircha xabar yo'q"}
      </p>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
        {unreadOnly
          ? "Hammasini ko'rib chiqdingiz."
          : "Yangi dars, vazifa yoki guruh o'zgarishi bo'lganda shu yerda ko'rinadi."}
      </p>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="h-32 animate-pulse rounded-3xl border border-rim bg-canvas" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-tint" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-3xl border border-rim bg-canvas"
          />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Bucket notifications into recency sections. A flat stream of fifty rows
 * gives no sense of "what is new since I last looked"; date headings do.
 * Order is preserved within each bucket (the API already returns newest
 * first) and empty buckets are dropped.
 */
function groupByRecency(
  items: NotificationItem[],
): Array<{ label: string; rows: NotificationItem[] }> {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const buckets: Array<{ label: string; rows: NotificationItem[] }> = [
    { label: 'Bugun', rows: [] },
    { label: 'Kecha', rows: [] },
    { label: 'Shu hafta', rows: [] },
    { label: 'Oldinroq', rows: [] },
  ];

  for (const n of items) {
    const t = Date.parse(n.createdAt);
    if (Number.isNaN(t)) {
      buckets[3]!.rows.push(n);
    } else if (t >= startOfToday) {
      buckets[0]!.rows.push(n);
    } else if (t >= startOfYesterday) {
      buckets[1]!.rows.push(n);
    } else if (t >= startOfWeek) {
      buckets[2]!.rows.push(n);
    } else {
      buckets[3]!.rows.push(n);
    }
  }

  return buckets.filter((b) => b.rows.length > 0);
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
 * Best-effort extraction of a deeplink from a notification's data payload.
 * Mirrors the helper used by the navbar bell so the two surfaces navigate
 * consistently.
 */
function pickDeeplink(notification: NotificationItem): string | null {
  const data = notification.data;
  if (!data || typeof data !== 'object') return null;
  const direct = (data as Record<string, unknown>).deeplink;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const lessonId = (data as Record<string, unknown>).lessonId;
  if (typeof lessonId === 'string') return `/lessons/${lessonId}`;
  const assignmentId = (data as Record<string, unknown>).assignmentId;
  if (typeof assignmentId === 'string') return `/homework/${assignmentId}`;
  const submissionId = (data as Record<string, unknown>).submissionId;
  if (typeof submissionId === 'string') return `/submissions/${submissionId}`;
  const groupId = (data as Record<string, unknown>).groupId;
  if (typeof groupId === 'string') return `/groups/${groupId}`;
  return null;
}
