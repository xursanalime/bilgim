'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LicenseRequest,
  MediaProtectionProvider,
  ProtectedPlaybackRequest,
  ProtectedPlaybackTicket,
} from '../lib/media/protection';

/**
 * useProtectedMedia — fetches a short-lived {@link ProtectedPlaybackTicket} for a
 * protected lesson asset and drives the protected-playback lifecycle.
 *
 * Design references:
 *  - frontend-redesign/design.md §3.2–§3.4 (provider-agnostic protection, fail-closed)
 *  - Requirements 1.1 (DRM-only playback), 1.2 (short-lived tokens + silent re-auth),
 *    1.7 (fail closed when DRM/ticket cannot be established).
 *
 * Responsibilities:
 *  - Resolve a ticket through an injected {@link MediaProtectionProvider} (defaulting
 *    to the real BFF-backed provider that calls `app/api/media/*`).
 *  - Track state across `loading | ready | error | expired`.
 *  - Silently re-authorize before the ticket expires (no long-lived URL is ever held).
 *  - **Fail closed**: if no ticket is issued or the ticket carries no DRM key systems,
 *    surface a fail-closed error. The hook never returns a usable ticket for
 *    unprotected playback.
 *
 * NOTE: The protection types are imported from `@/lib/media/protection` (task 1.1).
 * Those are type-only imports; the concrete default provider below is implemented
 * here against that interface so this hook does not depend on 1.1's runtime exports.
 */

export type ProtectedMediaStatus = 'loading' | 'ready' | 'error' | 'expired';

export type ProtectedMediaErrorCode =
  | 'no-ticket'
  | 'unauthorized'
  | 'drm-unavailable'
  | 'expired'
  | 'network'
  | 'unknown';

export interface ProtectedMediaError {
  code: ProtectedMediaErrorCode;
  message: string;
  /**
   * Always `true`. A protected-media error NEVER permits a fallback to
   * unprotected playback of protected content (Requirement 1.7).
   */
  failClosed: true;
  cause?: unknown;
}

export interface UseProtectedMediaParams {
  assetId: string;
  lessonId: string;
  /** Inject a provider (tests / alternate vendors). Defaults to the BFF provider. */
  provider?: MediaProtectionProvider;
  /** Seconds before `expiresAt` at which to silently re-authorize. Default 30. */
  refreshSkewSeconds?: number;
}

export interface UseProtectedMediaResult {
  status: ProtectedMediaStatus;
  ticket: ProtectedPlaybackTicket | null;
  error: ProtectedMediaError | null;
  /** Manually (re)request a fresh ticket. */
  refetch: () => void;
  isLoading: boolean;
  isReady: boolean;
}

/* -------------------------------------------------------------------------- */
/* Default BFF-backed provider                                                 */
/* -------------------------------------------------------------------------- */

/**
 * BFF endpoints (task 1.2 owns `app/api/media/*`). These defaults follow the
 * documented frontend contract; if 1.2 ships different route paths, override
 * them via {@link createBffProtectionProvider}.
 */
const DEFAULT_TICKET_ENDPOINT = '/api/media/playback-ticket';
const DEFAULT_LICENSE_ENDPOINT = '/api/media/license';

export interface BffProtectionProviderOptions {
  ticketEndpoint?: string;
  licenseEndpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * A {@link MediaProtectionProvider} that brokers everything through our own BFF
 * (`app/api/media/*`). The browser never talks to the DRM vendor directly and
 * never receives vendor keys or permanent media URLs (design §3.2/D3).
 */
export function createBffProtectionProvider(
  options: BffProtectionProviderOptions = {},
): MediaProtectionProvider {
  const ticketEndpoint = options.ticketEndpoint ?? DEFAULT_TICKET_ENDPOINT;
  const licenseEndpoint = options.licenseEndpoint ?? DEFAULT_LICENSE_ENDPOINT;
  const doFetch: typeof fetch =
    options.fetchImpl ??
    (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as never));

  const provider: MediaProtectionProvider = {
    async getPlaybackTicket(
      req: ProtectedPlaybackRequest,
    ): Promise<ProtectedPlaybackTicket> {
      const lessonQuery =
        req.lessonId !== undefined
          ? `&lessonId=${encodeURIComponent(req.lessonId)}`
          : '';
      const url =
        `${ticketEndpoint}?assetId=${encodeURIComponent(req.assetId)}` +
        lessonQuery;

      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
      } catch (cause) {
        throw new ProtectedMediaFetchError(
          'network',
          'Playback ticketini olishda tarmoq xatosi.',
          cause,
        );
      }

      if (!res.ok) {
        const code: ProtectedMediaErrorCode =
          res.status === 401 || res.status === 403 ? 'unauthorized' : 'network';
        throw new ProtectedMediaFetchError(
          code,
          `Playback ticket so'rovi muvaffaqiyatsiz (${res.status}).`,
        );
      }

      return (await res.json()) as ProtectedPlaybackTicket;
    },

    async requestLicense(input: LicenseRequest): Promise<ArrayBuffer> {
      // BFF license route: POST /api/media/license/<keySystem>?assetId=…,
      // with the opaque ticket relayed via the `x-playback-ticket` header and
      // the raw EME challenge as the octet-stream body (task 1.2 contract).
      const url =
        `${licenseEndpoint}/${encodeURIComponent(input.keySystem)}` +
        `?assetId=${encodeURIComponent(input.assetId)}`;

      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-playback-ticket': input.ticket,
          },
          body: input.challenge,
          cache: 'no-store',
        });
      } catch (cause) {
        throw new ProtectedMediaFetchError(
          'network',
          "Litsenziya so'rovida tarmoq xatosi.",
          cause,
        );
      }

      if (!res.ok) {
        const code: ProtectedMediaErrorCode =
          res.status === 401 || res.status === 403 ? 'unauthorized' : 'network';
        throw new ProtectedMediaFetchError(
          code,
          `Litsenziya so'rovi muvaffaqiyatsiz (${res.status}).`,
        );
      }

      return res.arrayBuffer();
    },
  };

  return provider;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class ProtectedMediaFetchError extends Error {
  readonly code: ProtectedMediaErrorCode;

  constructor(code: ProtectedMediaErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ProtectedMediaFetchError';
    this.code = code;
    if (cause !== undefined) {
      // Preserve the underlying cause without tripping exactOptionalPropertyTypes.
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function toProtectedMediaError(err: unknown): ProtectedMediaError {
  if (err instanceof ProtectedMediaFetchError) {
    return { code: err.code, message: err.message, failClosed: true, cause: err };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message, failClosed: true, cause: err };
  }
  return {
    code: 'unknown',
    message: 'Himoyalangan media yuklanmadi.',
    failClosed: true,
    cause: err,
  };
}

/**
 * Validate a ticket for fail-closed playback. Returns an error when the ticket
 * is missing required fields or carries no DRM key systems (Requirement 1.1/1.7).
 */
function validateTicket(
  ticket: ProtectedPlaybackTicket | null | undefined,
): ProtectedMediaError | null {
  if (!ticket) {
    return {
      code: 'no-ticket',
      message: 'Himoyalangan ijro uchun ruxsat berilmadi.',
      failClosed: true,
    };
  }
  if (!ticket.manifestRef) {
    return {
      code: 'no-ticket',
      message: 'Himoyalangan oqim manzili topilmadi.',
      failClosed: true,
    };
  }
  const endpoints = ticket.licenseEndpoints;
  const keySystemCount =
    endpoints && typeof endpoints === 'object' ? Object.keys(endpoints).length : 0;
  if (keySystemCount === 0) {
    return {
      code: 'drm-unavailable',
      message: 'DRM kalit tizimi mavjud emas — himoyalangan ijro imkonsiz.',
      failClosed: true,
    };
  }
  return null;
}

function ticketExpiryMs(ticket: ProtectedPlaybackTicket): number | null {
  const parsed = Date.parse(ticket.expiresAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

export function useProtectedMedia(
  params: UseProtectedMediaParams,
): UseProtectedMediaResult {
  const { assetId, lessonId, provider, refreshSkewSeconds = 30 } = params;

  const activeProvider = useMemo<MediaProtectionProvider>(
    () => provider ?? createBffProtectionProvider(),
    [provider],
  );

  const [status, setStatus] = useState<ProtectedMediaStatus>('loading');
  const [ticket, setTicket] = useState<ProtectedPlaybackTicket | null>(null);
  const [error, setError] = useState<ProtectedMediaError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };

    const scheduleRefresh = (issued: ProtectedPlaybackTicket) => {
      clearTimer();
      const expMs = ticketExpiryMs(issued);
      if (expMs === null) return;
      const now = Date.now();
      const skewMs = Math.max(0, refreshSkewSeconds) * 1000;

      // Already past the hard expiry: surface 'expired' and re-authorize.
      if (expMs - now <= 0) {
        setTicket(null);
        setStatus('expired');
        refetch();
        return;
      }

      // Within the refresh skew window: re-authorize now, silently.
      const delay = expMs - now - skewMs;
      if (delay <= 0) {
        refetch();
        return;
      }

      refreshTimer.current = setTimeout(() => {
        // Silent re-auth: keep the current ticket/status until the new one lands.
        refetch();
      }, delay);
    };

    const run = async () => {
      setStatus('loading');
      setError(null);
      try {
        const req: ProtectedPlaybackRequest = { assetId, lessonId };
        const issued = await activeProvider.getPlaybackTicket(req);
        if (cancelled) return;

        const invalid = validateTicket(issued);
        if (invalid) {
          setTicket(null);
          setError(invalid);
          setStatus('error');
          return;
        }

        setTicket(issued);
        setError(null);
        setStatus('ready');
        scheduleRefresh(issued);
      } catch (err) {
        if (cancelled) return;
        setTicket(null);
        setError(toProtectedMediaError(err));
        setStatus('error');
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [assetId, lessonId, activeProvider, refreshSkewSeconds, reloadToken, refetch]);

  return {
    status,
    ticket,
    error,
    refetch,
    isLoading: status === 'loading',
    isReady: status === 'ready',
  };
}
