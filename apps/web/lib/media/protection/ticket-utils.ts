/**
 * Pure helpers for the Playback_Ticket lifecycle. Kept side-effect-free so the
 * player / `useProtectedMedia` hook (task 1.3) can drive silent re-auth before
 * expiry (Req 1.2) and tests can reason about ticket validity deterministically.
 */

import type { ProtectedPlaybackTicket } from './types';

/**
 * Whether `ticket` is expired (or has an unparseable `expiresAt`) relative to
 * `nowMs` (defaults to the current time). A malformed timestamp is treated as
 * expired so the client fails closed and re-authorizes (Req 1.2, 1.7).
 */
export function isTicketExpired(
  ticket: Pick<ProtectedPlaybackTicket, 'expiresAt'>,
  nowMs: number = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(ticket.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }
  return nowMs >= expiresAtMs;
}

/**
 * Milliseconds until `ticket` expires (clamped at 0). Useful for scheduling a
 * silent re-authorization slightly ahead of expiry. Returns 0 for an expired
 * or malformed ticket.
 */
export function ticketTimeToLiveMs(
  ticket: Pick<ProtectedPlaybackTicket, 'expiresAt'>,
  nowMs: number = Date.now(),
): number {
  const expiresAtMs = Date.parse(ticket.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return 0;
  }
  return Math.max(0, expiresAtMs - nowMs);
}
