'use client';

import { Check, Sparkles, Users, Infinity as InfinityIcon } from 'lucide-react';

import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { Plan, SubscriptionStatus } from '../../lib/api/billing';
import { formatUzs, isTerminalStatus } from './utils';

// ═════════════════════════════════════════════════════════════════
// PlansComparison — available plans with UZS pricing + feature
// comparison and start/upgrade/cancel actions (Req 13.2). Payments
// route through the parent's checkout handler (Payme).
// ═════════════════════════════════════════════════════════════════

export interface PlansComparisonProps {
  plans: Plan[];
  locale: string;
  /** Current subscription status, or null if the user has no subscription. */
  status: SubscriptionStatus | null;
  /** Plan id of the current subscription, if any. */
  currentPlanId: string | null;
  /** Start or upgrade to a plan — routes to Payme via the parent. */
  onSelectPlan: (plan: Plan) => void;
  /** Cancel the current subscription. */
  onCancel: () => void;
  /** Slug currently being checked out (disables that card's button). */
  pendingSlug?: string | null;
  /** Whether a cancel request is in flight. */
  cancelPending?: boolean;
}

export function PlansComparison({
  plans,
  locale,
  status,
  currentPlanId,
  onSelectPlan,
  onCancel,
  pendingSlug,
  cancelPending = false,
}: PlansComparisonProps) {
  const hasActivePaidContext = status !== null && !isTerminalStatus(status);

  return (
    <section aria-label="Tariflar" className="space-y-5">
      <div className="space-y-1">
        <h3 className="font-display text-lg font-extrabold text-ink-strong">
          Tariflar
        </h3>
        <p className="text-sm text-ink-soft">
          O‘zingizga mos tarifni tanlang. To‘lovlar Payme orqali amalga
          oshiriladi.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = currentPlanId !== null && plan.id === currentPlanId;
          const isPending = pendingSlug === plan.slug;

          // Action label depends on context (Req 13.2: start / upgrade).
          const actionLabel = isCurrent
            ? 'Joriy tarif'
            : hasActivePaidContext
              ? 'Tarifga o‘tish'
              : 'Tarifni tanlash';

          return (
            <article
              key={plan.id}
              className={cn(
                'relative flex flex-col gap-5 rounded-[1.75rem] border bg-white p-6 shadow-soft transition-shadow hover:shadow-large',
                isCurrent ? 'border-blue/40 ring-1 ring-blue/20' : 'border-rim',
              )}
            >
              {isCurrent ? (
                <Badge
                  variant="blue"
                  size="sm"
                  className="absolute right-5 top-5"
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Joriy
                </Badge>
              ) : null}

              <div className="space-y-1">
                <h4 className="font-display text-lg font-extrabold text-ink-strong">
                  {plan.nameUz}
                </h4>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-extrabold text-ink-strong">
                    {formatUzs(plan.priceUzs, locale)}
                  </span>
                  <span className="text-sm font-semibold text-ink-faint">
                    / {plan.intervalDays} kun
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-tint/40 px-3 py-2 text-sm font-semibold text-ink-soft">
                {plan.maxStudents === null ? (
                  <>
                    <InfinityIcon className="h-4 w-4 text-blue" aria-hidden="true" />
                    Cheksiz o‘quvchi
                  </>
                ) : (
                  <>
                    <Users className="h-4 w-4 text-blue" aria-hidden="true" />
                    {plan.maxStudents} tagacha o‘quvchi
                  </>
                )}
              </div>

              {plan.features.length > 0 ? (
                <ul className="flex flex-1 flex-col gap-2.5">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-ink-soft"
                    >
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-green"
                        aria-hidden="true"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex-1" />
              )}

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant={isCurrent ? 'secondary' : 'primary'}
                  fullWidth
                  disabled={isCurrent}
                  loading={isPending}
                  onClick={() => onSelectPlan(plan)}
                >
                  {actionLabel}
                </Button>

                {isCurrent && hasActivePaidContext ? (
                  <Button
                    type="button"
                    variant="ghost"
                    fullWidth
                    loading={cancelPending}
                    onClick={onCancel}
                    className="text-red hover:bg-red/5 hover:text-red"
                  >
                    Obunani bekor qilish
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
