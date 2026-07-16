'use client';

import { useEffect, useState } from 'react';

// ═════════════════════════════════════════════════════════════════
// usePrefersReducedMotion — shared, SSR-safe reduced-motion hook.
//
// Consolidates the `window.matchMedia('(prefers-reduced-motion: reduce)')`
// subscription pattern that is currently inlined in several components
// (gamification toasts/widgets, media overlays, AI tutor, landing effects).
// Those call sites can migrate to this hook over time so the matchMedia
// wiring — including the Safari < 14 `addListener`/`removeListener` fallback
// and the SSR guard — lives in exactly one place.
//
// Behavior:
//   - Returns `false` during SSR and on the first client render (motion is
//     allowed by default), then reconciles to the real preference after mount.
//     This keeps the server and client markup identical to avoid hydration
//     mismatches.
//   - Reactively updates when the user toggles the OS-level setting.
//
// Requirement 19.4 — honor `prefers-reduced-motion`.
// ═════════════════════════════════════════════════════════════════

const QUERY = '(prefers-reduced-motion: reduce)';

/** Reactively track the user's reduced-motion preference (SSR-safe). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia(QUERY);
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }

    // Safari < 14 / legacy fallback.
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return reduced;
}

/**
 * Imperative, non-reactive read of the reduced-motion preference.
 *
 * Useful inside event handlers, `useEffect` bodies, or `<canvas>` animation
 * setup where a hook subscription is unnecessary. Returns `false` outside the
 * DOM (SSR / web workers).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export default usePrefersReducedMotion;
