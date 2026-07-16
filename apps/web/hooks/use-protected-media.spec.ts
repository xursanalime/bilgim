import { act, renderHook, waitFor } from '@testing-library/react';

import {
  useProtectedMedia,
  ProtectedMediaFetchError,
} from './use-protected-media';
import type {
  MediaProtectionProvider,
  ProtectedPlaybackTicket,
} from '../lib/media/protection';

/**
 * Builds a ticket matching the task 1.1 contract shape. Cast through `unknown`
 * so the test does not break if 1.1's exact field types differ slightly.
 */
function makeTicket(
  overrides: Partial<Record<string, unknown>> = {},
): ProtectedPlaybackTicket {
  const base: Record<string, unknown> = {
    ticket: 'opaque-ticket-token',
    manifestRef: 'https://cdn.example/manifest.mpd',
    licenseEndpoints: { widevine: '/api/media/license' },
    watermark: { label: 'a***@mail', tag: 'wm-1' },
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

describe('useProtectedMedia', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('ticket success → ready and exposes the ticket', async () => {
    const ticket = makeTicket();
    const getPlaybackTicket = jest.fn(async () => ticket);
    const provider = makeProvider(getPlaybackTicket);

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.isReady).toBe(true);
    expect(result.current.ticket).toBe(ticket);
    expect(result.current.error).toBeNull();
    expect(getPlaybackTicket).toHaveBeenCalledWith({
      assetId: 'asset-1',
      lessonId: 'lesson-1',
    });
  });

  it('fetch failure → fail-closed error (no ticket)', async () => {
    const getPlaybackTicket = jest.fn(async () => {
      throw new ProtectedMediaFetchError('unauthorized', 'Denied');
    });
    const provider = makeProvider(getPlaybackTicket);

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.ticket).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.failClosed).toBe(true);
    expect(result.current.error?.code).toBe('unauthorized');
  });

  it('ticket without DRM key systems → fail-closed (drm-unavailable)', async () => {
    const ticket = makeTicket({ licenseEndpoints: {} });
    const provider = makeProvider(jest.fn(async () => ticket));

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.ticket).toBeNull();
    expect(result.current.error?.code).toBe('drm-unavailable');
    expect(result.current.error?.failClosed).toBe(true);
  });

  it('already-expired ticket → surfaces expired then re-fetches a fresh ticket', async () => {
    const expired = makeTicket({
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const fresh = makeTicket();
    const getPlaybackTicket = jest
      .fn<Promise<ProtectedPlaybackTicket>, []>()
      .mockResolvedValueOnce(expired)
      .mockResolvedValue(fresh);
    const provider = makeProvider(getPlaybackTicket);

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    // The expired ticket triggers an immediate silent re-auth, ending in ready.
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getPlaybackTicket).toHaveBeenCalledTimes(2);
    expect(result.current.ticket).toBe(fresh);
  });

  it('schedules a silent re-auth before expiry', async () => {
    jest.useFakeTimers();
    // expiry 100s out, skew 30s → refresh timer fires at ~70s.
    const first = makeTicket({
      expiresAt: new Date(Date.now() + 100_000).toISOString(),
    });
    const second = makeTicket({
      expiresAt: new Date(Date.now() + 200_000).toISOString(),
    });
    const getPlaybackTicket = jest
      .fn<Promise<ProtectedPlaybackTicket>, []>()
      .mockResolvedValueOnce(first)
      .mockResolvedValue(second);
    const provider = makeProvider(getPlaybackTicket);

    const { result } = renderHook(() =>
      useProtectedMedia({
        assetId: 'asset-1',
        lessonId: 'lesson-1',
        provider,
        refreshSkewSeconds: 30,
      }),
    );

    // Flush the initial async fetch under fake timers.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getPlaybackTicket).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(71_000);
      await Promise.resolve();
    });

    expect(getPlaybackTicket).toHaveBeenCalledTimes(2);
  });

  it('manual refetch requests a new ticket', async () => {
    const getPlaybackTicket = jest.fn(async () => makeTicket());
    const provider = makeProvider(getPlaybackTicket);

    const { result } = renderHook(() =>
      useProtectedMedia({ assetId: 'asset-1', lessonId: 'lesson-1', provider }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getPlaybackTicket).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(getPlaybackTicket).toHaveBeenCalledTimes(2));
  });
});
