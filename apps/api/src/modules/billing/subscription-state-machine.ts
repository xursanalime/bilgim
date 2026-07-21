import { SubscriptionStatus } from '@prisma/client';

/**
 * Subscription state machine — pure functions, no DI, no I/O.
 *
 * Encodes the lifecycle defined by Requirement 3.1:
 *
 *     TRIAL ──────► ACTIVE ──────► PAST_DUE
 *       │            │  ▲             │
 *       │            │  └─────────────┤
 *       │            │                │
 *       ▼            ▼                ▼
 *     EXPIRED     CANCELED         EXPIRED / CANCELED
 *
 * Transitions:
 *   - TRIAL    → ACTIVE   (payment succeeded; Req 3.4)
 *   - TRIAL    → EXPIRED  (trial period ended; Req 3.3)
 *   - TRIAL    → CANCELED (user cancels)
 *   - ACTIVE   → PAST_DUE (payment failed at period end; Req 3.5)
 *   - ACTIVE   → CANCELED (user cancels)
 *   - PAST_DUE → ACTIVE   (payment succeeded; Req 3.5)
 *   - PAST_DUE → EXPIRED  (7 days unpaid; Req 3.6)
 *   - PAST_DUE → CANCELED (user cancels)
 *   - EXPIRED, CANCELED → terminal (no outgoing transitions)
 *
 * The DB partial unique index `subscriptions_teacher_active_uniq` (Req 3.7)
 * ensures at most one row in {TRIAL, ACTIVE, PAST_DUE} per teacher; this
 * module encodes the *transition* rules layered on top of that invariant.
 *
 * Catalog publish gating (Req 3.8) uses `isActive(status)` — only TRIAL or
 * ACTIVE grants publish access.
 */

const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, ReadonlyArray<SubscriptionStatus>>
> = Object.freeze({
  TRIAL: Object.freeze(['ACTIVE', 'EXPIRED', 'CANCELED'] as SubscriptionStatus[]),
  ACTIVE: Object.freeze(['PAST_DUE', 'CANCELED'] as SubscriptionStatus[]),
  PAST_DUE: Object.freeze(['ACTIVE', 'EXPIRED', 'CANCELED'] as SubscriptionStatus[]),
  EXPIRED: Object.freeze([] as SubscriptionStatus[]),
  CANCELED: Object.freeze([] as SubscriptionStatus[]),
}) as Readonly<Record<SubscriptionStatus, ReadonlyArray<SubscriptionStatus>>>;

/** Terminal states have no outgoing transitions. */
const TERMINAL_STATES: ReadonlySet<SubscriptionStatus> = new Set(['EXPIRED', 'CANCELED']);

/**
 * "Active" for access-control purposes: the teacher currently has platform
 * access. Distinct from `SubscriptionStatus.ACTIVE` — TRIAL also grants access.
 * Used by Req 3.8 (publish gating) and Req 6.x (lesson access) callers.
 */
const ACCESS_GRANTING_STATES: ReadonlySet<SubscriptionStatus> = new Set([
  'TRIAL',
  'ACTIVE',
]);

/**
 * Returns true if the (from → to) transition is allowed by the state machine.
 * Always returns false for self-loops (e.g. ACTIVE → ACTIVE) and for any
 * outgoing transition from a terminal state.
 */
export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Returns the set of valid next states for a given current state. Returns an
 * empty array for terminal states. The returned array is a fresh copy — safe
 * to mutate.
 */
export function nextValidStates(
  from: SubscriptionStatus,
): SubscriptionStatus[] {
  const allowed = TRANSITIONS[from];
  return allowed ? [...allowed] : [];
}

/**
 * Returns true if the status is terminal (EXPIRED or CANCELED). Terminal
 * subscriptions never transition to another state — a new subscription row
 * must be created if the teacher re-subscribes.
 */
export function isTerminal(status: SubscriptionStatus): boolean {
  return TERMINAL_STATES.has(status);
}

/**
 * Returns true if the subscription grants the teacher platform access right
 * now. Per Req 3.8 only TRIAL or ACTIVE qualify; PAST_DUE is in grace but
 * publish should be blocked, EXPIRED/CANCELED are terminal.
 *
 * Callers (Catalog publish guard, etc.) should use this rather than checking
 * `status === 'ACTIVE'` directly so trial users keep their access.
 */
export function isActive(status: SubscriptionStatus): boolean {
  return ACCESS_GRANTING_STATES.has(status);
}
