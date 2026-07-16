'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Inbox } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { LoadingState, ErrorState, EmptyState } from '../states';
import { toast } from '../ui/toast';
import {
  billingApi,
  type Plan,
  type Subscription,
} from '../../lib/api/billing';
import { ApiClientError } from '../../lib/api-client';
import { SubscriptionStatusCard } from './subscription-status-card';
import { PlansComparison } from './plans-comparison';

// ═════════════════════════════════════════════════════════════════
// SubscriptionPanel — orchestrates the subscription state card, trial
// countdown, and plans comparison. Owns data fetching + the Payme
// start/upgrade/cancel mutations (Req 13.1, 13.2).
// ═════════════════════════════════════════════════════════════════

export interface SubscriptionPanelProps {
  locale: string;
}

export function SubscriptionPanel({ locale }: SubscriptionPanelProps) {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const subscriptionQuery = useQuery<Subscription | null>({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billingApi.getSubscription(),
  });

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['billing', 'plans'],
    queryFn: () => billingApi.getPlans(),
  });

  // Start / upgrade → Payme. On success we redirect the browser to payUrl.
  const checkoutMutation = useMutation({
    mutationFn: (plan: Plan) =>
      billingApi.checkout(
        { kind: 'TEACHER_SUBSCRIPTION', planSlug: plan.slug },
        crypto.randomUUID(),
      ),
    onMutate: (plan) => setPendingSlug(plan.slug),
    onSuccess: (result) => {
      // Hand off to Payme.
      window.location.href = result.payUrl;
    },
    onError: (error) => {
      setPendingSlug(null);
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : 'To‘lovni boshlashda xato yuz berdi',
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => billingApi.cancelSubscription(),
    onSuccess: () => {
      setConfirmCancel(false);
      toast.success('Obuna bekor qilindi');
      queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : 'Obunani bekor qilishda xato yuz berdi',
      );
    },
  });

  if (subscriptionQuery.isLoading || plansQuery.isLoading) {
    return <LoadingState variant="page" label="Obuna ma'lumotlari yuklanmoqda" />;
  }

  if (subscriptionQuery.isError || plansQuery.isError) {
    return (
      <ErrorState
        icon={<AlertTriangle className="h-8 w-8" />}
        title="Ma'lumotlarni yuklab bo‘lmadi"
        message="Obuna ma'lumotlarini yuklashda xato yuz berdi. Qaytadan urinib ko‘ring."
        retryLabel="Qayta urinish"
        onRetry={() => {
          subscriptionQuery.refetch();
          plansQuery.refetch();
        }}
      />
    );
  }

  const subscription = subscriptionQuery.data ?? null;
  const plans = (plansQuery.data ?? []).filter((p) => p.isActive);

  return (
    <div className="space-y-8">
      {subscription ? (
        <SubscriptionStatusCard subscription={subscription} locale={locale} />
      ) : (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          title="Faol obuna yo‘q"
          description="Boshlash uchun quyidagi tariflardan birini tanlang."
        />
      )}

      {plans.length > 0 ? (
        <PlansComparison
          plans={plans}
          locale={locale}
          status={subscription?.status ?? null}
          currentPlanId={subscription?.planId ?? null}
          onSelectPlan={(plan) => checkoutMutation.mutate(plan)}
          onCancel={() => setConfirmCancel(true)}
          pendingSlug={pendingSlug}
          cancelPending={cancelMutation.isPending}
        />
      ) : (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          title="Tariflar mavjud emas"
          description="Hozircha tariflar e'lon qilinmagan. Keyinroq qayta tekshiring."
        />
      )}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Obunani bekor qilasizmi?</DialogTitle>
            <DialogDescription>
              Obunani bekor qilsangiz, joriy davr tugagach platforma
              imkoniyatlaridan foydalana olmaysiz. Bu amalni keyinroq qayta
              faollashtirishingiz mumkin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmCancel(false)}
              disabled={cancelMutation.isPending}
            >
              Bekor qilish
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Ha, obunani bekor qilish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
