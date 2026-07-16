'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * StatsStrip — animated stat counters in a 4-column row.
 */
export function StatsStrip() {
  return (
    <section className="relative bg-ink py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl border border-white/[0.07] bg-ink-surface/40 p-8 backdrop-blur-sm sm:p-10"
        >
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            <Stat value={10000} suffix="+" label="O'qituvchilar" />
            <Stat value={120000} suffix="+" label="Talabalar" />
            <Stat value={5000} suffix="+" label="Yaratilgan kurslar" />
            <Stat value={1} suffix="M+" label="O'tilgan darslar" big />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Stat({
  value,
  suffix,
  label,
  big,
}: {
  value: number;
  suffix?: string;
  label: string;
  big?: boolean;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const animated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !animated.current) {
          animated.current = true;
          const target = value;
          const duration = 1600;
          const start = Date.now();
          const tick = () => {
            const t = Math.min((Date.now() - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setN(Math.floor(target * eased));
            if (t < 1) requestAnimationFrame(tick);
            else setN(target);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  const formatted = big ? n.toString() : n.toLocaleString();

  return (
    <div ref={ref} className="text-center sm:text-left">
      <div className="flex items-baseline justify-center gap-1 sm:justify-start">
        <span
          className="font-extrabold tracking-tight text-cream"
          style={{
            fontSize: 'clamp(2.25rem, 4vw, 3.5rem)',
            letterSpacing: '-0.04em',
          }}
        >
          {formatted}
        </span>
        {suffix && (
          <span
            className="font-extrabold tracking-tight text-accent2-500"
            style={{
              fontSize: 'clamp(1.5rem, 2.5vw, 2rem)',
              letterSpacing: '-0.03em',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
        {label}
      </p>
    </div>
  );
}
