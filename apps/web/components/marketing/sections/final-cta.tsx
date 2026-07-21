'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ParticleField } from '../effects/particle-field';

/**
 * FinalCta — closing call-to-action with strong visual.
 */
export function FinalCta({ locale }: { locale: string }) {
  return (
    <section className="relative overflow-hidden bg-ink py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
          className="relative overflow-hidden rounded-[40px] border border-accent2-500/30 p-10 text-center sm:p-16"
          style={{
            background:
              'radial-gradient(ellipse at top, rgba(0,232,122,0.12) 0%, rgba(13,31,54,0.4) 50%, rgba(8,12,16,0.8) 100%)',
            boxShadow:
              '0 0 0 1px rgba(0,232,122,0.15), 0 60px 120px -30px rgba(0,232,122,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          {/* Particle background */}
          <ParticleField
            density={30}
            color="rgba(0, 232, 122, 0.4)"
            linkColor="rgba(0, 232, 122, 0.15)"
          />

          {/* Decorative orbs */}
          <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent2-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-accent2-500/15 blur-3xl" />

          {/* Grid pattern */}
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />

          {/* Content */}
          <div className="relative">
            {/* Badge */}
            <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-4 py-1.5 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent2-500" />
              </span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-accent2-500">
                Hozirdan boshlang
              </span>
            </span>

            {/* Headline */}
            <h2
              className="mx-auto mt-8 max-w-3xl text-balance font-extrabold tracking-tight text-cream"
              style={{
                fontSize: 'clamp(2.5rem, 6vw, 5rem)',
                letterSpacing: '-0.045em',
              }}
            >
              Ta&apos;limni bugun{' '}
              <span
                style={{
                  background:
                    'linear-gradient(135deg, #00E87A 0%, #B3FFD8 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                o&apos;zgartiring.
              </span>
            </h2>

            <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-cream-dim sm:text-lg">
              14 kun bepul. Karta kerak emas. 5 daqiqada sozlash.
              Minglab o&apos;qituvchilar qatoriga qo&apos;shiling.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Link
                href={`/${locale}/register?role=teacher`}
                className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-accent2-500 px-8 py-4 text-base font-bold text-ink transition-all hover:bg-accent2-400 active:scale-[0.98]"
                style={{
                  boxShadow:
                    '0 0 0 1px rgba(0,232,122,0.5), 0 16px 48px -12px rgba(0,232,122,0.7), 0 0 80px -20px rgba(0,232,122,1)',
                }}
              >
                <span className="relative z-10">14 kun bepul boshlash</span>
                <svg
                  className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-1"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
                <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </Link>

              <Link
                href={`/${locale}/discover`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-7 py-4 text-base font-semibold text-cream backdrop-blur-md transition-all hover:border-white/[0.25] hover:bg-white/[0.08]"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                O&apos;qituvchilarni ko&apos;rish
              </Link>
            </div>

            {/* Trust */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-cream-dim">
              <span className="flex items-center gap-1.5">
                <CheckIcon /> 14 kun bepul
              </span>
              <span className="flex items-center gap-1.5">
                <CheckIcon /> Karta kerak emas
              </span>
              <span className="flex items-center gap-1.5">
                <CheckIcon /> Istalgan vaqtda bekor qilish
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-accent2-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
