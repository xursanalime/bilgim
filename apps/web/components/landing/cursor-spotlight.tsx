'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CursorSpotlight — soft purple halo that follows the cursor.
 *
 * Inspired by antimatterai.com hero. Pure CSS + a single ref read on
 * `pointermove` (no React re-renders on every frame). Disables itself
 * on touch devices and when the user has reduced-motion enabled.
 */
export function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    if (mql.matches || isCoarse) return;

    setEnabled(true);

    let raf = 0;
    let pendingX = 0;
    let pendingY = 0;
    let firstMove = true;

    const onMove = (e: PointerEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        if (firstMove) {
          el.style.opacity = '1';
          firstMove = false;
        }
        el.style.transform = `translate3d(${pendingX - 320}px, ${pendingY - 320}px, 0)`;
      });
    };

    const onLeave = () => {
      const el = ref.current;
      if (el) el.style.opacity = '0';
      firstMove = true;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  if (!enabled) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden"
    >
      <div
        ref={ref}
        className="absolute h-[640px] w-[640px] rounded-full opacity-0 transition-opacity duration-500"
        style={{
          left: 0,
          top: 0,
          background:
            'radial-gradient(circle at center, rgba(118, 75, 162, 0.18) 0%, rgba(102, 126, 234, 0.10) 30%, transparent 60%)',
          filter: 'blur(40px)',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
