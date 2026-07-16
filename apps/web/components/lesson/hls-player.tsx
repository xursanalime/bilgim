'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Maximize, Minimize } from 'lucide-react';
import { UserWatermark } from './user-watermark';
import { useContentProtection } from '../../hooks/use-content-protection';
import { useScreenCaptureDetection } from '../../hooks/use-screen-capture-detection';

interface HlsPlayerProps {
  /**
   * assetId berilsa — video `/api/media/proxy` orqali oqimlanadi.
   * Haqiqiy R2 URL brauzerda ko'rinmaydi.
   *
   * Eski `src` + `type` API ham qo'llab-quvvatlanadi (chat video kabi holatlar uchun).
   */
  assetId?: string;
  src?: string;
  type?: 'manifest' | 'variant' | 'original';
  poster?: string;
  className?: string;
}

export function HlsPlayer({
  assetId,
  src: srcProp,
  type: typeProp,
  poster,
  className = '',
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [resolvedType, setResolvedType] = useState<'manifest' | 'variant' | 'original'>('original');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useContentProtection();
  const { isCapturing, isHidden } = useScreenCaptureDetection();

  // assetId orqali proxy dan URL olish
  useEffect(() => {
    if (assetId) {
      fetch(`/api/media/proxy?assetId=${encodeURIComponent(assetId)}`, {
        credentials: 'include',
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`proxy ${res.status}`);
          // Proxy manifest bo'lsa — blob URL yoki to'g'ridan-to'g'ri URL qaytaradi
          // Biz proxy URL ni to'g'ridan ishlatamiz (brauzer hls.js uchun fetch qiladi)
          // Proxy orqali redirect emas — manifest content stream qilindi.
          // Shuning uchun manifest blob URL yaratamiz:
          const text = await res.text();
          const blob = new Blob([text], { type: 'application/vnd.apple.mpegurl' });
          const blobUrl = URL.createObjectURL(blob);
          setResolvedSrc(blobUrl);
          setResolvedType('manifest');
        })
        .catch(() => {
          setError("Video yuklanmadi.");
        });
    } else if (srcProp) {
      setResolvedSrc(srcProp);
      setResolvedType(typeProp ?? 'original');
    }
  }, [assetId, srcProp, typeProp]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedSrc) return undefined;
    setError(null);

    if (resolvedType !== 'manifest') {
      video.src = resolvedSrc;
      return undefined;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = resolvedSrc;
      return undefined;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(resolvedSrc);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError("Video oqimini yuklab bo'lmadi. Iltimos, sahifani qaytadan yuklang.");
        }
      });
      return () => {
        hls.destroy();
        // Blob URL ni tozalash
        if (resolvedSrc.startsWith('blob:')) URL.revokeObjectURL(resolvedSrc);
      };
    }

    setError("Brauzeringiz HLS oqimini qo'llab-quvvatlamaydi.");
    return undefined;
  }, [resolvedSrc, resolvedType]);

  // Track native fullscreen state so the custom toggle button reflects reality
  // even when the user exits via Esc. The CONTAINER (not the bare <video>)
  // goes fullscreen, so the UserWatermark overlay stays mounted on top of it.
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

  return (
    <div
      ref={containerRef}
      data-fs-container=""
      className={`group relative overflow-hidden rounded-2xl bg-black ${className}`}
    >
      {(isCapturing || isHidden) && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black"
          aria-live="assertive"
        >
          <svg className="mb-4 h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-center text-sm font-bold text-white">
            {isCapturing
              ? "Ekranni yozib olish aniqlandi — video to'xtatildi."
              : 'Oyna faol emas — kontent himoyalangan.'}
          </p>
        </div>
      )}

      <video
        ref={videoRef}
        controls
        playsInline
        disablePictureInPicture
        controlsList="nodownload nofullscreen noremoteplayback"
        poster={poster}
        onContextMenu={(e) => e.preventDefault()}
        className="aspect-video w-full"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        aria-label="Video"
      >
        <track kind="captions" />
      </video>

      <UserWatermark />

      {/* Custom fullscreen toggle — the native control is suppressed
          (controlsList="nofullscreen") so users can't fullscreen just the
          <video> and escape the watermark. This fullscreens the CONTAINER,
          keeping the UserWatermark overlay (zIndex 10) on top. */}
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

      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-red-500/80 px-4 py-2 text-center text-xs font-semibold text-white">
          {error}
        </div>
      )}

      {/* When the CONTAINER (not the <video>) is fullscreen, center the video
          and let the absolutely-positioned UserWatermark cover it. Scoped to
          this component via styled-jsx. */}
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
