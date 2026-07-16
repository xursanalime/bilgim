'use client';

import { useQuery } from '@tanstack/react-query';

import { billingApi, type SubscriptionStatus } from '../lib/api/billing';
import { getUserRole } from '../lib/auth';

// ═════════════════════════════════════════════════════════════════
// usePublishingAllowed — gate teacher publish actions on subscription
// state (Req 8.7). While a teacher's subscription is EXPIRED or CANCELED
// they cannot publish new courses/lessons; this hook fetches the current
// subscription via TanStack Query and exposes whether publishing is
// allowed plus a localized reason + the path to resolve it.
//
// Shares the ['billing', 'subscription'] query key with the subscription
// settings UI, so the status is fetched once and cached across the app.
// ═════════════════════════════════════════════════════════════════

/** Subscription states that block publishing new content. */
const PUBLISH_BLOCKING_STATUSES: readonly SubscriptionStatus[] = [
  'EXPIRED',
  'CANCELED',
];

const BLOCK_REASON: Partial<Record<SubscriptionStatus, string>> = {
  EXPIRED:
    'Obuna muddati tugagani uchun yangi darslar va kurslarni e’lon qila olmaysiz. Davom etish uchun obunani qayta faollashtiring.',
  CANCELED:
    'Obuna bekor qilingani uchun yangi darslar va kurslarni e’lon qila olmaysiz. Davom etish uchun obunani qayta faollashtiring.',
};

export interface PublishingAllowedResult {
  /** True when the teacher may publish (also true while status is loading
   * so we never block optimistically before we know the real state). */
  allowed: boolean;
  /** True once we positively know publishing is blocked. */
  blocked: boolean;
  /** The resolved subscription status (null when none / not a teacher). */
  status: SubscriptionStatus | null;
  /** Localized explanation when blocked, otherwise null. */
  reason: string | null;
  /** Whether the subscription status is still loading. */
  isLoading: boolean;
}

export function usePublishingAllowed(): PublishingAllowedResult {
  const role = getUserRole();
  const isTeacher = role === 'TEACHER';

  const query = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billingApi.getSubscription(),
    enabled: isTeacher,
    staleTime: 60_000,
  });

  // Non-teachers never see publish actions; treat as allowed (no-op).
  if (!isTeacher) {
    return {
      allowed: true,
      blocked: false,
      status: null,
      reason: null,
      isLoading: false,
    };
  }

  const status = query.data?.status ?? null;
  const blocked =
    status !== null && PUBLISH_BLOCKING_STATUSES.includes(status);

  return {
    allowed: !blocked,
    blocked,
    status,
    reason: blocked && status ? BLOCK_REASON[status] ?? null : null,
    isLoading: query.isLoading,
  };
}
