'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Maximize, Minimize } from 'lucide-react';

import type { MediaProtectionProvider } from '../../lib/media/protection';
import { useProtectedMedia } from '../../hooks/use-protected-media';
import { WatermarkOverlay } from './watermark-overlay';

/**
 * ProtectedVideoPlayer — DRM-capable lesson player (design §3.4).
 *
 * Engine strategy (design D2):
 *  - Protected content plays through **Shaka Player** (Widevine / PlayReady via EME)
 *    with a **FairPlay** code path for Safari/iOS. The license request is pointed at
 *    the BFF license endpoint carried on the playback ticket.
 *  - **hls.js is used ONLY for explicitly non-DRM public previews** (`variant="public-preview"`).
 *
 * FAIL CLOSED (Requirement 1.7): if EME is unavailable, Shaka cannot load (e.g. the
 * `shaka-player` dependency is not installed), the browser is unsupported, or DRM/license
 * init fails, the player renders a clear "protected playback unavailable" state and NEVER
 * falls back to unprotected playback of protected content.
 *
 * Accessibility (Requirement 19): native `<video controls>` (keyboard + screen-reader
 * friendly); the watermark overlay (task 1.4) respects `prefers-reduced-motion`.
 */

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

interface ProtectedVariantProps {
  variant?: 'protected';
  assetId: string;
  lessonId: string;
  /** Inject a protection provider (defaults to the BFF-backed provider). */
  provider?: MediaProtectionProvider;
  poster?: string;
  className?: string;
  /**
   * Optional override for the forensic watermark layer. When omitted, the
   * built-in `<WatermarkOverlay>` (task 1.4) is rendered from the playback
   * ticket's `watermark.label`. Pass a custom node to fully control it.
   */
  watermarkSlot?: ReactNode;
  /**
   * Prefer hardware-backed DRM so capture attempts yield a black frame on
   * supporting platforms (Requirement 1.5). Default true.
   */
  preferHardwareDrm?: boolean;
}

interface PublicPreviewVariantProps {
  variant: 'public-preview';
  /** Non-DRM, genuinely public preview source (HLS manifest or progressive URL). */
  previewSrc: string;
  poster?: string;
  className?: string;
}

export type ProtectedVideoPlayerProps =
  | ProtectedVariantProps
  | PublicPreviewVariantProps;

export function ProtectedVideoPlayer(props: ProtectedVideoPlayerProps): JSX.Element {
  if (props.variant === 'public-preview') {
    return (
      <PublicPreviewPlayer
        previewSrc={props.previewSrc}
        {...(props.poster !== undefined ? { poster: props.poster } : {})}
        {...(props.className !== undefined ? { className: props.className } : {})}
      />
    );
  }
  return <ProtectedPlayer {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Protected (DRM) player                                                      */
/* -------------------------------------------------------------------------- */

type DrmState = 'idle' | 'initializing' | 'ready' | 'failed';

function ProtectedPlayer(props: ProtectedVariantProps): JSX.Element {
  const {
    assetId,
    lessonId,
    provider,
    poster,
    className,
    watermarkSlot,
    preferHardwareDrm = true,
  } = props;

  const media = useProtectedMedia({
    assetId,
    lessonId,
    ...(provider ? { provider } : {}),
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ShakaPlayerInstance | null>(null);
  const [drmState, setDrmState] = useState<DrmState>('idle');
  const [drmMessage, setDrmMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const ticket = media.ticket;
  const watermarkLabel = ticket?.watermark?.label;

  useEffect(() => {
    if (media.status !== 'ready' || !ticket) {
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;

    const failClosed = (message: string) => {
      if (destroyed) return;
      setDrmState('failed');
      setDrmMessage(message);
      // Guarantee we never expose an unprotected source.
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* noop */
      }
      const existing = playerRef.current;
      playerRef.current = null;
      if (existing) void existing.destroy().catch(() => undefined);
    };

    const init = async () => {
      setDrmState('initializing');
      setDrmMessage(null);

      // 1) EME / FairPlay capability gate.
      if (!hasEmeSupport() && !hasFairPlaySupport()) {
        failClosed(
          'Bu brauzer himoyalangan ijroni (DRM) qo\'llab-quvvatlamaydi. ' +
            'Iltimos, qo\'llab-quvvatlanadigan brauzer yoki mobil ilovadan foydalaning.',
        );
        return;
      }

      // 2) Load the Shaka engine via a graceful dynamic-import wrapper. If the
      //    dependency is absent or fails to load, fail closed (do NOT fall back).
      const shaka = await loadShaka();
      if (destroyed) return;
      if (!shaka || !shaka.Player) {
        failClosed(
          'Himoyalangan ijro dvigatelini yuklab bo\'lmadi. Iltimos, mobil ilovadan foydalaning.',
        );
        return;
      }

      try {
        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported()) {
          failClosed(
            'Bu brauzer himoyalangan ijroni qo\'llab-quvvatlamaydi. ' +
              'Qo\'llab-quvvatlanadigan brauzer yoki mobil ilovadan foydalaning.',
          );
          return;
        }

        const player = new shaka.Player();
        await player.attach(video);
        if (destroyed) {
          void player.destroy().catch(() => undefined);
          return;
        }
        playerRef.current = player;

        // FairPlay (Safari/iOS) shares Shaka's modern EME path; the
        // `com.apple.fps` license endpoint is taken from the ticket below.
        player.configure(buildShakaConfig(ticket, preferHardwareDrm));

        // Wire Shaka's license requests at the BFF and attach the playback ticket
        // so the BFF can authorize per-viewer (design §3.3).
        const net = player.getNetworkingEngine();
        if (net) {
          const licenseType = shaka.net.NetworkingEngine.RequestType.LICENSE;
          net.registerRequestFilter((type, request) => {
            if (type === licenseType) {
              request.headers['X-Playback-Ticket'] = ticket.ticket;
              request.headers['X-Asset-Id'] = assetId;
            }
          });
        }

        player.addEventListener('error', () => {
          failClosed(
            'Himoyalangan ijroda xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
          );
        });

        await player.load(ticket.manifestRef);
        if (destroyed) return;
        setDrmState('ready');
      } catch {
        failClosed(
          'Himoyalangan ijroni boshlab bo\'lmadi. ' +
            'Qo\'llab-quvvatlanadigan brauzer yoki mobil ilovadan foydalaning.',
        );
      }
    };

    void init();

    return () => {
      destroyed = true;
      const existing = playerRef.current;
      playerRef.current = null;
      if (existing) void existing.destroy().catch(() => undefined);
    };
    // assetId/ticket identity changes (incl. silent re-auth) re-init the engine.
  }, [media.status, ticket, assetId, preferHardwareDrm]);

  // Track native fullscreen on the CONTAINER (not the bare <video>) so the
  // forensic watermark overlay stays mounted on top in fullscreen.
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void containerRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  // Aggregate the fail-closed condition: a ticket/DRM error from the hook OR a
  // DRM init failure here. Either way we refuse unprotected playback.
  const hookFailed = media.status === 'error' && media.error !== null;
  const isFailClosed = hookFailed || drmState === 'failed';
  const isBusy =
    media.status === 'loading' ||
    media.status === 'expired' ||
    (media.status === 'ready' && drmState !== 'ready' && !isFailClosed);

  return (
    <div
      className={clsx('relative w-full', className)}
      data-content-protected="true"
    >
      <div
        ref={containerRef}
        data-fs-container=""
        className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-black"
      >
        <video
          ref={videoRef}
          className="h-full w-full"
          poster={poster}
          controls
          playsInline
          // Requirement 1.4: no native download / remote-playback affordances.
          // `nofullscreen` suppresses the native fullscreen control so users
          // can't fullscreen just the <video> and escape the watermark.
          controlsList="nodownload noremoteplayback nofullscreen"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Himoyalangan dars videosi"
        />

        {/* Forensic watermark — rendered ABOVE the video (Requirement 3). */}
        {drmState === 'ready' && !isFailClosed
          ? watermarkSlot ??
            (watermarkLabel ? (
              <WatermarkOverlay
                label={watermarkLabel}
                protectionNotice="Himoyalangan kontent — yozib olish va tarqatish kuzatiladi."
              />
            ) : null)
          : null}

        {/* Custom fullscreen toggle — fullscreens the CONTAINER (keeping the
            watermark overlay on top). zIndex above the video but below the
            overlay (zIndex 30), which has pointerEvents:none so it never
            blocks this button. */}
        {drmState === 'ready' && !isFailClosed ? (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "To'liq ekrandan chiqish" : "To'liq ekran"}
            className="absolute bottom-3 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-black/55 text-white outline-none backdrop-blur transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : null}

        {isBusy && !isFailClosed ? <LoadingOverlay /> : null}

        {isFailClosed ? (
          <FailClosedNotice
            message={
              drmMessage ??
              media.error?.message ??
              'Himoyalangan ijro hozircha mavjud emas.'
            }
            onRetry={media.refetch}
          />
        ) : null}
      </div>

      <ProtectionFootnote />

      {/* When the CONTAINER is fullscreen, center the video and let the
          absolutely-positioned WatermarkOverlay (inset-0) cover it. */}
      <style jsx>{`
        [data-fs-container]:fullscreen {
          display: flex;
          align-items: center;
          justify-content: center;
          background: black;
          width: 100%;
          height: 100%;
        }
        [data-fs-container]:fullscreen video {
          max-height: 100%;
          width: 100%;
          object-fit: contain;
        }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Public, non-DRM preview player (hls.js)                                     */
/* -------------------------------------------------------------------------- */

function PublicPreviewPlayer({
  previewSrc,
  poster,
  className,
}: {
  previewSrc: string;
  poster?: string;
  className?: string;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: HlsInstance | null = null;

    const setup = async () => {
      // Native HLS (Safari / iOS) — no extra library needed.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = previewSrc;
        return;
      }
      try {
        const mod = await import('hls.js');
        if (cancelled) return;
        const Hls = mod.default;
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(previewSrc);
          hls.attachMedia(video);
        } else {
          video.src = previewSrc;
        }
      } catch {
        // Last resort for progressive sources; this branch is for PUBLIC,
        // non-DRM content only and is never reached for protected content.
        video.src = previewSrc;
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
    };
  }, [previewSrc]);

  return (
    <div className={clsx('relative w-full', className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          className="h-full w-full"
          poster={poster}
          controls
          playsInline
          controlsList="nodownload"
          aria-label="Ommaviy ko'rib chiqish videosi"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Presentational helpers                                                      */
/* -------------------------------------------------------------------------- */

function LoadingOverlay(): JSX.Element {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/60"
      role="status"
      aria-live="polite"
    >
      <span className="text-sm font-medium text-white/90">
        Himoyalangan ijro tayyorlanmoqda…
      </span>
    </div>
  );
}

function FailClosedNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center"
      role="alert"
    >
      <p className="max-w-md text-sm font-semibold text-white">
        Himoyalangan ijro hozircha mavjud emas
      </p>
      <p className="max-w-md text-xs leading-relaxed text-white/70">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20"
      >
        Qayta urinish
      </button>
    </div>
  );
}

function ProtectionFootnote(): JSX.Element {
  return (
    <p className="mt-2 text-center text-[11px] text-white/50">
      Himoyalangan kontent — yozib olish va tarqatish taqiqlanadi va suvli belgi
      orqali kuzatiladi.
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Capability detection                                                        */
/* -------------------------------------------------------------------------- */

function hasEmeSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.requestMediaKeySystemAccess === 'function'
  );
}

function hasFairPlaySupport(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { WebKitMediaKeys?: unknown };
  if (typeof w.WebKitMediaKeys !== 'undefined') return true;
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    'webkitGenerateRequest' in HTMLMediaElement.prototype
  );
}

/* -------------------------------------------------------------------------- */
/* Shaka config + key-system mapping                                           */
/* -------------------------------------------------------------------------- */

/**
 * Map a ticket key-system identifier (friendly or full EME id) to Shaka's
 * key-system name. Tolerant of either naming so it aligns with whatever the
 * task 1.1 key-system union ends up using.
 */
const KEY_SYSTEM_TO_SHAKA: Record<string, string> = {
  widevine: 'com.widevine.alpha',
  'com.widevine.alpha': 'com.widevine.alpha',
  playready: 'com.microsoft.playready',
  'com.microsoft.playready': 'com.microsoft.playready',
  fairplay: 'com.apple.fps',
  'com.apple.fps': 'com.apple.fps',
  'com.apple.fps.1_0': 'com.apple.fps',
};

interface ShakaTicketLike {
  ticket: string;
  manifestRef: string;
  licenseEndpoints: Record<string, string>;
}

function buildShakaConfig(
  ticket: ShakaTicketLike,
  preferHardwareDrm: boolean,
): Record<string, unknown> {
  const servers: Record<string, string> = {};
  for (const [keySystem, endpoint] of Object.entries(ticket.licenseEndpoints)) {
    if (!endpoint) continue;
    const shakaKey = KEY_SYSTEM_TO_SHAKA[keySystem] ?? keySystem;
    servers[shakaKey] = endpoint;
  }

  const advanced: Record<string, Record<string, string>> = {};
  if (preferHardwareDrm) {
    // Requirement 1.5: prefer hardware security level where supported so capture
    // attempts produce a black frame on supporting platforms.
    advanced['com.widevine.alpha'] = {
      videoRobustness: 'HW_SECURE_ALL',
      audioRobustness: 'HW_SECURE_CRYPTO',
    };
    advanced['com.microsoft.playready'] = {
      videoRobustness: '3000',
      audioRobustness: '3000',
    };
  }

  return {
    drm: {
      servers,
      advanced,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Shaka dynamic-import wrapper (degrades gracefully; fails closed)            */
/* -------------------------------------------------------------------------- */

interface ShakaRequestLike {
  uris: string[];
  headers: Record<string, string>;
}

interface ShakaNetworkingEngine {
  registerRequestFilter(
    filter: (type: number, request: ShakaRequestLike) => void,
  ): void;
}

interface ShakaPlayerInstance {
  attach(media: HTMLMediaElement): Promise<void>;
  configure(config: Record<string, unknown>): boolean;
  load(uri: string): Promise<void>;
  destroy(): Promise<void>;
  getNetworkingEngine(): ShakaNetworkingEngine | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

interface ShakaPlayerCtor {
  new (): ShakaPlayerInstance;
  isBrowserSupported(): boolean;
}

interface ShakaModule {
  Player: ShakaPlayerCtor;
  polyfill: { installAll(): void };
  net: { NetworkingEngine: { RequestType: { LICENSE: number } } };
}

interface HlsInstance {
  loadSource(src: string): void;
  attachMedia(media: HTMLMediaElement): void;
  destroy(): void;
}

let shakaModulePromise: Promise<ShakaModule | null> | null = null;

/**
 * Load Shaka Player on demand.
 *
 * `shaka-player` is treated as an OPTIONAL dependency (it is not currently
 * installed in `apps/web`). The specifier is hidden from the bundler so its
 * absence never hard-fails the build; if it cannot be loaded at runtime this
 * resolves to `null` and the player fails closed.
 *
 * Once `shaka-player` is added as a dependency, this can be replaced with a
 * statically-analyzable `await import('shaka-player')`.
 */
async function loadShaka(): Promise<ShakaModule | null> {
  if (typeof window === 'undefined') return null;
  if (!shakaModulePromise) {
    shakaModulePromise = (async () => {
      try {
        // `webpackIgnore` tells webpack to leave this import as a literal
        // runtime `import()` instead of trying to statically resolve/bundle
        // the (currently uninstalled) module — same "optional dependency"
        // effect as the old `new Function('specifier', 'return
        // import(specifier)')` trick, without needing CSP `unsafe-eval`.
        const mod = (await import(
          /* webpackIgnore: true */ 'shaka-player'
        )) as { default?: ShakaModule } | ShakaModule;
        const shaka =
          (mod as { default?: ShakaModule }).default ?? (mod as ShakaModule);
        if (!shaka || !shaka.Player) return null;
        return shaka;
      } catch {
        return null;
      }
    })();
  }
  return shakaModulePromise;
}
