'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiClientError } from '../../lib/api-client';
import {
  notificationsApi,
  type NotificationItem as NotificationItemModel,
  type NotificationKind,
} from '../../lib/notifications-api';
import {
  NotificationItem,
  pickNotificationDeeplink,
} from './notification-item';
import { NotificationFilters } from './notification-filters';

interface NotificationsListProps {
  locale: string;
}

/**
 * Full notification center (Task 25.6 / Req 16.1).
 *
 * Layout:
 *   [Header: title + "Mark all as read" action]
 *   [Filter bar: kind chips + unread-only toggle]
 *   [Scrollable list of NotificationItem rows]
 *
 * Behavior:
 *   - Polls `GET /notifications` every 60s for freshness.
 *   - Click on an unread row → `PATCH /notifications/:id/read` and
 *     navigate to the row's deeplink (when present).
 *   - "Barchasini o'qilgan" → `POST /notifications/mark-all-read`.
 *   - Kind filter is applied client-side over the most recent page
 *     since the API does not yet expose a `kind` filter.
 */
export function NotificationsList({ locale }: NotificationsListProps) {
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

  function handleRowClick(notification: NotificationItemModel) {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    const deeplink = pickNotificationDeeplink(notification);
    if (deeplink) {
      router.push(
        deeplink.startsWith('/') ? deeplink : `/${locale}${deeplink}`,
      );
    }
  }

  if (inboxQuery.isLoading) {
    return <ListSkeleton />;
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
      </header>

      <NotificationFilters
        activeKind={filterKind}
        onChangeKind={setFilterKind}
        unreadOnly={unreadOnly}
        onToggleUnread={setUnreadOnly}
      />

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
              <NotificationItem
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

function ListSkeleton() {
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
