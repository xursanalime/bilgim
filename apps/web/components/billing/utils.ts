import type { BadgeProps } from '../ui/badge';
import type { Invoice, SubscriptionStatus } from '../../lib/api/billing';
import { formatUzs, formatDate } from '../../lib/format';

// ═════════════════════════════════════════════════════════════════
// Billing presentation helpers — per-status visual/copy metadata used
// by the subscription state cards.
//
// Locale-aware UZS / date formatting now lives in the shared
// `lib/format.ts` (Req 21.3). This module re-exports those helpers so
// existing billing components keep importing `formatUzs`/`formatDate`
// from here unchanged — this is the representative "extract to the
// shared formatter" demonstration for task 14.4. New code should import
// from `lib/format` directly.
// ═════════════════════════════════════════════════════════════════

export { formatUzs, formatDate };

export interface StatusMeta {
  /** Short localized label (uz canonical). */
  label: string;
  /** One-line localized description of the state. */
  description: string;
  /** Badge palette variant. */
  badgeVariant: NonNullable<BadgeProps['variant']>;
  /** Tailwind accent classes for the card surface (token-based). */
  accentBg: string;
  accentText: string;
  accentRing: string;
}

/** Per-status visual treatment + copy (Req 13.1). */
export const STATUS_META: Record<SubscriptionStatus, StatusMeta> = {
  TRIAL: {
    label: 'Sinov muddati',
    description: 'Bepul sinov muddatidasiz. Imkoniyatlardan to‘liq foydalaning.',
    badgeVariant: 'blue',
    accentBg: 'bg-blue/5',
    accentText: 'text-blue',
    accentRing: 'border-blue/15',
  },
  ACTIVE: {
    label: 'Faol',
    description: 'Obunangiz faol. Barcha imkoniyatlar ochiq.',
    badgeVariant: 'green',
    accentBg: 'bg-green/5',
    accentText: 'text-green',
    accentRing: 'border-green/15',
  },
  PAST_DUE: {
    label: 'To‘lov kutilmoqda',
    description:
      'To‘lov amalga oshmadi. Obunani saqlab qolish uchun to‘lovni yangilang.',
    badgeVariant: 'orange',
    accentBg: 'bg-orange/5',
    accentText: 'text-orange',
    accentRing: 'border-orange/15',
  },
  CANCELED: {
    label: 'Bekor qilingan',
    description: 'Obuna bekor qilindi. Istalgan vaqtda qayta faollashtiring.',
    badgeVariant: 'neutral',
    accentBg: 'bg-tint',
    accentText: 'text-ink-soft',
    accentRing: 'border-rim',
  },
  EXPIRED: {
    label: 'Muddati tugagan',
    description: 'Obuna muddati tugadi. Davom etish uchun tarifni tanlang.',
    badgeVariant: 'red',
    accentBg: 'bg-red/5',
    accentText: 'text-red',
    accentRing: 'border-red/15',
  },
};

/** Whether the status grants platform access right now (TRIAL or ACTIVE). */
export function isAccessGranting(status: SubscriptionStatus): boolean {
  return status === 'TRIAL' || status === 'ACTIVE';
}

/** Whether the status is terminal (no outgoing transitions). */
export function isTerminalStatus(status: SubscriptionStatus): boolean {
  return status === 'EXPIRED' || status === 'CANCELED';
}

// ═════════════════════════════════════════════════════════════════
// Invoice presentation helpers (Req 13.3) — localized labels + badge
// palette for invoice status and kind, shared by the invoice history
// list. Uzbek is the canonical copy.
// ═════════════════════════════════════════════════════════════════

export interface InvoiceStatusMeta {
  /** Localized status label (uz canonical). */
  label: string;
  /** Badge palette variant. */
  badgeVariant: NonNullable<BadgeProps['variant']>;
}

/** Per invoice-status visual treatment + copy (Req 13.3). */
export const INVOICE_STATUS_META: Record<Invoice['status'], InvoiceStatusMeta> =
  {
    PAID: { label: "To‘langan", badgeVariant: 'green' },
    PENDING: { label: 'Kutilmoqda', badgeVariant: 'orange' },
    CANCELED: { label: 'Bekor qilingan', badgeVariant: 'red' },
    REFUNDED: { label: 'Qaytarilgan', badgeVariant: 'blue' },
  };

/** Localized labels for an invoice's kind. */
export const INVOICE_KIND_LABELS: Record<Invoice['kind'], string> = {
  STUDENT_COURSE: "Kurs to‘lovi",
  TEACHER_SUBSCRIPTION: "Obuna to‘lovi",
};

/** Resolve invoice-status metadata, falling back to a neutral pill. */
export function invoiceStatusMeta(status: string): InvoiceStatusMeta {
  return (
    INVOICE_STATUS_META[status as Invoice['status']] ?? {
      label: status,
      badgeVariant: 'neutral',
    }
  );
}

/** Resolve an invoice-kind label, falling back to the raw value. */
export function invoiceKindLabel(kind: string): string {
  return INVOICE_KIND_LABELS[kind as Invoice['kind']] ?? kind;
}
