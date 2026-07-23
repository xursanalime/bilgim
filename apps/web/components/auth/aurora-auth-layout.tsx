'use client';

import type { ReactNode } from 'react';
import { useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { BrandMark } from '../landing/brand-logo';

interface AuroraAuthLayoutProps {
  children: ReactNode;
  locale: string;
  /** Footer link variant under the card. */
  footer?: 'signup' | 'login' | 'none';
}

/**
 * AuroraAuthLayout — Apple Liquid Glass split-screen auth shell.
 *
 * Left  (lg+): gradient brand panel with a mini live-class mockup and
 *              feature highlights — mirrors the landing aesthetic.
 * Right:       soft #F5F5F7 surface holding the white form card.
 *
 * On mobile the brand panel is hidden and the form card fills the view.
 */
export function AuroraAuthLayout({
  children,
  locale,
  footer = 'none',
}: AuroraAuthLayoutProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#F5F5F7' }}>
      {/* ── Left brand panel ──────────────────────────────── */}
      <BrandPanel locale={locale} />

      {/* ── Right form column ─────────────────────────────── */}
      <div className="relative flex w-full flex-col lg:w-[52%] xl:w-[46%]">
        {/* Ambient orbs (mobile + form side) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -right-[10%] -top-[10%] h-[40vh] w-[40vh] rounded-full blur-[120px]"
            style={{ background: 'radial-gradient(circle, rgba(102,126,234,0.12) 0%, transparent 70%)' }}
          />
          <div
            className="absolute -bottom-[10%] left-[5%] h-[35vh] w-[35vh] rounded-full blur-[120px]"
            style={{ background: 'radial-gradient(circle, rgba(175,82,222,0.10) 0%, transparent 70%)' }}
          />
        </div>

        {/* Top bar (logo on mobile + locale) */}
        <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10 lg:hidden">
          <Link href={`/${locale}`} className="inline-flex items-center gap-2.5">
            <BrandMark size={36} />
            <span
              className="text-lg font-extrabold tracking-tight text-ink-strong"
              style={{ letterSpacing: '-0.025em' }}
            >
              Bilgim
            </span>
          </Link>
        </header>

        {/* Card */}
        <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-12">
          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
            // Once the entrance animation settles, drop the inline `transform`.
            // Chrome disables LCD/subpixel text antialiasing on any element
            // promoted to its own compositing layer by a transform, which
            // otherwise leaves the card's text looking permanently blurry.
            onAnimationComplete={() => {
              if (cardRef.current) cardRef.current.style.transform = 'none';
            }}
            className="w-full max-w-md"
          >
            <Link
              href={`/${locale}`}
              className="mb-6 hidden items-center gap-2.5 lg:inline-flex"
            >
              <BrandMark size={36} />
              <span
                className="text-lg font-extrabold tracking-tight text-ink-strong"
                style={{ letterSpacing: '-0.025em' }}
              >
                Bilgim
              </span>
            </Link>

            <div
              className="rounded-3xl border border-rim bg-canvas p-7 sm:p-9"
              style={{
                boxShadow:
                  '0 1px 3px rgba(0,0,0,0.04), 0 24px 64px -24px rgba(0,0,0,0.12)',
              }}
            >
              {children}
            </div>

            {footer !== 'none' && (
              <div className="mt-6 text-center text-sm text-ink-soft">
                {footer === 'signup' ? (
                  <>
                    Akkauntingiz yo&apos;qmi?{' '}
                    <Link
                      href={`/${locale}/register`}
                      className="font-semibold text-blue underline-offset-4 hover:underline"
                    >
                      Ro&apos;yxatdan o&apos;tish
                    </Link>
                  </>
                ) : (
                  <>
                    Akkauntingiz bormi?{' '}
                    <Link
                      href={`/${locale}/login`}
                      className="font-semibold text-blue underline-offset-4 hover:underline"
                    >
                      Kirish
                    </Link>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </main>

        <footer className="relative z-10 px-6 py-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/50 sm:px-10">
          © {new Date().getFullYear()} Bilgim · O&apos;zbekiston uchun ingliz tili platformasi
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Brand panel — gradient, live-class mockup, highlights
// ─────────────────────────────────────────────────────────────────

const HIGHLIGHTS = [
  {
    title: 'Jonli ingliz tili darslari',
    desc: '500 talabagacha bir vaqtda, avtomatik yozib olinadi',
  },
  {
    title: 'AI yordamchi',
    desc: 'Grammatikani tushuntiradi va misol beradi — javobni yozib bermaydi',
  },
  {
    title: 'Payme bilan to\'lov',
    desc: 'Obuna, qaytarish va batafsil moliyaviy hisobotlar',
  },
];

function BrandPanel({ locale }: { locale: string }) {
  return (
    <div
      className="relative hidden overflow-hidden lg:flex lg:w-[48%] xl:w-[54%]"
      style={{
        background:
          'linear-gradient(150deg, #4F46E5 0%, #667EEA 35%, #764BA2 70%, #8B5CF6 100%)',
      }}
    >
      {/* Dark overlay for better text contrast */}
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />

      {/* Ambient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-[10%] top-[5%] h-[50vh] w-[50vh] rounded-full blur-[120px]"
          style={{ background: 'rgba(255,255,255,0.14)' }}
        />
        <div
          className="absolute bottom-[5%] right-[5%] h-[40vh] w-[40vh] rounded-full blur-[120px]"
          style={{ background: 'rgba(175,82,222,0.35)' }}
        />
      </div>

      {/* Dot grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      />

      <div className="relative z-10 flex w-full flex-col px-12 py-12 xl:px-16">
        {/* Logo */}
        <Link href={`/${locale}`} className="inline-flex items-center gap-2.5 self-start">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15">
            <Logo />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-white" style={{ letterSpacing: '-0.025em' }}>
            Bilgim
          </span>
        </Link>

        {/* Headline */}
        <div className="mt-16 max-w-md">
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-display text-4xl font-extrabold leading-[1.05] text-white xl:text-5xl"
            style={{ 
              letterSpacing: '-0.04em',
              textShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            Ingliz tilini{' '}
            <span className="italic">o&apos;rganing</span> va o&apos;rgating
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-4 text-base leading-relaxed text-white/90"
          >
            O&apos;zbekistonning zamonaviy onlayn ingliz tili platformasi.
            O&apos;qituvchi, talaba va AI yordamchi — bitta ekosistemada.
          </motion.p>
        </div>

        {/* Highlights — directly under the headline for tighter visual rhythm */}
        <div className="mt-10 space-y-3">
          {HIGHLIGHTS.map((h, i) => (
            <motion.div
              key={h.title}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.25 + i * 0.1 }}
              className="flex items-start gap-3 rounded-2xl border border-white/30 bg-white/20 p-3.5"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white/25">
                <Check />
              </span>
              <div>
                <p className="text-sm font-bold text-white">{h.title}</p>
                <p className="mt-0.5 text-xs text-white/90 font-medium">{h.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom spacer */}
        <div className="mt-auto" />
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-white"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-white"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
