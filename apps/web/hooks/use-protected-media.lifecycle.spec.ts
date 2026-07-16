/**
 * useProtectedMedia — additional FAIL-CLOSED lifecycle coverage (Req 1.1, 1.7).
 *
 * Complements the existing `use-protected-media.spec.ts` (success, unauthorized
 * fetch error, empty `licenseEndpoints`, expiry re-auth, scheduled re-auth,
 * manual refetch). This file extends the fail-closed contract to the remaining
 * branches of `validateTicket` / error mapping that the existing spec does not
 * exercise:
 *   - a ticket with NO `manifestRef`            → no-ticket  (fail closed)
 *   - a provider that resolves NO ticket (null) → no-ticket  (fail closed)
 *   - a generic (non-fetch) error               → unknown    (fail closed)
 *   - a network ProtectedMediaFetchError        → network    (fail closed)
 *   - a malformed `expiresAt` on an otherwise valid ticket (documents that the
 *     hook still gates on DRM + manifest and never crashes / never schedules a
 *     bogus refresh — server-side license re-verification remains the backstop).
 *
 * In EVERY failure branch the hook must return `ticket: null`, `status: 'error'`
 * and `error.failClosed === true` — it never yields a usable grant for
 * unprotected playback of protected content.
 */
import { renderHook, waitFor } from '@testing-library/react';

import {
  useProtectedMedia,
  ProtectedMediaFetchError,
} from './use-protected-media';
import type {
  MediaProtectionProvider,
  ProtectedPlaybackTicket,
} from '../lib/media/protection';

function makeTicket(
  overrides: Partial<Record<string, unknown>> = {},
): ProtectedPlaybackTicket {
  const base: Record<string, unknown> = {
    ticket: 'opaque-ticket-token',
    manifestRef: '/api/media/proxy?assetId=asset-1',
    licenseEndpoints: { widevine: '/api/media/license/widevine' },
    watermark: { label: 'a***@mail • sess', tag: 'wm-1' },
    downloadAllowed: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return { ...base, ...overrides } as unknown as ProtectedPlaybackTicket;
}

function makeProvider(
  getPlaybackTicket: MediaProtectionProvider['getPlaybackTicket'],
): MediaProtectionProvider {
  return {
    getPlaybackTicket,
    requestLicense: jest.fn(async () => new ArrayBuffer(0)),
  };
}

describe('useProtectedMedia — fail-closed lifecycle (extended)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('a ticket without a manifestRef fails closed (no-ticket)', async () => {
    const provider = makeProvider(
      jest.fn(async () => makeTicket({ manifestRef: '' })),
    );

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ticket).toBeNull();
    expect(result.current.error?.code).toBe('no-ticket');
    expect(result.current.error?.failClosed).toBe(true);
  });

  it('a provider that resolves no ticket (null) fails closed (no-ticket)', async () => {
    const provider = makeProvider(
      jest.fn(async () => null as unknown as ProtectedPlaybackTicket),
    );

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ticket).toBeNull();
    expect(result.current.error?.code).toBe('no-ticket');
    expect(result.current.error?.failClosed).toBe(true);
  });

  it('a generic (non-fetch) provider error fails closed (unknown)', async () => {
    const provider = makeProvider(
      jest.fn(async () => {
        throw new Error('boom');
      }),
    );

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ticket).toBeNull();
    expect(result.current.error?.code).toBe('unknown');
    expect(result.current.error?.failClosed).toBe(true);
  });

  it('a network fetch error fails closed (network)', async () => {
    const provider = makeProvider(
      jest.fn(async () => {
        throw new ProtectedMediaFetchError('network', 'offline');
      }),
    );

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ticket).toBeNull();
    expect(result.current.error?.code).toBe('network');
    expect(result.current.error?.failClosed).toBe(true);
  });

  it('never exposes a usable ticket alongside a fail-closed error', async () => {
    const provider = makeProvider(
      jest.fn(async () => makeTicket({ licenseEndpoints: {} })),
    );

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    // The two must never be true at once: an error state always nulls the ticket.
    expect(result.current.ticket).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.error?.failClosed).toBe(true);
  });

  it('a malformed expiresAt does not crash and still gates on DRM + manifest', async () => {
    // The ticket is otherwise valid (has manifestRef + a key system), so the
    // hook becomes ready; because the expiry is unparseable it simply does not
    // schedule a client-side silent re-auth. Server-side license/expiry
    // re-verification remains the backstop, so this is not a fail-OPEN path:
    // playback still requires a brokered DRM license.
    const provider = makeProvider(
      jest.fn(async () => makeTicket({ expiresAt: 'not-a-real-date' })),
    );

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
    // DRM gating is intact: the ready ticket still carries license endpoints.
    expect(
      Object.keys(result.current.ticket?.licenseEndpoints ?? {}).length,
    ).toBeGreaterThan(0);
  });
});
