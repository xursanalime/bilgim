'use client';

import { useEffect, useRef } from 'react';

/**
 * CursorSpotlight — sichqoncha kursori atrofida yumshoq glow effekti.
 *
 * Performans optimallashtirilgan:
 * - rAF (requestAnimationFrame) bilan smooth movement
 * - CSS variable yangilanadi (re-render yo'q)
 * - Mobil va touch qurilmalarda o'chiriladi (hover yo'q)
 *
 * Foydalanish:
 *   <div className="relative">
 *     <CursorSpotlight />
 *     {children}
 *   </div>
 */
export function CursorSpotlight({
  size = 600,
  color = 'rgba(0,113,227, 0.15)',
}: {
  size?: number;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Touch / no-hover qurilmalarda effekt kerak emas.
    if (typeof window === 'undefined') return;
    const noHover = window.matchMedia('(hover: none)').matches;
    if (noHover) return;

    const onMove = (e: MouseEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
    };

    const tick = () => {
      // Lerp — yumshoq harakat
      current.current.x += (target.current.x - current.current.x) * 0.15;
      current.current.y += (target.current.y - current.current.y) * 0.15;

      if (ref.current) {
        ref.current.style.setProperty('--x', `${current.current.x}px`);
        ref.current.style.setProperty('--y', `${current.current.y}px`);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', onMove);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 transition-opacity duration-300"
      style={{
        background: `radial-gradient(${size}px circle at var(--x) var(--y), ${color}, transparent 50%)`,
      }}
    />
  );
}
