'use client';

import {
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationItem as NotificationItemModel,
  type NotificationKind,
} from '../../lib/notifications-api';

interface NotificationItemProps {
  notification: NotificationItemModel;
  onClick: () => void;
}

/**
 * Single notification row used by the inbox list and the bell drawer.
 *
 * Visuals match the dark/cream theme (see `top-nav.tsx`,
 * `homework-overview.tsx`): unread items get a subtle accent tint and a
 * bullet, the kind label sits in a pill, and timestamps render as
 * relative tokens.
 */
export function NotificationItem({
  notification,
  onClick,
}: NotificationItemProps) {
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

/**
 * Best-effort extraction of a deeplink from a notification's data
 * payload. Re-exported so list-level code can navigate consistently.
 */
export function pickNotificationDeeplink(
  notification: NotificationItemModel,
): string | null {
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
