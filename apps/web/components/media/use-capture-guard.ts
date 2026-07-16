'use client';

import { useEffect, useRef, useState } from 'react';

import { useContentProtection } from '../../hooks/use-content-protection';
import { useScreenCaptureDetection } from '../../hooks/use-screen-capture-detection';

/**
 * useCaptureGuard — consolidates the two existing capture/protection hooks
 * (`use-content-protection` + `use-screen-capture-detection`) into a single,
 * reusable guard for Protected_Content surfaces (Requirements 4.1–4.3, 4.5).
 *
 * Responsibilities:
 *  - DETECT loss of focus/visibility and best-effort screen-capture
 *    (`getDisplayMedia`) via `useScreenCaptureDetection` (Req 4.2, 4.3).
 *  - DETER casual copying — disable right-click, drag-save, text selection and
 *    copy/cut **within the guarded surface**, and (optionally) block common
 *    download/print/devtools keyboard shortcuts globally via
 *    `useContentProtection` (Req 4.1).
 *  - SIGNAL the consumer when the surface becomes obscured (blur / tab hidden /
 *    capture detected) so it can PAUSE media playback, and when it is restored
 *    so it can resume — via the `onObscure` / `onRestore` callbacks (Req 4.2).
 *
 * HONEST LIMIT (Req 1.6 / 4): web screen-capture cannot be fully prevented.
 * This is layered *deterrence + traceability* (paired with the forensic
 * watermark), never absolute prevention. None of these measures block
 * assistive technology or keyboard navigation (Req 4.5).
 */

export interface CaptureGuardState {
  /** The tab/window is hidden or has lost focus (alt-tab, other window). */
  readonly isHidden: boolean;
  /** Best-effort screen-capture signal (`getDisplayMedia` was invoked). */
  readonly isCapturing: boolean;
  /**
   * The surface should be obscured + playback paused: true when hidden or
   * capturing. Consumers blur/overlay the frame while this is true (Req 4.2).
   */
  readonly isObscured: boolean;
}

export interface UseCaptureGuardOptions {
  /**
   * Called once each time the surface transitions INTO the obscured state
   * (focus/visibility lost or capture detected). Pause media playback here
   * (Req 4.2). The latest callback is always used; identity may change freely.
   */
  onObscure?: () => void;
  /**
   * Called once each time the surface transitions back OUT of the obscured
   * state (focus/visibility returns). Restore/resume here (Req 4.2).
   */
  onRestore?: () => void;
  /**
   * Also block download/print/source/devtools keyboard shortcuts at the
   * document level via `useContentProtection`. Defaults to `true`. Set to
   * `false` to scope deterrence to the surface only (e.g. when several guards
   * are mounted, or for a public preview). Never blocks assistive tech.
   */
  blockGlobalShortcuts?: boolean;
  /**
   * Turn the guard off entirely (no detection, no deterrence, never obscured).
   * Useful for non-protected/public content. Defaults to `false`.
   */
  disabled?: boolean;
}

export interface UseCaptureGuardResult<T extends HTMLElement = HTMLDivElement>
  extends CaptureGuardState {
  /** Attach to the element that wraps the protected content. */
  readonly surfaceRef: React.RefObject<T>;
}

/** Events suppressed within the guarded surface to deter casual copying. */
const SURFACE_EVENTS = ['contextmenu', 'dragstart', 'copy', 'cut', 'selectstart'] as const;

export function useCaptureGuard<T extends HTMLElement = HTMLDivElement>(
  options: UseCaptureGuardOptions = {},
): UseCaptureGuardResult<T> {
  const { onObscure, onRestore, blockGlobalShortcuts = true, disabled = false } = options;

  // Compose the existing detection hook (focus / visibility / getDisplayMedia).
  const { isCapturing, isHidden } = useScreenCaptureDetection();

  // Compose the existing global deterrence hook (right-click / shortcuts).
  // It is hook-rule-safe to always call it; the `enabled` flag gates effects.
  useContentProtection({ enabled: !disabled && blockGlobalShortcuts });

  const surfaceRef = useRef<T>(null);

  const isObscured = !disabled && (isHidden || isCapturing);

  // Keep the latest callbacks in refs so toggling obscure state doesn't depend
  // on stable callback identity (avoids spurious re-subscribes).
  const onObscureRef = useRef(onObscure);
  const onRestoreRef = useRef(onRestore);
  onObscureRef.current = onObscure;
  onRestoreRef.current = onRestore;

  // Fire pause/restore exactly on transitions (non-spammy).
  const [wasObscured, setWasObscured] = useState(false);
  useEffect(() => {
    if (isObscured === wasObscured) return;
    setWasObscured(isObscured);
    if (isObscured) {
      onObscureRef.current?.();
    } else {
      onRestoreRef.current?.();
    }
  }, [isObscured, wasObscured]);

  // Surface-scoped deterrence: suppress copy/selection/context-menu/drag within
  // the guarded element itself, so protection holds even when global shortcut
  // blocking is disabled. These never interfere with assistive tech (Req 4.5).
  useEffect(() => {
    if (disabled) return;
    const el = surfaceRef.current;
    if (!el) return;

    const prevent = (event: Event) => {
      event.preventDefault();
    };

    for (const name of SURFACE_EVENTS) {
      el.addEventListener(name, prevent);
    }
    return () => {
      for (const name of SURFACE_EVENTS) {
        el.removeEventListener(name, prevent);
      }
    };
  }, [disabled]);

  return { surfaceRef, isHidden, isCapturing, isObscured };
}

export default useCaptureGuard;
