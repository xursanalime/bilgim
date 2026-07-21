'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface HlsPlayerProps {
  /**
   * Signed playback URL. For HLS-ready video this points at the master
   * `.m3u8`; for non-HLS video (or pre-transcoding fallback) it can
   * point at the signed original source.
   */
  src: string;
  /** Render type so we can pick the right loader path. */
  type: 'manifest' | 'variant' | 'original';
  poster?: string;
  className?: string;
}

/**
 * HLS-aware `<video>` wrapper.
 *
 * Strategy:
 *  - Safari (and iOS) play HLS natively — set `video.src = manifestUrl`.
 *  - Other browsers use `hls.js` (already a dependency) to attach a
 *    MediaSource to the same `<video>` element.
 *  - For non-manifest URLs we just set `video.src` directly.
 *
 * The component is unmount-safe: the `Hls` instance is destroyed in
 * the cleanup callback so the player works across navigation without
 * leaking buffer.
 */
export function HlsPlayer({
  src,
  type,
  poster,
  className = '',
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    setError(null);

    if (type !== 'manifest') {
      // Plain progressive video / audio file.
      video.src = src;
      return undefined;
    }

    // Native HLS support — Safari, iOS, some smart TVs.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return undefined;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          // Surface a friendly message; the underlying HLS.js error
          // codes are not user-friendly enough for the player UI.
          setError(
            "Video oqimini yuklab bo'lmadi. Iltimos, sahifani qaytadan yuklang.",
          );
        }
      });
      return () => {
        hls.destroy();
      };
    }

    setError("Brauzeringiz HLS oqimini qo'llab-quvvatlamaydi.");
    return undefined;
  }, [src, type]);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black ${className}`}>
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster}
        className="aspect-video w-full"
      >
        <track kind="captions" />
      </video>
      {error ? (
        <div className="absolute inset-x-0 bottom-0 bg-red-500/80 px-4 py-2 text-center text-xs font-semibold text-white">
          {error}
        </div>
      ) : null}
    </div>
  );
}
