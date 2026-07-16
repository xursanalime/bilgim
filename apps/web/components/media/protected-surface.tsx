'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

import { useCaptureGuard } from './use-capture-guard';
import { usePrefersReducedMotion } from '../../lib/use-prefers-reduced-motion';

/**
 * ProtectedSurface — the single, reusable wrapper that consolidates Bilgim's
 * capture-deterrence behavior for any Protected_Content view (lesson player,
 * live viewer, protected file viewer). It composes {@link useCaptureGuard}
 * (which itself wraps `use-content-protection` + `use-screen-capture-detection`).
 *
 * Behavior (Requirements 4.1–4.5):
 *  - Disables text selection, copy/cut, drag-save and the context menu within
 *    the surface, and (by default) blocks download/print/devtools keyboard
 *    shortcuts at the document level (Req 4.1). Tagged `data-content-protected`
 *    so the existing `globals.css` selection rules apply.
 *  - On window blur, tab `visibilitychange` → hidden, or a detected
 *    screen-capture signal, it PAUSES playback (via `onPause`) and OBSCURES the
 *    frame with a blur + dim overlay, so a backgrounded capture grabs nothing
 *    useful; it restores (and calls `onResume`) when focus/visibility returns
 *    (Req 4.2, 4.3).
 *  - Surfaces a brief, non-spammy notice that captures are watermarked &
 *    traceable (Req 4.4).
 *
 * Accessibility & honesty (Req 4.5, 1.6):
 *  - The obscure overlay is `aria-hidden` and `pointer-events: none` — it never
 *    traps focus, blocks the keyboard, or interferes with assistive tech.
 *  - It honors `prefers-reduced-motion` (no harsh flashing; the blur fade is
 *    disabled under reduced motion).
 *  - This is layered DETERRENCE + TRACEABILITY, not absolute prevention — web
 *    capture cannot be 100% blocked. The honest messaging copy lands in
 *    task 1.7; defaults here are intentionally restrained.
 */

export interface ProtectedSurfaceProps {
  children: ReactNode;
  /** Extra class for the outer surface container. */
  className?: string;
  /** Class applied to the inner content wrapper that gets blurred when obscured. */
  contentClassName?: string;
  /**
   * Pause callback — invoked when the surface becomes obscured (blur / hidden /
   * capture). Wire the player's pause here (Req 4.2). The player owns playback;
   * this surface only signals.
   */
  onPause?: () => void;
  /** Resume hook — invoked when focus/visibility returns. Playback resume is the player's choice. */
  onResume?: () => void;
  /**
   * Block global download/print/devtools shortcuts too. Defaults to `true`.
   * Set `false` to scope deterrence to this surface only (e.g. when multiple
   * protected surfaces are mounted on one page).
   */
  blockGlobalShortcuts?: boolean;
  /** Disable the guard entirely (non-protected / public content). Default `false`. */
  disabled?: boolean;
  /**
   * Persistent, subtle protection notice (Req 4.4). Set to `null` to hide it.
   * Defaults to an Uzbek deterrence line consistent with the rest of the player.
   */
  notice?: string | null;
  /** Message shown on the obscure overlay while hidden/capturing. */
  obscuredMessage?: string;
  /** Render the visible corner notice badge. Defaults to `true`. */
  showNoticeBadge?: boolean;
}

const DEFAULT_NOTICE =
  'Himoyalangan kontent — yozib olish va tarqatish suvli belgi orqali kuzatiladi.';
const DEFAULT_OBSCURED_MESSAGE = 'Diqqat boshqa oynaga ko\u2018tirildi — ijro to\u2018xtatildi.';

export function ProtectedSurface({
  children,
  className,
  contentClassName,
  onPause,
  onResume,
  blockGlobalShortcuts = true,
  disabled = false,
  notice = DEFAULT_NOTICE,
  obscuredMessage = DEFAULT_OBSCURED_MESSAGE,
  showNoticeBadge = true,
}: ProtectedSurfaceProps): JSX.Element {
  const { surfaceRef, isObscured, isCapturing } = useCaptureGuard<HTMLDivElement>({
    ...(onPause ? { onObscure: onPause } : {}),
    ...(onResume ? { onRestore: onResume } : {}),
    blockGlobalShortcuts,
    disabled,
  });

  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      ref={surfaceRef}
      data-content-protected={disabled ? undefined : 'true'}
      data-obscured={isObscured ? 'true' : undefined}
      data-testid="protected-surface"
      className={clsx('relative', className)}
      style={{ position: 'relative' }}
    >
      {/* Content layer — blurred + dimmed while obscured so a backgrounded
          capture grabs nothing useful. The blur is purely visual. */}
      <div
        data-testid="protected-content"
        className={contentClassName}
        style={{
          filter: isObscured ? 'blur(24px)' : 'none',
          // No harsh flashing: disable the transition under reduced motion.
          transition: reducedMotion ? 'none' : 'filter 200ms ease',
          // Keep layout stable while blurred.
          willChange: isObscured ? 'filter' : 'auto',
        }}
      >
        {children}
      </div>

      {/* Obscure overlay — decorative + informative only. NEVER focusable, never
          intercepts pointer events, hidden from assistive tech (Req 4.5). */}
      {isObscured ? (
        <div
          aria-hidden="true"
          data-testid="protected-obscure-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '1.5rem',
            // Pointer events off → cannot trap focus or block the keyboard.
            pointerEvents: 'none',
            userSelect: 'none',
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
            color: '#FFFFFF',
            fontSize: '14px',
            fontWeight: 600,
            lineHeight: 1.4,
            zIndex: 40,
            transition: reducedMotion ? 'none' : 'opacity 200ms ease',
          }}
        >
          <span>{obscuredMessage}</span>
        </div>
      ) : null}

      {/* Persistent, subtle visible notice (Req 4.4). Non-interactive. */}
      {notice && showNoticeBadge && !disabled ? (
        <div
          aria-hidden="true"
          data-testid="protected-notice-badge"
          style={{
            position: 'absolute',
            right: '0.5rem',
            bottom: '0.5rem',
            maxWidth: '70%',
            pointerEvents: 'none',
            userSelect: 'none',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.5rem',
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            color: 'rgba(255, 255, 255, 0.85)',
            fontSize: '11px',
            fontWeight: 500,
            lineHeight: 1.3,
            zIndex: 35,
          }}
        >
          {notice}
        </div>
      ) : null}

      {/* Single, polite, non-spammy live region. Announces the obscure state to
          assistive tech only on transitions; the visual blur stays aria-hidden. */}
      <span
        role="status"
        aria-live="polite"
        data-testid="protected-live-region"
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
        {disabled
          ? ''
          : isObscured
            ? isCapturing
              ? 'Ekran yozib olish aniqlandi — ijro to\u2018xtatildi.'
              : obscuredMessage
            : ''}
      </span>
    </div>
  );
}

/**
 * `CaptureGuard` is an alias of {@link ProtectedSurface}. The design refers to
 * the deterrence wrapper as both `CaptureGuard` and `ProtectedSurface`; this
 * keeps either import name working.
 */
export const CaptureGuard = ProtectedSurface;

export default ProtectedSurface;
