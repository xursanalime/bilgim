/**
 * Playback_Ticket lifecycle / expiry / fail-closed UNIT tests (Req 1.1, 1.7).
 *
 * Complements the existing `mock-provider.test.ts` (which covers the happy-path
 * shape + a single malformed case). This file focuses on the EXPIRY edge cases
 * of `isTicketExpired` / `ticketTimeToLiveMs` (future / past / exact boundary /
 * malformed / empty) and on the fail-closed posture they encode: anything we
 * cannot positively prove is still-valid is treated as expired so the client
 * re-authorizes rather than playing on a stale grant (Req 1.2, 1.7).
 *
 * Pure helpers → no DOM needed; runs under the default jest environment.
 */
import {
  MockMediaProtectionProvider,
  isTicketExpired,
  ticketTimeToLiveMs,
  type ProtectedPlaybackTicket,
} from './index';

type ExpiryOnly = Pick<ProtectedPlaybackTicket, 'expiresAt'>;

const ticketExpiringAt = (iso: string): ExpiryOnly => ({ expiresAt: iso });

describe('isTicketExpired — expiry edge cases (fail closed)', () => {
  const now = 1_700_000_000_000; // fixed reference clock

  it('a future expiry is NOT expired', () => {
    const future = new Date(now + 60_000).toISOString();
    expect(isTicketExpired(ticketExpiringAt(future), now)).toBe(false);
  });

  it('a past expiry IS expired', () => {
    const past = new Date(now - 1).toISOString();
    expect(isTicketExpired(ticketExpiringAt(past), now)).toBe(true);
  });

  it('treats the exact expiry instant as expired (>= boundary, fail closed)', () => {
    const exact = new Date(now).toISOString();
    expect(isTicketExpired(ticketExpiringAt(exact), now)).toBe(true);
  });

  it('is NOT expired one millisecond before the boundary', () => {
    const justBefore = new Date(now + 1).toISOString();
    expect(isTicketExpired(ticketExpiringAt(justBefore), now)).toBe(false);
  });

  it('treats a malformed timestamp as expired', () => {
    expect(isTicketExpired(ticketExpiringAt('not-a-date'), now)).toBe(true);
  });

  it('treats an empty / whitespace timestamp as expired', () => {
    expect(isTicketExpired(ticketExpiringAt(''), now)).toBe(true);
    expect(isTicketExpired(ticketExpiringAt('   '), now)).toBe(true);
  });

  it('defaults `nowMs` to the wall clock when omitted', () => {
    const longPast = new Date(0).toISOString();
    const farFuture = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(isTicketExpired(ticketExpiringAt(longPast))).toBe(true);
    expect(isTicketExpired(ticketExpiringAt(farFuture))).toBe(false);
  });
});

describe('ticketTimeToLiveMs — clamping + malformed handling', () => {
  const now = 1_700_000_000_000;

  it('returns the exact remaining lifetime for a future expiry', () => {
    const future = new Date(now + 45_000).toISOString();
    expect(ticketTimeToLiveMs(ticketExpiringAt(future), now)).toBe(45_000);
  });

  it('clamps a past expiry to 0 (never negative)', () => {
    const past = new Date(now - 10_000).toISOString();
    expect(ticketTimeToLiveMs(ticketExpiringAt(past), now)).toBe(0);
  });

  it('returns 0 at the exact expiry instant', () => {
    const exact = new Date(now).toISOString();
    expect(ticketTimeToLiveMs(ticketExpiringAt(exact), now)).toBe(0);
  });

  it('returns 0 for a malformed timestamp (fail closed)', () => {
    expect(ticketTimeToLiveMs(ticketExpiringAt('garbage'), now)).toBe(0);
  });

  it('stays consistent with isTicketExpired across the boundary', () => {
    const ttlMs = 5_000;
    const t = ticketExpiringAt(new Date(now + ttlMs).toISOString());
    // Still alive just before expiry.
    expect(isTicketExpired(t, now + ttlMs - 1)).toBe(false);
    expect(ticketTimeToLiveMs(t, now + ttlMs - 1)).toBe(1);
    // Expired exactly at / after the boundary, TTL pinned at 0.
    expect(isTicketExpired(t, now + ttlMs)).toBe(true);
    expect(ticketTimeToLiveMs(t, now + ttlMs)).toBe(0);
  });
});

describe('mock provider ticket lifecycle (deterministic clock)', () => {
  it('issues a live ticket whose TTL counts down to expiry', async () => {
    const issuedAt = 1_700_000_000_000;
    const ttlSeconds = 120;
    let clock = issuedAt;
    const provider = new MockMediaProtectionProvider({
      ttlSeconds,
      now: () => clock,
    });

    const ticket = await provider.getPlaybackTicket({ assetId: 'asset-1' });

    // Fresh ticket: alive, full TTL remaining.
    expect(isTicketExpired(ticket, issuedAt)).toBe(false);
    expect(ticketTimeToLiveMs(ticket, issuedAt)).toBe(ttlSeconds * 1000);

    // Half-way: still alive, half the TTL remaining.
    const half = issuedAt + (ttlSeconds * 1000) / 2;
    expect(isTicketExpired(ticket, half)).toBe(false);
    expect(ticketTimeToLiveMs(ticket, half)).toBe((ttlSeconds * 1000) / 2);

    // At/after expiry: expired and TTL pinned to 0 (fail closed).
    const atExpiry = issuedAt + ttlSeconds * 1000;
    expect(isTicketExpired(ticket, atExpiry)).toBe(true);
    expect(ticketTimeToLiveMs(ticket, atExpiry)).toBe(0);
    expect(isTicketExpired(ticket, atExpiry + 60_000)).toBe(true);

    // Advancing the provider clock does not retroactively extend an
    // already-issued ticket (expiry is captured at issue time).
    clock = atExpiry + 1;
    expect(isTicketExpired(ticket, clock)).toBe(true);
  });
});
