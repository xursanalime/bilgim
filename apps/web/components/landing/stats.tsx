'use client';

import { motion } from 'framer-motion';
import { AnimatedCounter } from './animated-counter';
import { tokens } from '../../lib/design/tokens';

/**
 * Stats — proof section with 4 KPI numbers in editorial layout.
 */
export function Stats() {
  return (
    <section className="relative section">
      <div className="container-aurora">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-4">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative"
            >
              {i > 0 && (
                <span className="absolute -left-3 top-2 hidden h-12 w-px bg-rim md:block" />
              )}

              <div
                className="font-extrabold tracking-tight"
                style={{
                  fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
                  letterSpacing: '-0.05em',
                  lineHeight: '1',
                  color: stat.color,
                }}
              >
                <AnimatedCounter
                  to={stat.value}
                  suffix={stat.suffix}
                  format={stat.format as 'natural' | 'compact'}
                />
              </div>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                {stat.label}
              </p>
              <p className="mt-1 text-xs text-ink-faint">{stat.sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STATS = [
  {
    value: 10000,
    suffix: '+',
    label: "O'qituvchilar",
    sub: 'Faol akkauntlar',
    color: tokens.brand.primary, // Apple blue
    format: 'compact',
  },
  {
    value: 120000,
    suffix: '+',
    label: 'Talabalar',
    sub: "Oylik o'rtacha",
    color: tokens.semantic.success, // Apple green
    format: 'compact',
  },
  {
    value: 5000,
    suffix: '+',
    label: 'Kurslar',
    sub: 'Yaratilgan',
    color: tokens.semantic.warn, // Apple orange
    format: 'compact',
  },
  {
    value: 1,
    suffix: 'M+',
    label: 'Darslar',
    sub: "O'tilgan",
    color: tokens.ai.accent, // Apple purple
    format: 'natural',
  },
];
