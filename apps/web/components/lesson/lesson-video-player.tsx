'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Loader2,
  VideoOff,
  RotateCcw,
  Maximize,
  Minimize,
  Rewind,
  FastForward,
} from 'lucide-react';

import { studentApi } from '../../lib/api/student';
import { getCurrentUser } from '../../lib/auth';
import { WatermarkOverlay } from '../media/watermark-overlay';

/**
 * LessonVideoPlayer — on-demand lesson / recording playback.
 *
 * Streams the asset through the SAME-ORIGIN media proxy
 * (`/api/media/proxy?assetId=…`) so the DOM never receives a raw signed R2
 * URL and the `media-src 'self'` CSP is satisfied. The proxy rewrites HLS
 * manifests + serves variant playlists / segments through itself, and streams
 * progressive (non-HLS) sources verbatim — so a single `<video>`/hls.js source
 * pointed at the proxy works for both cases.
 *
 * Protection posture: short-lived server-signed bytes (entitlement enforced
 * upstream), `controlsList="nodownload noremoteplayback"`, no Picture-in-
 * Picture, context-menu suppressed, and a per-viewer forensic watermark
 * overlay. (This is the platform's available protection tier — full DRM/EME
 * playback lives in `ProtectedVideoPlayer` and requires shaka-player + a
 * packaged DRM manifest, which are not provisioned in this environment.)
 */
interface HlsLike {
  loadSource(src: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  destroy(): void;
}

interface LessonVideoPlayerProps {
  assetId: string;
  lessonId: string;
  poster?: string;
  className?: string;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'viewer';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}

export function LessonVideoPlayer({
  assetId,
  lessonId,
  poster,
  className,
}: LessonVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Resolve the playback descriptor (kind/type/status). We don't use the
  // signed `url` directly — playback always goes through the same-origin
  // proxy — but `type` tells us whether to drive hls.js (manifest) or set a
  // progressive `src` (original).
  const playbackQuery = useQuery({
    queryKey: ['media', 'playback', assetId],
    queryFn: () => studentApi.getMediaPlayback(assetId),
    retry: false,
  });

  const proxySrc = `/api/media/proxy?assetId=${encodeURIComponent(assetId)}`;
  const type = playbackQuery.data?.type;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !type) return;

    setFatal(null);
    let hls: HlsLike | null = null;
    let cancelled = false;

    const isHls = type === 'manifest' || type === 'variant';

    const setup = async () => {
      if (!isHls) {
        // Progressive source — proxy streams the bytes verbatim.
        video.src = proxySrc;
        return;
      }

      // HLS: Safari/iOS plays the (proxy-rewritten) manifest natively.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = proxySrc;
        return;
      }

      try {
        const mod = await import('hls.js');
        if (cancelled) return;
        const Hls = mod.default;
        if (Hls.isSupported()) {
          hls = new Hls() as unknown as HlsLike;
          hls.loadSource(proxySrc);
          hls.attachMedia(video);
          hls.on('hlsError', (...args: unknown[]) => {
            const data = args[1] as { fatal?: boolean } | undefined;
            if (data?.fatal) {
              setFatal("Videoni ijro etib bo'lmadi.");
            }
          });
        } else {
          video.src = proxySrc;
        }
      } catch {
        video.src = proxySrc;
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* noop */
      }
    };
  }, [type, proxySrc]);

  // Track native fullscreen state so the custom toggle button reflects reality
  // even when the user exits via Esc. The CONTAINER (not the bare <video>)
  // goes fullscreen, so the watermark overlay stays mounted on top of it.
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

  // Seek by a relative offset (seconds), clamped to [0, duration]. Used by the
  // skip buttons and the ArrowLeft/ArrowRight keyboard shortcuts.
  const SKIP_SECONDS = 5;
  const skip = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    const target = video.currentTime + deltaSeconds;
    video.currentTime = Math.max(0, Math.min(duration, target));
  };

  const onContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      skip(-SKIP_SECONDS);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      skip(SKIP_SECONDS);
    }
  };

  const user = getCurrentUser();
  // Prefer the 6-digit publicId; fall back to the masked email for tokens
  // minted before the publicId claim existed.
  const viewerId = user?.publicId
    ? `ID ${user.publicId}`
    : user?.email
      ? maskEmail(user.email)
      : null;
  const watermarkLabel = viewerId
    ? `${viewerId} • ${assetId.slice(0, 4)}`
    : 'bilgim';

  const isLoading = playbackQuery.isLoading;
  const isError = playbackQuery.isError || fatal !== null;
  const errorMessage =
    fatal ??
    "Videoni yuklab bo'lmadi. Yozuv hali tayyor bo'lmasligi yoki vaqtincha mavjud emasligi mumkin.";

  return (
    <div className={clsx('relative w-full', className)} data-content-protected="true">
      <div
        ref={containerRef}
        data-fs-container=""
        tabIndex={0}
        role="group"
        aria-label="Video pleyer — chap/o'ng strelka bilan 5 soniya orqaga/oldinga"
        onKeyDown={onContainerKeyDown}
        className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <video
          ref={videoRef}
          className={clsx('h-full w-full', (isLoading || isError) && 'invisible')}
          poster={poster}
          controls
          playsInline
          controlsList="nodownload noremoteplayback nofullscreen"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onError={() =>
            setFatal((prev) => prev ?? "Videoni ijro etib bo'lmadi.")
          }
          aria-label="Dars videosi"
        />

        {!isLoading && !isError ? (
          <WatermarkOverlay
            label={watermarkLabel}
            protectionNotice="Himoyalangan kontent — yozib olish va tarqatish kuzatiladi."
          />
        ) : null}

        {/* Custom fullscreen toggle — the native control is suppressed
            (controlsList="nofullscreen") so users can't fullscreen just the
            <video> and escape the watermark. This fullscreens the CONTAINER,
            keeping the overlay on top. zIndex sits above the video but below
            the watermark (zIndex 30); the overlay has pointerEvents:none so it
            never blocks this button. */}
        {!isLoading && !isError ? (
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

        {/* Skip back / forward 5s — overlay controls placed ABOVE the native
            controls bar (bottom-14) so they don't overlap it. Subtle &
            semi-transparent; revealed on hover/focus. Sit above the video
            (z-20) but below the watermark (z-30, pointerEvents:none). */}
        {!isLoading && !isError ? (
          <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => skip(-5)}
              aria-label="5 soniya orqaga"
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white outline-none backdrop-blur transition-colors hover:bg-black/75 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <Rewind className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => skip(5)}
              aria-label="5 soniya oldinga"
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white outline-none backdrop-blur transition-colors hover:bg-black/75 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <FastForward className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-5 w-5 animate-spin text-white/80" />
            <span className="text-sm font-medium text-white/90">
              Video yuklanmoqda…
            </span>
          </div>
        ) : null}

        {isError ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center"
            role="alert"
          >
            <VideoOff className="h-9 w-9 text-white/70" aria-hidden="true" />
            <p className="max-w-md text-sm font-semibold text-white">
              Video hozircha mavjud emas
            </p>
            <p className="max-w-md text-xs leading-relaxed text-white/70">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                setFatal(null);
                void playbackQuery.refetch();
              }}
              className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Qayta urinish
            </button>
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-center text-[11px] text-ink-faint">
        Himoyalangan kontent — yozib olish va tarqatish taqiqlanadi va suvli
        belgi orqali kuzatiladi.
      </p>

      {/* When the CONTAINER (not the <video>) is fullscreen, center the video
          and let the absolutely-positioned WatermarkOverlay (inset-0) cover it.
          Scoped to this component via styled-jsx. */}
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
