import { apiClient } from '../api-client';

// ─────────────────────────────────────────────────────────────────
// Billing API wrapper.
//
// Backend reality (apps/api/src/modules/billing):
//   - GET  /billing/invoices  → paginated invoice history (task 9.2)
//   - POST /billing/checkout  → { invoiceId, payUrl, amountUzs }
//
// Endpoint ASSUMPTIONS made for the subscription UI (task 9.1). These
// mirror the existing service methods (BillingService.cancel,
// startTrial, requireActiveSubscription) and the Prisma Plan/Subscription
// models, but are not yet exposed as REST routes on BillingController.
// They need to be added backend-side to wire the UI to live data:
//   - GET  /billing/subscription          → current Subscription | null
//   - GET  /billing/plans                 → Plan[] (active plans, UZS)
//   - POST /billing/subscription/cancel   → Subscription (→ CANCELED)
//
// "Start" and "Upgrade" both route through the existing Payme checkout
// (POST /billing/checkout with kind=TEACHER_SUBSCRIPTION + planSlug),
// which returns a payUrl the UI redirects to.
// ─────────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED';

export interface Invoice {
  id: string;
  kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
  amountUzs: number;
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  issuedAt: string;
  paidAt: string | null;
  paymeTxId: string | null;
  groupId: string | null;
  subscriptionId: string | null;
  studentId: string | null;
  teacherId: string | null;
  /**
   * ASSUMPTION (task 9.2): URL to a downloadable receipt / fiscal check for
   * a PAID invoice. Not yet emitted by GET /billing/invoices — the backend
   * needs to surface it (e.g. a Payme fiscal-receipt link or a generated PDF
   * at GET /billing/invoices/:id/receipt). The UI renders a download action
   * only when this field is present, so it degrades gracefully until then.
   */
  receiptUrl?: string | null;
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
}

/** A subscription plan (mirrors the Prisma `Plan` model — UZS pricing). */
export interface Plan {
  id: string;
  slug: string;
  /** Plan display name (stored tri-lingually backend-side; nameUz is canonical). */
  nameUz: string;
  /** Recurring price in Uzbek so'm (UZS). */
  priceUzs: number;
  /** Billing interval in days (e.g. 30 for monthly). */
  intervalDays: number;
  /** Max enrolled students this plan allows, or null for unlimited. */
  maxStudents: number | null;
  /** Feature labels included in the plan (for the comparison table). */
  features: string[];
  isActive: boolean;
}

/** A teacher's subscription (mirrors the Prisma `Subscription` model). */
export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  planId: string | null;
  plan: Plan | null;
  /** ISO timestamp the TRIAL ends at (null outside of TRIAL). */
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** ISO timestamp at which a pending cancellation takes effect. */
  cancelAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutResponse {
  invoiceId: string;
  payUrl: string;
  amountUzs: number;
}

export const billingApi = {
  getMyInvoices: (
    params: { page?: number; limit?: number } = {},
  ): Promise<InvoiceListResponse> =>
    apiClient.get('/billing/invoices', { params }),

  /** Current subscription for the authenticated teacher (null if none). */
  getSubscription: (): Promise<Subscription | null> =>
    apiClient.get('/billing/subscription'),

  /** Active plans available to subscribe to (UZS pricing). */
  getPlans: (): Promise<Plan[]> => apiClient.get('/billing/plans'),

  /**
   * Start or upgrade a paid subscription. Returns the Payme `payUrl` the
   * caller should redirect the browser to. Idempotency key dedupes
   * accidental double-submits.
   */
  checkout: (
    data: {
      kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
      groupId?: string;
      planSlug?: string;
    },
    idempotencyKey?: string,
  ): Promise<CheckoutResponse> =>
    apiClient.post(
      '/billing/checkout',
      data,
      idempotencyKey ? { idempotencyKey } : undefined,
    ),

  /** Cancel the current subscription (non-terminal → CANCELED). */
  cancelSubscription: (): Promise<Subscription> =>
    apiClient.post('/billing/subscription/cancel'),
};
