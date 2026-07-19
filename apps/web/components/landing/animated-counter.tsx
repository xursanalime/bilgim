'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * AnimatedCounter — counts up from 0 to target when scrolled into view.
 */
export function AnimatedCounter({
  to,
  suffix = '',
  duration = 1800,
  format = 'natural',
}: {
  to: number;
  suffix?: string;
  duration?: number;
  format?: 'natural' | 'compact';
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const animated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !animated.current) {
          animated.current = true;
          const start = performance.now();
          const tick = () => {
            const t = Math.min((performance.now() - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setN(Math.floor(to * eased));
            if (t < 1) requestAnimationFrame(tick);
            else setN(to);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  const formatted = format === 'compact'
    ? n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${Math.floor(n / 1000)}K`
        : `${n}`
    : n.toLocaleString('en-US');

  return (
    <span ref={ref}>
      {formatted}
      {suffix}
    </span>
  );
}
