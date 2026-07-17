'use client';

import { motion } from 'framer-motion';

/**
 * LogosStrip — animated marquee of teacher niches Bilgim is built for.
 * Deliberately not framed as "trusted by" — the product has no named
 * institutional customers yet, so this shows target segments instead
 * of fabricated social proof.
 */
export function LogosStrip() {
  return (
    <section className="relative overflow-hidden border-y border-rim bg-tint py-12">
      <div className="container-aurora">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-ink-faint"
        >
          Har qanday yo&apos;nalishdagi o&apos;qituvchi uchun mo&apos;ljallangan
        </motion.p>

        <div className="mt-8 flex overflow-hidden">
          <div className="flex shrink-0 animate-marquee items-center gap-12 pr-12">
            {NICHES.concat(NICHES).map((niche, i) => (
              <span
                key={`${niche}-${i}`}
                className="whitespace-nowrap text-lg font-extrabold tracking-tight text-ink-faint transition-colors hover:text-ink-soft sm:text-xl"
                style={{ letterSpacing: '-0.025em' }}
              >
                {niche}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const NICHES = [
  'Til o’qituvchilari',
  'IELTS/TOEFL murabbiylari',
  'Dasturlash ustozlari',
  'Matematika repetitorlari',
  'Musiqa va san’at o’qituvchilari',
  'Onlayn kurs mualliflari',
  'Til markazlari',
  'Xususiy repetitorlar',
];
