import { SubscriptionStatus } from '@prisma/client';

import {
  canTransition,
  isActive,
  isTerminal,
  nextValidStates,
} from './subscription-state-machine';

const ALL_STATES: SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'EXPIRED',
  'CANCELED',
];

/**
 * Subscription state-machine unit tests.
 *
 * Validates the transition table from Requirements 3.1, 3.3–3.8.
 */
describe('subscription-state-machine', () => {
  describe('canTransition', () => {
    // Whitelist of valid transitions per Req 3.1, 3.3, 3.4, 3.5, 3.6
    const VALID: Array<[SubscriptionStatus, SubscriptionStatus]> = [
      ['TRIAL', 'ACTIVE'],
      ['TRIAL', 'EXPIRED'],
      ['TRIAL', 'CANCELED'],
      ['ACTIVE', 'PAST_DUE'],
      ['ACTIVE', 'CANCELED'],
      ['PAST_DUE', 'ACTIVE'],
      ['PAST_DUE', 'EXPIRED'],
      ['PAST_DUE', 'CANCELED'],
    ];

    it.each(VALID)('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });

    it('rejects self-loops on every state', () => {
      for (const s of ALL_STATES) {
        expect(canTransition(s, s)).toBe(false);
      }
    });

    it('rejects any outgoing transition from EXPIRED (terminal)', () => {
      for (const s of ALL_STATES) {
        expect(canTransition('EXPIRED', s)).toBe(false);
      }
    });

    it('rejects any outgoing transition from CANCELED (terminal)', () => {
      for (const s of ALL_STATES) {
        expect(canTransition('CANCELED', s)).toBe(false);
      }
    });

    it('rejects ACTIVE → TRIAL (no going back to trial)', () => {
      expect(canTransition('ACTIVE', 'TRIAL')).toBe(false);
    });

    it('rejects ACTIVE → EXPIRED (must go through PAST_DUE first per Req 3.5/3.6)', () => {
      expect(canTransition('ACTIVE', 'EXPIRED')).toBe(false);
    });

    it('rejects PAST_DUE → TRIAL', () => {
      expect(canTransition('PAST_DUE', 'TRIAL')).toBe(false);
    });

    it('rejects every transition not in the whitelist', () => {
      const validSet = new Set(VALID.map(([f, t]) => `${f}→${t}`));
      for (const from of ALL_STATES) {
        for (const to of ALL_STATES) {
          if (from === to) continue;
          const expected = validSet.has(`${from}→${to}`);
          expect(canTransition(from, to)).toBe(expected);
        }
      }
    });
  });

  describe('nextValidStates', () => {
    it('returns the full outgoing set for TRIAL', () => {
      expect(nextValidStates('TRIAL').sort()).toEqual(
        ['ACTIVE', 'CANCELED', 'EXPIRED'].sort(),
      );
    });

    it('returns the full outgoing set for ACTIVE', () => {
      expect(nextValidStates('ACTIVE').sort()).toEqual(
        ['CANCELED', 'PAST_DUE'].sort(),
      );
    });

    it('returns the full outgoing set for PAST_DUE', () => {
      expect(nextValidStates('PAST_DUE').sort()).toEqual(
        ['ACTIVE', 'CANCELED', 'EXPIRED'].sort(),
      );
    });

    it('returns an empty array for EXPIRED', () => {
      expect(nextValidStates('EXPIRED')).toEqual([]);
    });

    it('returns an empty array for CANCELED', () => {
      expect(nextValidStates('CANCELED')).toEqual([]);
    });

    it('returns a fresh array (mutating it does not affect later calls)', () => {
      const first = nextValidStates('TRIAL');
      first.push('TRIAL' as SubscriptionStatus);
      const second = nextValidStates('TRIAL');
      expect(second).not.toContain('TRIAL');
    });
  });

  describe('isTerminal', () => {
    it('marks EXPIRED as terminal', () => {
      expect(isTerminal('EXPIRED')).toBe(true);
    });

    it('marks CANCELED as terminal', () => {
      expect(isTerminal('CANCELED')).toBe(true);
    });

    it('marks TRIAL, ACTIVE, PAST_DUE as non-terminal', () => {
      expect(isTerminal('TRIAL')).toBe(false);
      expect(isTerminal('ACTIVE')).toBe(false);
      expect(isTerminal('PAST_DUE')).toBe(false);
    });

    it('terminal states have no outgoing transitions', () => {
      for (const s of ALL_STATES) {
        if (isTerminal(s)) {
          expect(nextValidStates(s)).toHaveLength(0);
        }
      }
    });
  });

  describe('isActive (access-granting)', () => {
    it('grants access for TRIAL (Req 3.8: publish allowed during trial)', () => {
      expect(isActive('TRIAL')).toBe(true);
    });

    it('grants access for ACTIVE', () => {
      expect(isActive('ACTIVE')).toBe(true);
    });

    it('denies access for PAST_DUE (Req 3.8: grace period blocks publish)', () => {
      expect(isActive('PAST_DUE')).toBe(false);
    });

    it('denies access for EXPIRED (Req 3.8)', () => {
      expect(isActive('EXPIRED')).toBe(false);
    });

    it('denies access for CANCELED (Req 3.8)', () => {
      expect(isActive('CANCELED')).toBe(false);
    });
  });
});
