'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { AuroraBackdrop } from './aurora-backdrop';

export function FinalCta({ locale }: { locale: string }) {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7 }}
          className="relative isolate overflow-hidden rounded-[2.5rem] border border-blue/30 px-8 py-16 text-center sm:px-16 sm:py-24"
          style={{
            boxShadow:
              '0 0 0 1px rgba(255,122,89,0.15), 0 60px 120px -30px rgba(255,122,89,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          {/* Aurora backdrop */}
          <AuroraBackdrop variant="warm" />

          {/* Grid */}
          <div className="pointer-events-none absolute inset-0 bg-linegrid opacity-30" />

          {/* Content */}
          <div className="relative z-10">
            {/* Badge */}
            <span className="inline-flex items-center gap-2 rounded-full border border-blue/30 bg-blue/15 px-4 py-1.5 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue" />
              </span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-blue">
                Hozirdan boshlang
              </span>
            </span>

            {/* Title */}
            <h2
              className="mx-auto mt-7 max-w-3xl text-balance font-display font-extrabold text-ink"
              style={{
                fontSize: 'clamp(2.25rem, 6vw, 5rem)',
                letterSpacing: '-0.05em',
                lineHeight: '0.95',
              }}
            >
              Ta&apos;limni bugun{' '}
              <span className="italic text-blue-green-gradient">
                o&apos;zgartiring.
              </span>
            </h2>

            <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-ink-soft sm:text-lg">
              14 kun bepul · Karta kerak emas · 5 daqiqada sozlash
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={`/${locale}/register?role=teacher`}
                className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-blue px-8 py-4 text-base font-bold text-white transition-all hover:bg-blue-400 active:scale-[0.97]"
                style={{
                  boxShadow:
                    '0 0 0 1px rgba(255,122,89,0.5), 0 16px 48px -12px rgba(255,122,89,0.7), 0 0 80px -20px rgba(255,122,89,0.5)',
                }}
              >
                <span className="relative z-10">14 kun bepul boshlash</span>
                <ArrowRight className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-1" />
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
              </Link>
              <Link
                href={`/${locale}/discover`}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-rim-2 bg-canvas px-7 py-4 text-base font-semibold text-ink backdrop-blur-md transition-all hover:border-rim-2 hover:bg-soft"
              >
                <Search className="h-4 w-4" />
                O&apos;qituvchilarni ko&apos;rish
              </Link>
            </div>

            {/* Trust */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-soft">
              <span className="flex items-center gap-1.5">
                <Check /> 14 kun bepul
              </span>
              <span className="flex items-center gap-1.5">
                <Check /> Karta kerak emas
              </span>
              <span className="flex items-center gap-1.5">
                <Check /> Istalgan vaqtda bekor qilish
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

function Search({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      className="h-3.5 w-3.5 text-green"
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
