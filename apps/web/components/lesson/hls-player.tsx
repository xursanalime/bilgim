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

const SKIP_SECONDS = 5;

/**
 * Assumed downlink, in bits/sec, before hls.js has measured anything.
 *
 * hls.js defaults this to 500 kbps — below even the 240p rung's declared
 * bandwidth — so until a real measurement lands, ABR's view of the
 * connection is pessimistic enough to undo the start level we pick
 * below. Seeding it at 4 Mbps means the first *measured* segment, not a
 * placeholder, decides what comes after the first one.
 */
const INITIAL_BANDWIDTH_ESTIMATE = 4_000_000;

/**
 * Clips at or below this length (seconds) are pinned to the top rung.
 *
 * ABR needs several segments to converge, and a clip this short is over
 * before that can happen — leaving it on whatever rung it started at.
 * At 6s segments the whole clip is a couple of requests either way, so
 * we buffer the best rendition instead of adapting to a stream that has
 * already finished.
 */
const SHORT_CLIP_MAX_SECONDS = 90;

/**
 * HLS-aware `<video>` wrapper.
 *
 * Strategy:
 *  - Safari (and iOS) play HLS natively — set `video.src = manifestUrl`.
 *  - Other browsers use `hls.js` (already a dependency) to attach a
 *    MediaSource to the same `<video>` element.
 *  - For non-manifest URLs we just set `video.src` directly.
 *  - Playback opens on the highest rung the ladder offers instead of
 *    letting hls.js probe its way up from the lowest one; see the
 *    `MANIFEST_PARSED` handler.
 *
 * The component is unmount-safe: the `Hls` instance is destroyed in
 * the cleanup callback so the player works across navigation without
 * leaking buffer.
 *
 * Seeking by ±5s is keyboard-only (arrow keys) — see the capture-phase
 * listener below — relying on the native control bar's scrubber for
 * pointer input. This is the single shared player used everywhere in
 * the app (lessons, homework materials, chat attachments), so fixing it
 * here covers every video player at once.
 */
export function HlsPlayer({
  src,
  type,
  poster,
  className = '',
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

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
      const hls = new Hls({
        enableWorker: true,
        // Nothing loads until MANIFEST_PARSED has told us how many rungs
        // the ladder has, so the very first segment already comes from
        // the one we want.
        //
        // The default `autoStartLoad` fires off MANIFEST_LOADED, which is
        // dispatched *before* MANIFEST_PARSED — by the time a listener
        // could see `hls.levels`, loading has already been kicked off
        // with an unset start level. Deferring it is what makes picking a
        // rung up front possible at all.
        autoStartLoad: false,
        abrEwmaDefaultEstimate: INITIAL_BANDWIDTH_ESTIMATE,
      });
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels.length > 0) {
          // Left unset, hls.js resolves the start level to -1, and its
          // `testBandwidth` default then deliberately fetches segment 0
          // from the *lowest* rung purely to measure the connection. The
          // viewer watches that measurement: the clip opens at 240p and
          // only sharpens once the second segment arrives, one whole
          // segment — six seconds here — later. Naming a level skips the
          // probe entirely.
          //
          // This fixes the first fragment only; ABR still owns every
          // switch after it, so a connection that genuinely cannot
          // sustain the top rung drops within a segment or two.
          hls.startLevel = hls.levels.length - 1;
        }
        hls.startLoad();
      });

      // The first level load is what tells us how long the clip is; pin
      // short ones to the top rung and let everything else adapt.
      hls.once(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (data.details.totalduration > SHORT_CLIP_MAX_SECONDS) return;
        if (hls.levels.length > 0) {
          hls.currentLevel = hls.levels.length - 1;
        }
      });

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onLoadedMetadata = () => setDuration(video.duration || 0);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', onLoadedMetadata);
  }, [src]);

  const skip = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = duration || video.duration || Infinity;
    video.currentTime = Math.min(Math.max(0, video.currentTime + deltaSeconds), max);
  };

  /**
   * Arrow keys seek by SKIP_SECONDS.
   *
   * Chrome routes arrow keys to the progress slider inside the video's
   * user-agent shadow root, which steps by 1% of the duration — on a
   * 10s clip that is 0.1s per press, so the picture appears frozen.
   * The listener is registered on the container in the CAPTURE phase so
   * it runs before the event can descend into the shadow controls, and
   * stopPropagation keeps it from reaching them at all.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // Leave text entry (e.g. a comment box rendered over the player) alone.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      event.preventDefault();
      event.stopPropagation();
      skip(event.key === 'ArrowRight' ? SKIP_SECONDS : -SKIP_SECONDS);
    };

    container.addEventListener('keydown', onKeyDown, true);
    return () => container.removeEventListener('keydown', onKeyDown, true);
  }, [duration]);

  return (
    // tabIndex lets the wrapper hold focus when the click lands outside the
    // <video> itself, so the arrow keys work from anywhere on the player.
    <div
      ref={containerRef}
      tabIndex={0}
      className="overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-blue"
    >
      <div className={`relative bg-black ${className}`}>
        <video
          ref={videoRef}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          playsInline
          poster={poster}
          className="aspect-video w-full"
          onContextMenu={(e) => e.preventDefault()}
        >
          <track kind="captions" />
        </video>

        {error ? (
          <div className="absolute inset-x-0 bottom-0 bg-red-500/80 px-4 py-2 text-center text-xs font-semibold text-white">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
