/**
 * Notification kind metadata + deep-link resolution (Task 10.1, Req 14.1/14.2).
 *
 * One place that maps every backend `NotificationKind` (plus a few
 * gamification/billing string kinds the API may emit, e.g. `LEVEL_UP`)
 * to:
 *   - a Lucide icon + tone class for the row badge, and
 *   - a locale-relative deep link to the relevant surface.
 *
 * The notification center (`notification-bell.tsx`, `notification-panel.tsx`)
 * uses these helpers so the bell drawer and any future inbox navigate
 * consistently.
 *
 * Deep-link routes are taken from the live App Router tree under
 * `app/[locale]/(dashboard)` / `(live)`:
 *   /requests, /my-courses, /schedule, /homework, /homework/:id,
 *   /assignments/:id, /submissions/:id, /lessons/:id, /groups/:id,
 *   /live/:id, /achievements, /settings/billing, /settings/subscription.
 */

import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Radio,
  Sparkles,
  Trophy,
  UserCheck,
  Bell,
  type LucideIcon,
} from 'lucide-react';

import type { NotificationItem } from '../../lib/api/notifications';

/** Visual tone for a kind badge — maps to the redesign color tokens. */
export type NotificationTone = 'blue' | 'green' | 'red' | 'orange' | 'purple';

export interface NotificationKindMeta {
  icon: LucideIcon;
  tone: NotificationTone;
}

/**
 * Icon + tone per kind. Keyed by string so it also covers kinds that
 * are not (yet) in the `NOTIFICATION_KINDS` enum — notably the
 * gamification "level-up" and generic billing events called out in
 * Req 14.2.
 */
const KIND_META: Record<string, NotificationKindMeta> = {
  ENROLLMENT_REQUESTED: { icon: UserCheck, tone: 'blue' },
  ENROLLMENT_APPROVED: { icon: CheckCircle2, tone: 'green' },
  ENROLLMENT_REJECTED: { icon: AlertCircle, tone: 'red' },
  PAYMENT_SUCCEEDED: { icon: CreditCard, tone: 'green' },
  PAYMENT_FAILED: { icon: CreditCard, tone: 'red' },
  LESSON_PUBLISHED: { icon: BookOpen, tone: 'blue' },
  SCHEDULE_CHANGED: { icon: CalendarClock, tone: 'orange' },
  LIVE_STARTED: { icon: Radio, tone: 'green' },
  LIVE_REMINDER: { icon: Radio, tone: 'blue' },
  HOMEWORK_ASSIGNED: { icon: FileText, tone: 'blue' },
  HOMEWORK_GRADED: { icon: CheckCircle2, tone: 'green' },
  AI_REVIEW_READY: { icon: Sparkles, tone: 'purple' },
  TRIAL_ENDING: { icon: Clock, tone: 'orange' },
  SUBSCRIPTION_PAST_DUE: { icon: AlertCircle, tone: 'red' },
  // Gamification / billing kinds the backend may emit (Req 14.2).
  LEVEL_UP: { icon: Trophy, tone: 'orange' },
  ACHIEVEMENT_UNLOCKED: { icon: Trophy, tone: 'orange' },
  REWARD_GRANTED: { icon: Trophy, tone: 'orange' },
};

const DEFAULT_META: NotificationKindMeta = { icon: Bell, tone: 'blue' };

/** Icon + tone for a notification kind (safe for unknown kinds). */
export function getNotificationKindMeta(kind: string): NotificationKindMeta {
  return KIND_META[kind] ?? DEFAULT_META;
}

/** Tailwind classes for the kind badge container, by tone. */
export const TONE_BADGE_CLASS: Record<NotificationTone, string> = {
  blue: 'bg-blue/10 text-blue',
  green: 'bg-green/10 text-green',
  red: 'bg-red/10 text-red',
  orange: 'bg-orange/10 text-orange',
  purple: 'bg-purple/10 text-purple',
};

function readString(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!data) return null;
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolve a locale-relative deep link (always starting with `/`) for a
 * notification, or `null` when there is no meaningful destination.
 *
 * Resolution order:
 *   1. Explicit `data.deeplink` / `data.url` set by the backend.
 *   2. Kind-specific route, using ids from the `data` payload when present.
 *
 * The returned path does NOT include the locale prefix — call
 * {@link toLocaleHref} to produce a navigable href.
 */
export function resolveNotificationDeeplink(
  notification: NotificationItem,
): string | null {
  const data = notification.data;

  // 1. Explicit deep link wins.
  const explicit = readString(data, 'deeplink') ?? readString(data, 'url');
  if (explicit) return explicit;

  const lessonId = readString(data, 'lessonId');
  const assignmentId = readString(data, 'assignmentId');
  const submissionId = readString(data, 'submissionId');
  const groupId = readString(data, 'groupId');
  const sessionId =
    readString(data, 'sessionId') ??
    readString(data, 'liveSessionId') ??
    readString(data, 'liveId');

  // 2. Kind-specific routing.
  switch (notification.kind) {
    case 'ENROLLMENT_REQUESTED':
      return '/requests';
    case 'ENROLLMENT_APPROVED':
    case 'ENROLLMENT_REJECTED':
      return '/my-courses';
    case 'PAYMENT_SUCCEEDED':
    case 'PAYMENT_FAILED':
      return '/settings/billing';
    case 'TRIAL_ENDING':
    case 'SUBSCRIPTION_PAST_DUE':
      return '/settings/subscription';
    case 'LESSON_PUBLISHED':
      return lessonId ? `/lessons/${lessonId}` : '/my-courses';
    case 'SCHEDULE_CHANGED':
      return '/schedule';
    case 'LIVE_STARTED':
    case 'LIVE_REMINDER':
      return sessionId ? `/live/${sessionId}` : '/schedule';
    case 'HOMEWORK_ASSIGNED':
      return assignmentId ? `/homework/${assignmentId}` : '/homework';
    case 'HOMEWORK_GRADED':
    case 'AI_REVIEW_READY':
      return submissionId ? `/submissions/${submissionId}` : '/homework';
    case 'LEVEL_UP':
    case 'ACHIEVEMENT_UNLOCKED':
      return '/achievements';
    case 'REWARD_GRANTED':
      return '/rewards';
    default:
      break;
  }

  // 3. Generic id fallbacks for unknown kinds carrying a known id.
  if (lessonId) return `/lessons/${lessonId}`;
  if (assignmentId) return `/assignments/${assignmentId}`;
  if (submissionId) return `/submissions/${submissionId}`;
  if (groupId) return `/groups/${groupId}`;
  if (sessionId) return `/live/${sessionId}`;

  return null;
}

const LOCALE_PREFIX = /^\/(uz|ru|en)(\/|$)/;

/**
 * Turn a deep link into a navigable href.
 *
 * - External (`http(s)://`) links are returned unchanged.
 * - Already locale-prefixed paths are left as-is.
 * - Everything else is prefixed with the active locale so client
 *   navigation stays inside the localized route tree.
 */
export function toLocaleHref(deeplink: string, locale: string): string {
  if (/^https?:\/\//i.test(deeplink)) return deeplink;
  const path = deeplink.startsWith('/') ? deeplink : `/${deeplink}`;
  if (LOCALE_PREFIX.test(path)) return path;
  return `/${locale}${path}`;
}
