'use client';

import { CreditCard, RefreshCw, Wallet } from 'lucide-react';

import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { formatUzs } from './utils';

// ═════════════════════════════════════════════════════════════════
// PaymentStateBanner — actionable payment states + recovery path
// (Req 13.4). Two variants:
//   - 'failed'   → a charge failed (e.g. PAST_DUE); offer a retry.
//   - 'required' → an unfinished/pending payment; offer to complete it.
// Both route the recovery action back through the parent's Payme
// checkout handler (`onRetry`).
// ═════════════════════════════════════════════════════════════════

export type PaymentBannerVariant = 'failed' | 'required';

interface VariantCopy {
  title: string;
  description: string;
  actionLabel: string;
  surface: string;
  iconWrap: string;
}

const VARIANT_COPY: Record<PaymentBannerVariant, VariantCopy> = {
  failed: {
    title: 'To‘lov amalga oshmadi',
    description:
      'So‘nggi to‘lov amalga oshmadi. Obunangiz uzilib qolmasligi uchun to‘lovni qayta urinib ko‘ring.',
    actionLabel: 'To‘lovni qayta urinish',
    surface: 'border-orange/30 bg-orange/5',
    iconWrap: 'bg-orange/10 text-orange',
  },
  required: {
    title: 'To‘lov kutilmoqda',
    description:
      'Sizda yakunlanmagan to‘lov bor. Davom etish uchun to‘lovni Payme orqali yakunlang.',
    actionLabel: 'To‘lovni yakunlash',
    surface: 'border-blue/30 bg-blue/5',
    iconWrap: 'bg-blue/10 text-blue',
  },
};

export interface PaymentStateBannerProps {
  variant: PaymentBannerVariant;
  locale: string;
  /** Optional amount (UZS) to show alongside the prompt. */
  amountUzs?: number;
  /** Recovery handler — routes through the parent's Payme checkout. */
  onRetry?: () => void;
  /** Whether the recovery request is in flight. */
  retryPending?: boolean;
  className?: string;
}

export function PaymentStateBanner({
  variant,
  locale,
  amountUzs,
  onRetry,
  retryPending = false,
  className,
}: PaymentStateBannerProps) {
  const copy = VARIANT_COPY[variant];
  const Icon = variant === 'failed' ? CreditCard : Wallet;

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
          <Icon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="font-display text-base font-extrabold text-ink-strong">
            {copy.title}
          </p>
          <p className="max-w-xl text-sm text-ink-soft">{copy.description}</p>
          {typeof amountUzs === 'number' ? (
            <p className="pt-1 text-sm font-bold text-ink-strong">
              {formatUzs(amountUzs, locale)}
            </p>
          ) : null}
        </div>
      </div>

      {onRetry ? (
        <Button
          type="button"
          variant="primary"
          className="self-start sm:self-auto"
          loading={retryPending}
          onClick={onRetry}
          leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
        >
          {copy.actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
