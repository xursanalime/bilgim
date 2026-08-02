'use client';

import { motion } from 'framer-motion';

/**
 * LogosStrip — animated marquee of partner logos.
 * Light theme — dim wordmarks on tint surface.
 */
export function LogosStrip() {
  return (
    <section className="relative overflow-hidden border-y border-rim bg-tint py-12">
      <div className="container-page">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-ink-faint"
        >
          O&apos;zbekistondagi yetakchi ta&apos;lim tashkilotlari ishonadi
        </motion.p>

        <div className="mt-8 flex overflow-hidden">
          <div className="flex shrink-0 animate-marquee items-center gap-12 pr-12">
            {LOGOS.concat(LOGOS).map((logo, i) => (
              <span
                key={`${logo}-${i}`}
                className="whitespace-nowrap text-lg font-extrabold tracking-tight text-ink-faint transition-colors hover:text-ink-soft sm:text-xl"
                style={{ letterSpacing: '-0.025em' }}
              >
                {logo}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const LOGOS = [
  'Profi Education',
  "Najot Ta'lim",
  'Cambridge Learning',
  'IT Park Academy',
  'Ziyo Forum',
  'Ustoz.uz',
  'Mehnatobod',
  'EnglishTime',
];
