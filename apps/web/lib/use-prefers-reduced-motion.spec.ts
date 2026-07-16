import { act, renderHook } from '@testing-library/react';

import { prefersReducedMotion, usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * Tests for the shared reduced-motion hook (Requirement 19.4).
 *
 * Coverage:
 *  - defaults to "motion allowed" when the OS preference is off;
 *  - reports "reduced" when the preference is on;
 *  - reacts to live changes via the MediaQueryList `change` event;
 *  - falls back to legacy addListener/removeListener (Safari < 14);
 *  - the imperative `prefersReducedMotion()` reads the current value;
 *  - is SSR-safe when matchMedia is unavailable.
 */

type ChangeHandler = (event: { matches: boolean }) => void;

// A controllable matchMedia mock that lets tests drive `change` events.
function installMatchMedia(options: {
  initial: boolean;
  /** Use the legacy addListener API instead of addEventListener. */
  legacy?: boolean;
}) {
  const listeners = new Set<ChangeHandler>();
  let matches = options.initial;

  const mql: Record<string, unknown> = {
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    dispatchEvent: jest.fn(),
    get matches() {
      return matches;
    },
  };

  if (options.legacy) {
    mql.addEventListener = undefined;
    mql.removeEventListener = undefined;
    mql.addListener = jest.fn((cb: ChangeHandler) => listeners.add(cb));
    mql.removeListener = jest.fn((cb: ChangeHandler) => listeners.delete(cb));
  } else {
    mql.addEventListener = jest.fn((_evt: string, cb: ChangeHandler) => listeners.add(cb));
    mql.removeEventListener = jest.fn((_evt: string, cb: ChangeHandler) => listeners.delete(cb));
    mql.addListener = jest.fn();
    mql.removeListener = jest.fn();
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockReturnValue(mql),
  });

  return {
    emit(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  // Restore so other suites see jsdom's default (undefined) matchMedia.
  // @ts-expect-error — intentional teardown of the mocked global.
  delete window.matchMedia;
  jest.clearAllMocks();
});

describe('usePrefersReducedMotion', () => {
  it('defaults to false when the user has not requested reduced motion', () => {
    installMatchMedia({ initial: false });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when reduced motion is preferred', () => {
    installMatchMedia({ initial: true });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reacts to live preference changes', () => {
    const media = installMatchMedia({ initial: false });
    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(false);
    act(() => media.emit(true));
    expect(result.current).toBe(true);
    act(() => media.emit(false));
    expect(result.current).toBe(false);
  });

  it('uses the legacy addListener/removeListener API when needed', () => {
    const media = installMatchMedia({ initial: false, legacy: true });
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());

    act(() => media.emit(true));
    expect(result.current).toBe(true);

    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('removes its listener on unmount', () => {
    const media = installMatchMedia({ initial: false });
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('is SSR-safe and stays false when matchMedia is unavailable', () => {
    // No matchMedia installed in this test.
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe('prefersReducedMotion (imperative)', () => {
  it('reads the current preference', () => {
    installMatchMedia({ initial: true });
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns false when matchMedia is unavailable', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
