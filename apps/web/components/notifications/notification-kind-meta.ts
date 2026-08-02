import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  BookOpen,
  CalendarClock,
  CreditCard,
  GraduationCap,
  Radio,
  Sparkles,
  UserPlus,
  UserX,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { NotificationKind } from '../../lib/api/notifications';

/**
 * Per-kind presentation: an icon and a colour family.
 *
 * The inbox used to render every notification identically — same grey row,
 * with the kind spelled out in a monospace all-caps label underneath. That
 * made a payment failure and a new lesson look the same at a glance. A
 * colour-coded icon carries the meaning instead, so the label can go.
 *
 * `tone` maps onto the Apple palette already in the design system. Green is
 * deliberately absent — `teal` is the positive tone.
 */
export type NotificationTone = 'blue' | 'teal' | 'orange' | 'red' | 'purple';

export interface NotificationKindMeta {
  icon: LucideIcon;
  tone: NotificationTone;
  /** Short category used to group the filter bar. */
  group: 'guruh' | 'dars' | 'vazifa' | 'tolov';
}

export const NOTIFICATION_KIND_META: Record<
  NotificationKind,
  NotificationKindMeta
> = {
  ENROLLMENT_REQUESTED: { icon: UserPlus, tone: 'blue', group: 'guruh' },
  ENROLLMENT_APPROVED: { icon: BadgeCheck, tone: 'teal', group: 'guruh' },
  ENROLLMENT_REJECTED: { icon: UserX, tone: 'red', group: 'guruh' },

  LESSON_PUBLISHED: { icon: BookOpen, tone: 'blue', group: 'dars' },
  SCHEDULE_CHANGED: { icon: CalendarClock, tone: 'orange', group: 'dars' },
  LIVE_STARTED: { icon: Radio, tone: 'red', group: 'dars' },
  LIVE_REMINDER: { icon: BellRing, tone: 'orange', group: 'dars' },

  HOMEWORK_ASSIGNED: { icon: GraduationCap, tone: 'blue', group: 'vazifa' },
  HOMEWORK_GRADED: { icon: BadgeCheck, tone: 'teal', group: 'vazifa' },
  AI_REVIEW_READY: { icon: Sparkles, tone: 'purple', group: 'vazifa' },

  PAYMENT_SUCCEEDED: { icon: Wallet, tone: 'teal', group: 'tolov' },
  PAYMENT_FAILED: { icon: XCircle, tone: 'red', group: 'tolov' },
  TRIAL_ENDING: { icon: AlertTriangle, tone: 'orange', group: 'tolov' },
  SUBSCRIPTION_PAST_DUE: { icon: CreditCard, tone: 'red', group: 'tolov' },
};

/** Fallback for a kind the client does not know about yet. */
export const FALLBACK_KIND_META: NotificationKindMeta = {
  icon: BellRing,
  tone: 'blue',
  group: 'guruh',
};

export function kindMeta(kind: string): NotificationKindMeta {
  return (
    NOTIFICATION_KIND_META[kind as NotificationKind] ?? FALLBACK_KIND_META
  );
}

/** Tailwind classes for the icon tile, keyed by tone. */
export const TONE_TILE: Record<NotificationTone, string> = {
  blue: 'bg-blue-tint text-blue',
  teal: 'bg-teal-tint text-teal',
  orange: 'bg-orange-tint text-orange',
  red: 'bg-red-tint text-red',
  purple: 'bg-purple-tint text-purple',
};

export const GROUP_LABELS: Record<NotificationKindMeta['group'], string> = {
  guruh: 'Guruh',
  dars: 'Darslar',
  vazifa: 'Vazifalar',
  tolov: "To'lov",
};
