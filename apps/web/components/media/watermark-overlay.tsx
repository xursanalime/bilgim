'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { getToken, tokenVars, tokens } from '../../lib/design/tokens';

/**
 * Per-viewer forensic watermark overlay (Requirements 3.1, 3.2, 3.3, 3.5).
 *
 * Purely presentational: it renders the **server-derived** per-viewer label
 * (e.g. masked email • session id) handed down via the {@link WatermarkOverlayProps.label}
 * prop, plus a live, periodically-updated timestamp. It never constructs the
 * viewer identity client-side — the protected player resolves the label from
 * the authenticated playback ticket (`ticket.watermark.label`) and passes it in
 * (Req 3.1, 3.3).
 *
 * The overlay:
 *  - repositions on an interval so it cannot be trivially cropped out of a
 *    full-frame capture (Req 3.2);
 *  - renders above the video (`zIndex`) and never intercepts pointer events so
 *    it cannot block the player controls;
 *  - is semi-transparent white with a strong text shadow so it stays legible
 *    over both light and dark video content;
 *  - respects `prefers-reduced-motion` (it still repositions, but without the
 *    animated transition between positions) (Req 4.5 / 19.4);
 *  - is identical for recorded lessons and live playback — it is driven solely
 *    by the `label` prop (Req 3.5).
 *
 * Accessibility: the moving visual is `aria-hidden` (it is decorative-but-
 * informative noise for screen-reader users), while an optional protection
 * notice is exposed once to assistive tech via a visually-hidden live-region.
 */

/** A watermark anchor expressed as CSS `top`/`left` percentages. */
export interface WatermarkPosition {
  readonly top: string;
  readonly left: string;
}

export interface WatermarkOverlayProps {
  /**
   * Server-derived, PII-masked per-viewer label (e.g. `"j••@mail.com • a1b2"`).
   * MUST originate from the playback ticket — never client-constructed
   * identity. Required (Req 3.1, 3.3).
   */
  label: string;
  /** Render a live timestamp alongside the label. Defaults to `true` (Req 3.2). */
  showTimestamp?: boolean;
  /**
   * How often (ms) the timestamp refreshes. Defaults to 5000ms ("every few
   * seconds", Req 3.2). Values < 1000 are clamped to 1000.
   */
  timestampIntervalMs?: number;
  /**
   * How often (ms) the watermark moves to a new position. Defaults to 8000ms
   * (Req 3.2). Values < 1000 are clamped to 1000.
   */
  repositionIntervalMs?: number;
  /**
   * Override the set of anchor positions the watermark cycles through. Defaults
   * to six positions spread across the frame so no single crop removes it.
   */
  positions?: readonly WatermarkPosition[];
  /**
   * Optional protection notice surfaced once to screen readers (the moving
   * visual itself is `aria-hidden`). When omitted, no notice is announced.
   */
  protectionNotice?: string;
  /** Optional extra class for the overlay container. */
  className?: string;
}

/** Default anchor grid: corners + mid-edges, spread so a crop can't remove it. */
const DEFAULT_POSITIONS: readonly WatermarkPosition[] = [
  { top: '8%', left: '8%' },
  { top: '8%', left: '62%' },
  { top: '46%', left: '34%' },
  { top: '80%', left: '8%' },
  { top: '80%', left: '62%' },
  { top: '46%', left: '8%' },
];

const DEFAULT_TIMESTAMP_INTERVAL_MS = 5000;
const DEFAULT_REPOSITION_INTERVAL_MS = 8000;

/** Format a timestamp for the overlay (locale-aware, second precision). */
function formatTimestamp(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function WatermarkOverlay({
  label,
  showTimestamp = true,
  timestampIntervalMs = DEFAULT_TIMESTAMP_INTERVAL_MS,
  repositionIntervalMs = DEFAULT_REPOSITION_INTERVAL_MS,
  positions = DEFAULT_POSITIONS,
  protectionNotice,
  className,
}: WatermarkOverlayProps) {
  // Guarantee at least one position even if an empty array is passed.
  const anchors = useMemo<readonly WatermarkPosition[]>(
    () => (positions.length > 0 ? positions : DEFAULT_POSITIONS),
    [positions],
  );

  const [positionIndex, setPositionIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [reducedMotion, setReducedMotion] = useState(false);

  // Track the reduced-motion preference reactively (no jarring transitions).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    // Safari < 14 only supports the deprecated addListener signature.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  // Reposition on an interval so the watermark can't be cropped out (Req 3.2).
  useEffect(() => {
    const interval = Math.max(1000, repositionIntervalMs);
    const id = setInterval(() => {
      setPositionIndex((prev) => (prev + 1) % anchors.length);
    }, interval);
    return () => clearInterval(id);
  }, [anchors.length, repositionIntervalMs]);

  // Refresh the live timestamp periodically (Req 3.2).
  useEffect(() => {
    if (!showTimestamp) return;
    const interval = Math.max(1000, timestampIntervalMs);
    const id = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(id);
  }, [showTimestamp, timestampIntervalMs]);

  const anchor = anchors[positionIndex] ?? anchors[0]!;

  // Semi-transparent white text, legible over light or dark video. The text
  // color comes from the token bridge so the active theme is respected; the
  // strong shadow guarantees contrast regardless of underlying frame.
  const inkColor = getToken(tokenVars.text.strong, tokens.text.strong);

  const timestampText = useMemo(
    () => (showTimestamp ? formatTimestamp(now) : null),
    [showTimestamp, now],
  );

  return (
    <div
      data-testid="watermark-overlay"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        // Never intercept clicks — the player controls must stay reachable.
        pointerEvents: 'none',
        userSelect: 'none',
        // Above the video and any in-frame chrome.
        zIndex: 30,
        overflow: 'hidden',
      }}
    >
      <div
        // The moving label is decorative-but-informative noise for SR users.
        aria-hidden="true"
        data-testid="watermark-label"
        style={{
          position: 'absolute',
          top: anchor.top,
          left: anchor.left,
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          transform: 'rotate(-24deg)',
          // Reduced-motion: snap to the new position, no animated slide.
          transition: reducedMotion ? 'none' : 'top 900ms ease, left 900ms ease',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          lineHeight: 1.3,
          // Subtle ink tint blended with white keeps it readable yet unobtrusive.
          color: '#FFFFFF',
          opacity: 0.28,
          textShadow:
            '0 1px 3px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.9)',
          // Carry the theme ink as a CSS var so consumers can opt into it,
          // without overriding the high-contrast white used over video.
          ['--watermark-ink' as string]: inkColor,
        }}
      >
        <span>{label}</span>
        {timestampText ? (
          <>
            {' • '}
            <span>{timestampText}</span>
          </>
        ) : null}
      </div>

      {protectionNotice ? (
        <span
          // Exposed once to assistive tech; visually hidden so it doesn't add
          // to the on-screen noise. Not aria-hidden (it lives outside the
          // decorative moving layer above).
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            borderWidth: 0,
          }}
        >
          {protectionNotice}
        </span>
      ) : null}
    </div>
  );
}

export default WatermarkOverlay;
