'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';

import {
  billingApi,
  type Invoice,
  type Subscription,
} from '../../../../../lib/api/billing';
import { ApiClientError } from '../../../../../lib/api-client';
import { getUserRole } from '../../../../../lib/auth';
import { toast } from '../../../../../components/ui/toast';
import { InvoiceHistory } from '../../../../../components/billing/invoice-history';
import { PaymentStateBanner } from '../../../../../components/billing/payment-state-banner';
import { SubscriptionRestrictionBanner } from '../../../../../components/billing/subscription-restriction-banner';

// ═════════════════════════════════════════════════════════════════
// Billing settings — invoice history (Req 13.3), payment-required /
// payment-failed recovery (Req 13.4), and PAST_DUE / EXPIRED restriction
// messaging (Req 13.5). Recovery actions route through the existing Payme
// checkout. The active locale is derived from the route segment.
// ═════════════════════════════════════════════════════════════════

interface BillingPageProps {
  params: { locale: string };
}

export default function SettingsBillingPage({
  params: { locale },
}: BillingPageProps) {
  // Role resolves after mount (the token lives in a cookie, unavailable
  // during SSR). Subscription state is instructor-only (Req 13).
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    setRole(getUserRole());
  }, []);
  const isTeacher = role === 'TEACHER';

  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => billingApi.getMyInvoices({ limit: 50 }),
  });

  const subscriptionQuery = useQuery<Subscription | null>({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billingApi.getSubscription(),
    enabled: isTeacher,
  });

  // Start / resume a Payme checkout, then hand off to the returned payUrl.
  const checkoutMutation = useMutation({
    mutationFn: (data: Parameters<typeof billingApi.checkout>[0]) =>
      billingApi.checkout(data, crypto.randomUUID()),
    onSuccess: (result) => {
      window.location.href = result.payUrl;
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : 'To‘lovni boshlashda xato yuz berdi',
      );
    },
  });

  const invoices = useMemo<Invoice[]>(
    () => invoicesQuery.data?.items ?? [],
    [invoicesQuery.data],
  );

  const subscription = subscriptionQuery.data ?? null;
  const status = subscription?.status ?? null;
  const isPastDue = status === 'PAST_DUE';

  // Most-recent unfinished payment (history is newest-first).
  const pendingInvoice = useMemo(
    () => invoices.find((inv) => inv.status === 'PENDING') ?? null,
    [invoices],
  );

  // Recovery: retry the failed subscription charge via Payme. Falls back to
  // the subscription page when we can't resolve the plan slug.
  const retrySubscriptionPayment = () => {
    const slug = subscription?.plan?.slug;
    if (slug) {
      checkoutMutation.mutate({ kind: 'TEACHER_SUBSCRIPTION', planSlug: slug });
    } else {
      window.location.href = `/${locale}/settings/subscription`;
    }
  };

  // Recovery: complete a specific pending invoice's payment via Payme.
  const completePendingPayment = (invoice: Invoice) => {
    if (invoice.kind === 'TEACHER_SUBSCRIPTION') {
      const slug = subscription?.plan?.slug;
      if (slug) {
        checkoutMutation.mutate({
          kind: 'TEACHER_SUBSCRIPTION',
          planSlug: slug,
        });
      } else {
        window.location.href = `/${locale}/settings/subscription`;
      }
      return;
    }
    if (invoice.groupId) {
      checkoutMutation.mutate({
        kind: 'STUDENT_COURSE',
        groupId: invoice.groupId,
      });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:space-y-10">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] border border-blue/10 bg-blue/5 text-blue sm:h-16 sm:w-16 sm:rounded-[1.5rem]">
            <CreditCard className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-extrabold text-ink-strong sm:text-3xl">
              To‘lovlar
            </h2>
            <p className="max-w-md text-sm text-ink-soft opacity-80">
              To‘lov tarixi va hisob-kitoblaringizni ko‘ring.
            </p>
          </div>
        </div>
      </header>

      {/* Payment-failed recovery (Req 13.4) — instructor PAST_DUE. */}
      {isTeacher && isPastDue ? (
        <PaymentStateBanner
          variant="failed"
          locale={locale}
          {...(subscription?.plan
            ? { amountUzs: subscription.plan.priceUzs }
            : {})}
          onRetry={retrySubscriptionPayment}
          retryPending={checkoutMutation.isPending}
        />
      ) : null}

      {/* Payment-required recovery (Req 13.4) — an unfinished invoice. */}
      {!isPastDue && pendingInvoice ? (
        <PaymentStateBanner
          variant="required"
          locale={locale}
          amountUzs={pendingInvoice.amountUzs}
          onRetry={() => completePendingPayment(pendingInvoice)}
          retryPending={checkoutMutation.isPending}
        />
      ) : null}

      {/* Restriction messaging (Req 13.5) — PAST_DUE / EXPIRED. */}
      {isTeacher ? (
        <SubscriptionRestrictionBanner status={status} locale={locale} />
      ) : null}

      <InvoiceHistory
        invoices={invoices}
        locale={locale}
        isLoading={invoicesQuery.isLoading}
        isError={invoicesQuery.isError}
        onRetry={() => invoicesQuery.refetch()}
      />
    </div>
  );
}
