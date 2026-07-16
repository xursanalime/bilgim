'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, Lock } from 'lucide-react';

import { cn } from '../../lib/utils';
import type { SubscriptionStatus } from '../../lib/api/billing';

// ═════════════════════════════════════════════════════════════════
// SubscriptionRestrictionBanner — while PAST_DUE / EXPIRED, explain the
// restriction (e.g. cannot publish new lessons) and link to the path to
// resolve it (Req 13.5, mirrors Req 8.7's publish restriction).
//
// Reusable + presentational: pass the current subscription status and it
// renders the appropriate notice, or nothing when access is unrestricted
// (TRIAL / ACTIVE / CANCELED-with-remaining-access).
// ═════════════════════════════════════════════════════════════════

interface RestrictionCopy {
  title: string;
  description: string;
  ctaLabel: string;
  iconWrap: string;
  surface: string;
}

const RESTRICTION_COPY: Partial<Record<SubscriptionStatus, RestrictionCopy>> = {
  PAST_DUE: {
    title: 'To‘lov muddati o‘tib ketdi',
    description:
      'Obunangiz to‘lovi amalga oshmadi. To‘lovni yangilamaguningizcha yangi darslar e’lon qila olmaysiz. Obunani saqlab qolish uchun to‘lovni yakunlang.',
    ctaLabel: 'To‘lovni yangilash',
    iconWrap: 'bg-orange/10 text-orange',
    surface: 'border-orange/30 bg-orange/5',
  },
  EXPIRED: {
    title: 'Obuna muddati tugadi',
    description:
      'Obunangiz muddati tugagani uchun yangi darslar e’lon qila olmaysiz. Davom etish uchun tarifni tanlab, obunani qayta faollashtiring.',
    ctaLabel: 'Tarifni tanlash',
    iconWrap: 'bg-red/10 text-red',
    surface: 'border-red/30 bg-red/5',
  },
};

export interface SubscriptionRestrictionBannerProps {
  /** Current subscription status (null → nothing to restrict). */
  status: SubscriptionStatus | null | undefined;
  locale: string;
  /** Override the resolve link (defaults to the subscription settings page). */
  href?: string;
  className?: string;
}

export function SubscriptionRestrictionBanner({
  status,
  locale,
  href,
  className,
}: SubscriptionRestrictionBannerProps) {
  if (!status) return null;
  const copy = RESTRICTION_COPY[status];
  if (!copy) return null;

  const resolveHref = href ?? `/${locale}/settings/subscription`;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-4 rounded-3xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6',
        copy.surface,
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
            copy.iconWrap,
          )}
          aria-hidden="true"
        >
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-display text-base font-extrabold text-ink-strong">
            <Lock className="h-4 w-4 text-ink-faint" aria-hidden="true" />
            {copy.title}
          </p>
          <p className="max-w-xl text-sm text-ink-soft">{copy.description}</p>
        </div>
      </div>

      <Link
        href={resolveHref}
        className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_0_0_1px_rgba(0,113,227,0.4),0_8px_24px_-8px_rgba(0,113,227,0.5)] outline-none transition-all duration-200 hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] sm:self-auto"
      >
        {copy.ctaLabel}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
