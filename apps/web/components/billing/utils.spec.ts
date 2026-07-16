import {
  formatUzs,
  formatDate,
  STATUS_META,
  isAccessGranting,
  isTerminalStatus,
  invoiceStatusMeta,
  invoiceKindLabel,
  INVOICE_STATUS_META,
} from './utils';
import type { SubscriptionStatus } from '../../lib/api/billing';

describe('billing utils', () => {
  describe('formatUzs', () => {
    it('groups thousands and appends the uz suffix by default', () => {
      // Uzbek locale groups with a non-breaking/narrow space; assert on the
      // digits + suffix rather than the exact separator character.
      const out = formatUzs(150000, 'uz');
      expect(out).toMatch(/150.?000 so'm$/);
    });

    it('uses the ru suffix for the ru locale', () => {
      expect(formatUzs(50000, 'ru')).toMatch(/сум$/);
    });

    it('uses the en suffix for the en locale', () => {
      expect(formatUzs(50000, 'en')).toMatch(/UZS$/);
    });

    it('falls back to the uz suffix for an unknown locale', () => {
      expect(formatUzs(1000, 'xx')).toMatch(/so'm$/);
    });

    it('formats zero without crashing', () => {
      expect(formatUzs(0, 'uz')).toMatch(/^0 so'm$/);
    });
  });

  describe('formatDate', () => {
    it('returns an em dash for null', () => {
      expect(formatDate(null, 'uz')).toBe('—');
    });

    it('returns an em dash for an invalid date', () => {
      expect(formatDate('not-a-date', 'uz')).toBe('—');
    });

    it('formats a valid ISO date', () => {
      const out = formatDate('2025-01-15T00:00:00.000Z', 'en');
      expect(out).toContain('2025');
    });
  });

  describe('STATUS_META', () => {
    const statuses: SubscriptionStatus[] = [
      'TRIAL',
      'ACTIVE',
      'PAST_DUE',
      'CANCELED',
      'EXPIRED',
    ];

    it('defines metadata for every subscription status', () => {
      for (const status of statuses) {
        expect(STATUS_META[status]).toBeDefined();
        expect(STATUS_META[status].label.length).toBeGreaterThan(0);
        expect(STATUS_META[status].description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('isAccessGranting', () => {
    it('is true only for TRIAL and ACTIVE', () => {
      expect(isAccessGranting('TRIAL')).toBe(true);
      expect(isAccessGranting('ACTIVE')).toBe(true);
      expect(isAccessGranting('PAST_DUE')).toBe(false);
      expect(isAccessGranting('CANCELED')).toBe(false);
      expect(isAccessGranting('EXPIRED')).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('is true only for EXPIRED and CANCELED', () => {
      expect(isTerminalStatus('EXPIRED')).toBe(true);
      expect(isTerminalStatus('CANCELED')).toBe(true);
      expect(isTerminalStatus('TRIAL')).toBe(false);
      expect(isTerminalStatus('ACTIVE')).toBe(false);
      expect(isTerminalStatus('PAST_DUE')).toBe(false);
    });
  });

  describe('invoiceStatusMeta', () => {
    it('defines a label and badge variant for every invoice status', () => {
      for (const status of ['PAID', 'PENDING', 'CANCELED', 'REFUNDED'] as const) {
        const meta = INVOICE_STATUS_META[status];
        expect(meta.label.length).toBeGreaterThan(0);
        expect(meta.badgeVariant.length).toBeGreaterThan(0);
      }
    });

    it('resolves known statuses to their metadata', () => {
      expect(invoiceStatusMeta('PAID').badgeVariant).toBe('green');
      expect(invoiceStatusMeta('PENDING').badgeVariant).toBe('orange');
    });

    it('falls back to a neutral pill for an unknown status', () => {
      const meta = invoiceStatusMeta('SOMETHING_ELSE');
      expect(meta.badgeVariant).toBe('neutral');
      expect(meta.label).toBe('SOMETHING_ELSE');
    });
  });

  describe('invoiceKindLabel', () => {
    it('localizes known kinds', () => {
      expect(invoiceKindLabel('STUDENT_COURSE')).toMatch(/Kurs/);
      expect(invoiceKindLabel('TEACHER_SUBSCRIPTION')).toMatch(/Obuna/);
    });

    it('falls back to the raw value for an unknown kind', () => {
      expect(invoiceKindLabel('MYSTERY')).toBe('MYSTERY');
    });
  });
});
