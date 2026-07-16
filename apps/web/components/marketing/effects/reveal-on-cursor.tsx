'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * RevealOnCursor — sichqoncha qaerda bo'lsa, o'sha joyda yashirin
 * kontent paydo bo'ladi. CSS mask + radial-gradient orqali.
 *
 * Birinchi rasmdagi (Huly hero) effekt:
 *   - Konteyner ichida yashirin kartochkalar/grid bor
 *   - Sichqoncha kursor harakatlansa, atrofidagi kontent ochiladi
 *   - Kursor uzoqlashsa, qayta yashirinadi
 *
 * Foydalanish:
 *   <RevealOnCursor radius={300}>
 *     <YashirinKartochka />
 *     <YashirinGrid />
 *   </RevealOnCursor>
 */
export function RevealOnCursor({
  children,
  radius = 280,
  baseOpacity = 0.08,
  className = '',
}: {
  children: ReactNode;
  radius?: number;
  baseOpacity?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const noHover = window.matchMedia('(hover: none)').matches;
    if (noHover) {
      // Touch devices — show everything
      el.style.setProperty('--reveal-opacity', '1');
      return;
    }

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      target.current.x = e.clientX - rect.left;
      target.current.y = e.clientY - rect.top;
      el.style.setProperty('--reveal-active', '1');
    };

    const onLeave = () => {
      el.style.setProperty('--reveal-active', '0');
    };

    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * 0.18;
      current.current.y += (target.current.y - current.current.y) * 0.18;

      if (el) {
        el.style.setProperty('--mx', `${current.current.x}px`);
        el.style.setProperty('--my', `${current.current.y}px`);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal-container relative ${className}`}
      style={
        {
          '--mx': '50%',
          '--my': '50%',
          '--radius': `${radius}px`,
          '--base-opacity': `${baseOpacity}`,
          '--reveal-active': '0',
          '--reveal-opacity': `calc(var(--base-opacity) + 0.92 * var(--reveal-active))`,
        } as React.CSSProperties
      }
    >
      <div
        className="reveal-content"
        style={{
          maskImage:
            'radial-gradient(var(--radius) circle at var(--mx) var(--my), black 0%, transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(var(--radius) circle at var(--mx) var(--my), black 0%, transparent 70%)',
          opacity: 'var(--reveal-opacity)',
          transition: 'opacity 0.5s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}
