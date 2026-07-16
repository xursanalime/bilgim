'use client';

import { CreditCard, CalendarClock, Layers } from 'lucide-react';

import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { Subscription } from '../../lib/api/billing';
import { TrialCountdown } from './trial-countdown';
import { STATUS_META, formatDate, formatUzs } from './utils';

// ═════════════════════════════════════════════════════════════════
// SubscriptionStatusCard — current subscription state with per-status
// visual treatment, plan/period summary, and (during TRIAL) a live
// countdown (Req 13.1).
// ═════════════════════════════════════════════════════════════════

export interface SubscriptionStatusCardProps {
  subscription: Subscription;
  locale: string;
  className?: string;
}

export function SubscriptionStatusCard({
  subscription,
  locale,
  className,
}: SubscriptionStatusCardProps) {
  const meta = STATUS_META[subscription.status];
  const isTrial = subscription.status === 'TRIAL';
  const showCancelNotice =
    subscription.cancelAt && subscription.status !== 'CANCELED';

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[2rem] border bg-white p-6 shadow-soft sm:p-8',
        meta.accentRing,
        className,
      )}
      aria-label="Obuna holati"
    >
      <div
        className={cn(
          'pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-[70px]',
          meta.accentBg,
        )}
        aria-hidden="true"
      />

      <div className="relative z-10 flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl border',
                meta.accentBg,
                meta.accentText,
                meta.accentRing,
              )}
            >
              <CreditCard className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">
                Joriy holat
              </p>
              <h3 className="font-display text-xl font-extrabold text-ink-strong">
                {subscription.plan?.nameUz ?? 'Obuna'}
              </h3>
            </div>
          </div>

          <Badge variant={meta.badgeVariant} size="lg">
            {meta.label}
          </Badge>
        </div>

        <p className="max-w-xl text-sm text-ink-soft">{meta.description}</p>

        {isTrial && subscription.trialEndsAt ? (
          <TrialCountdown endsAt={subscription.trialEndsAt} />
        ) : null}

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {subscription.plan ? (
            <SummaryItem
              icon={<Layers className="h-4 w-4" aria-hidden="true" />}
              label="Tarif narxi"
              value={`${formatUzs(subscription.plan.priceUzs, locale)} / ${subscription.plan.intervalDays} kun`}
            />
          ) : null}

          {subscription.currentPeriodEnd ? (
            <SummaryItem
              icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
              label="Keyingi to‘lov sanasi"
              value={formatDate(subscription.currentPeriodEnd, locale)}
            />
          ) : null}
        </dl>

        {showCancelNotice ? (
          <p className="rounded-xl border border-orange/20 bg-orange/5 px-4 py-3 text-xs font-semibold text-orange">
            Obuna {formatDate(subscription.cancelAt, locale)} sanasida bekor
            qilinadi.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SummaryItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-rim bg-tint/30 px-4 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-ink-soft">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          {label}
        </dt>
        <dd className="truncate text-sm font-bold text-ink-strong">{value}</dd>
      </div>
    </div>
  );
}
