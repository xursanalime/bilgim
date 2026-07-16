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
  AlertCircle,
  Bell,
  BellOff,
  CheckCheck,
  Inbox,
  Settings,
  Sparkles,
} from 'lucide-react';

import {
  notificationsApi,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationItem,
  type NotificationKind,
} from '../../lib/api/notifications';
import { ApiClientError } from '../../lib/api-client';
import {
  getNotificationKindMeta,
  resolveNotificationDeeplink,
  toLocaleHref,
  TONE_BADGE_CLASS,
} from './notification-kinds';

/**
 * Notification inbox (Task 25.6 / Req 16.1).
 *
 * Layout:
 *   [Hero header: title + settings / unread-only / mark-all-read actions]
 *   [Scrollable kind filter chip row]
 *   [Unread group] then [Read group] — newest first inside each group
 *
 * Behavior:
 *   - Polls every 60s so the page stays fresh while open.
 *   - Click on an unread item → PATCH /notifications/:id/read.
 *   - "Barchasini o'qilgan deb belgilash" → mark-all-read.
 *   - Filter chips toggle a single `kind` filter (client-side over
 *     the most recent page; the API does not yet expose a kind
 *     filter so we restrict to the materialised page).
 *
 * Styling follows the student-dashboard / teacher-dashboard design
 * language: semantic tokens (bg-canvas / border-rim / text-ink-*),
 * brand color tones, rounded-3xl cards, aurora blur blobs and
 * shadow-soft. Dark mode is handled automatically by the semantic
 * tokens.
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

  // Split into unread / read while keeping the newest-first ordering
  // inside each group so the page reads as a tidy "what's new" stream.
  const unreadItems = useMemo(
    () => filtered.filter((n) => n.readAt === null),
    [filtered],
  );
  const readItems = useMemo(
    () => filtered.filter((n) => n.readAt !== null),
    [filtered],
  );

  const unreadCount = useMemo(
    () => items.filter((n) => n.readAt === null).length,
    [items],
  );
  const hasUnread = unreadCount > 0;

  function handleRowClick(notification: NotificationItem) {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const deeplink = resolveNotificationDeeplink(notification);
    if (deeplink) {
      router.push(toLocaleHref(deeplink, locale));
    }
  }

  if (inboxQuery.isLoading) {
    return <InboxSkeleton />;
  }

  if (inboxQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {inboxQuery.error instanceof ApiClientError
            ? inboxQuery.error.message
            : 'Xabarnomalarni yuklashda xato yuz berdi.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* ── Hero header ── */}
      <header className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue/5 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-purple/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue" />
                </span>
                Xabarnomalar markazi
              </div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                Xabarnomalar
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft">
                {hasUnread
                  ? `${unreadCount} ta o'qilmagan xabar. Eng yangilari yuqorida.`
                  : "Hammasi o'qilgan. Eng yangilari yuqorida."}
              </p>
            </div>

            <Link
              href={`/${locale}/settings/notifications`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-tint px-4 py-2 text-xs font-bold text-ink-strong transition-all hover:border-blue/30 hover:bg-canvas active:scale-[0.98]"
            >
              <Settings className="h-4 w-4 text-ink-soft" />
              Sozlamalar
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              aria-pressed={unreadOnly}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition-all active:scale-[0.98] ${
                unreadOnly
                  ? 'bg-blue/10 text-blue ring-1 ring-inset ring-blue/30'
                  : 'border border-rim bg-tint text-ink-soft hover:border-blue/30 hover:text-ink-strong'
              }`}
            >
              <BellOff className="h-4 w-4" />
              Faqat o&apos;qilmaganlar
              {hasUnread ? (
                <span
                  className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-black ${
                    unreadOnly ? 'bg-blue text-white' : 'bg-blue/10 text-blue'
                  }`}
                >
                  {unreadCount}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={!hasUnread || markAllRead.isPending}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue px-5 py-2 text-xs font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              <CheckCheck className="h-4 w-4" />
              {markAllRead.isPending
                ? 'Belgilanmoqda...'
                : "Barchasini o'qilgan deb belgilash"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Kind filter chips (horizontally scrollable) ── */}
      <nav
        aria-label="Xabarnomalar bo'yicha filtr"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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

      {/* ── Notification groups ── */}
      {filtered.length === 0 ? (
        <EmptyState unreadOnly={unreadOnly} />
      ) : (
        <div className="space-y-8">
          {unreadItems.length > 0 ? (
            <NotificationGroup
              icon={<Sparkles className="h-5 w-5 text-blue" />}
              title="Yangi"
              count={unreadItems.length}
              items={unreadItems}
              onRowClick={handleRowClick}
            />
          ) : null}

          {readItems.length > 0 ? (
            <NotificationGroup
              icon={<CheckCheck className="h-5 w-5 text-ink-faint" />}
              title="Avval o'qilgan"
              count={readItems.length}
              items={readItems}
              onRowClick={handleRowClick}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function NotificationGroup({
  icon,
  title,
  count,
  items,
  onRowClick,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  items: NotificationItem[];
  onRowClick: (notification: NotificationItem) => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        icon={icon}
        title={title}
        action={
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-tint px-2 text-[11px] font-bold text-ink-soft">
            {count}
          </span>
        }
      />

      <ul className="space-y-2.5">
        {items.map((n) => (
          <NotificationRow
            key={n.id}
            notification={n}
            onClick={() => onRowClick(n)}
          />
        ))}
      </ul>
    </section>
  );
}

function SectionHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-ink-strong">
        {icon}
        {title}
      </h2>
      {action}
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
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-[0.97] ${
        active
          ? 'bg-blue text-white shadow-blue-soft'
          : 'border border-rim bg-canvas text-ink-soft hover:border-blue/30 hover:text-ink-strong'
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
  const meta = getNotificationKindMeta(notification.kind);
  const Icon = meta.icon;
  const kindLabel =
    NOTIFICATION_KIND_LABELS_UZ[notification.kind as NotificationKind] ??
    notification.kind;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`group relative flex w-full items-start gap-4 overflow-hidden rounded-2xl border p-4 text-left shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-blue/20 hover:shadow-medium ${
          isUnread ? 'border-blue/15 bg-blue/[0.04]' : 'border-rim bg-canvas'
        }`}
      >
        {/* Unread accent bar */}
        {isUnread ? (
          <span
            className="absolute inset-y-0 left-0 w-1 rounded-r-full bg-blue"
            aria-hidden
          />
        ) : null}

        {/* Colored kind avatar */}
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${TONE_BADGE_CLASS[meta.tone]}`}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p
              className={`truncate text-sm transition-colors group-hover:text-blue ${
                isUnread
                  ? 'font-extrabold text-ink-strong'
                  : 'font-bold text-ink-strong'
              }`}
            >
              {notification.title}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-[11px] font-medium text-ink-faint">
                {formatRelative(notification.createdAt)}
              </span>
              {isUnread ? (
                <span
                  className="inline-flex h-2 w-2 shrink-0 rounded-full bg-blue"
                  aria-label="O'qilmagan"
                />
              ) : null}
            </div>
          </div>

          {notification.body ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-soft">
              {notification.body}
            </p>
          ) : null}

          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            {kindLabel}
          </span>
        </div>
      </button>
    </li>
  );
}

function EmptyState({ unreadOnly }: { unreadOnly: boolean }) {
  const Icon = unreadOnly ? BellOff : Inbox;
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-3xl border border-dashed border-rim bg-canvas p-12 text-center shadow-soft">
      <div className="relative mb-6">
        <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue/10 text-blue">
          <Icon className="h-10 w-10" />
        </div>
      </div>
      <h2 className="font-display text-xl font-extrabold text-ink-strong">
        {unreadOnly ? "O'qilmagan xabar yo'q" : "Xabarnomalar yo'q"}
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        {unreadOnly
          ? "Barcha xabarnomalar o'qilgan. Yangi xabar kelganda shu yerda ko'rinadi."
          : "Hozircha xabarnomalar yo'q. Yangiliklar kelganda shu yerda paydo bo'ladi."}
      </p>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <div className="h-44 w-full animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-24 animate-pulse rounded-full bg-tint"
          />
        ))}
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[88px] animate-pulse rounded-2xl border border-rim bg-canvas shadow-soft"
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
