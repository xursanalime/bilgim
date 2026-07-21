'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { LightPillar } from '../effects/light-pillar';
import { ParticleField } from '../effects/particle-field';

/**
 * HeroV3 — improved hero with permanent floating cards (no cursor-only reveal).
 *
 * Layout:
 *   - Full-screen dark background with light pillar + particles
 *   - Floating cards always visible at low opacity, brighten on hover
 *   - Centered headline + 2 CTAs
 *   - Scroll indicator at bottom
 */
export function HeroV3({ locale }: { locale: string }) {
  return (
    <section className="relative isolate overflow-hidden bg-ink pt-16">
      {/* ── Backdrop layers ───────────────────────────────────── */}
      <div className="absolute inset-0">
        <LightPillar hue="electric" intensity={0.85} />
      </div>

      <ParticleField
        density={45}
        color="rgba(180, 200, 255, 0.4)"
        linkColor="rgba(180, 200, 255, 0.15)"
      />

      {/* Subtle dot grid */}
      <div className="pointer-events-none absolute inset-0 bg-dots opacity-25" />

      {/* Edge vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(8,12,16,0.85) 100%)',
        }}
      />

      {/* ── Floating cards (permanently visible) ──────────────── */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="absolute inset-0 mx-auto max-w-7xl">
          {/* Top-left */}
          <FloatingCard
            className="absolute left-[2%] top-[18%]"
            tag="LIVE STREAM"
            title="English Speaking Club"
            meta="42 ishtirokchi"
            accent="green"
            delay={0.6}
          />

          {/* Top-right */}
          <FloatingCard
            className="absolute right-[2%] top-[24%]"
            tag="HOMEWORK"
            title="Reading Comp #12"
            meta="Bajarilmoqda · 60%"
            accent="blue"
            delay={0.8}
          />

          {/* Bottom-left */}
          <FloatingCard
            className="absolute bottom-[18%] left-[4%]"
            tag="SPECIALTY"
            title="Math · 5-sinf"
            meta="248 talaba"
            accent="purple"
            delay={1.0}
          />

          {/* Bottom-right */}
          <FloatingCard
            className="absolute bottom-[22%] right-[4%]"
            tag="AI TUTOR"
            title="Vazifa tushuntirish"
            meta="24/7 mavjud"
            accent="green"
            delay={1.2}
          />

          {/* Mid-right small */}
          <FloatingCard
            className="absolute right-[10%] top-[52%]"
            tag="CHAT"
            title="Sefer · Group"
            meta="6 yangi xabar"
            small
            accent="blue"
            delay={1.4}
          />

          {/* Mid-left small */}
          <FloatingCard
            className="absolute left-[8%] top-[55%]"
            tag="SCHEDULE"
            title="14:00 · Algebra"
            meta="20 daqiqada"
            small
            accent="purple"
            delay={1.6}
          />
        </div>
      </div>

      {/* ── Center content (always visible, top z-index) ──────── */}
      <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-7xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8 lg:py-24">
        {/* Top badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 py-1.5 backdrop-blur-md"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent2-500" />
          </span>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-cream">
            Yangi · O&apos;zbekiston uchun
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="mt-7 text-balance font-extrabold leading-[0.95] text-cream"
          style={{
            fontSize: 'clamp(2.5rem, 6.5vw, 6rem)',
            letterSpacing: '-0.045em',
            fontWeight: 900,
          }}
        >
          O&apos;qiting,{' '}
          <span className="relative inline-block">
            <span
              className="relative z-10"
              style={{
                background:
                  'linear-gradient(135deg, #00E87A 0%, #B3FFD8 50%, #F5F2EC 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              o&apos;rganing
            </span>
            <svg
              className="absolute -bottom-2 left-0 w-full"
              viewBox="0 0 200 12"
              fill="none"
              aria-hidden
            >
              <path
                d="M2 8 Q 50 2 100 6 T 198 4"
                stroke="rgba(0, 232, 122, 0.6)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <br />
          va rivojlaning.
        </motion.h1>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-cream-dim sm:text-lg md:text-xl"
        >
          O&apos;zbekistondagi yetakchi onlayn ta&apos;lim platformasi —
          kurslar, jonli efir, AI yordamchi, vazifa baholash va to&apos;lov
          tizimi bir joyda.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
        >
          <Link
            href={`/${locale}/register?role=teacher`}
            className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-accent2-500 px-7 py-4 text-sm font-bold text-ink transition-all hover:bg-accent2-400 active:scale-[0.98]"
            style={{
              boxShadow:
                '0 0 0 1px rgba(0,232,122,0.5), 0 12px 40px -12px rgba(0,232,122,0.7), 0 0 60px -20px rgba(0,232,122,0.9)',
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
            href="#how-it-works"
            className="group inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-7 py-4 text-sm font-semibold text-cream backdrop-blur-md transition-all hover:border-white/[0.25] hover:bg-white/[0.08]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
              <svg
                className="h-3 w-3 translate-x-[1px]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </span>
            Demo ko&apos;rish
          </Link>
        </motion.div>

        {/* Trust indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-cream-dim"
        >
          <span className="flex items-center gap-1.5">
            <CheckIcon /> Karta kerak emas
          </span>
          <span className="flex items-center gap-1.5">
            <CheckIcon /> 5 daqiqada sozlash
          </span>
          <span className="flex items-center gap-1.5">
            <CheckIcon /> O&apos;zbek tilida
          </span>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.7 }}
          transition={{ duration: 1, delay: 1.2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <div className="flex flex-col items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-dim/60">
              Pastga harakatlaning
            </span>
            <div className="flex h-8 w-5 items-start justify-center rounded-full border border-cream-dim/40 p-1">
              <span
                className="h-1.5 w-1 rounded-full bg-cream-dim/80"
                style={{
                  animation: 'scroll-hint 2s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        </motion.div>
      </div>

      <style jsx>{`
        @keyframes scroll-hint {
          0%,
          100% {
            transform: translateY(0);
            opacity: 1;
          }
          50% {
            transform: translateY(8px);
            opacity: 0.3;
          }
        }
      `}</style>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────

function FloatingCard({
  tag,
  title,
  meta,
  accent,
  small,
  className = '',
  delay = 0,
}: {
  tag: string;
  title: string;
  meta: string;
  accent: 'green' | 'blue' | 'purple';
  small?: boolean;
  className?: string;
  delay?: number;
}) {
  const accentColors = {
    green: { dot: '#00E87A', glow: 'rgba(0,232,122,0.4)' },
    blue: { dot: '#5BA8FF', glow: 'rgba(91,168,255,0.4)' },
    purple: { dot: '#A78BFA', glow: 'rgba(167,139,250,0.4)' },
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
      className={`pointer-events-auto ${className} ${
        small ? 'w-[180px]' : 'w-[240px]'
      }`}
      style={{
        animation: `float-card ${6 + Math.random() * 4}s ease-in-out ${delay}s infinite`,
      }}
    >
      <div
        className="group relative cursor-default rounded-2xl border border-white/[0.1] bg-ink-surface/50 p-4 backdrop-blur-md transition-all duration-300 hover:border-white/[0.18] hover:bg-ink-surface/70"
        style={{
          boxShadow: `0 0 0 1px rgba(255,255,255,0.05), 0 20px 50px -20px ${accentColors.glow}`,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: accentColors.dot,
              boxShadow: `0 0 8px ${accentColors.glow}`,
            }}
          />
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-cream-dim">
            {tag}
          </span>
        </div>
        <p
          className={`mt-2 truncate font-extrabold tracking-tight text-cream ${
            small ? 'text-xs' : 'text-sm'
          }`}
          style={{ letterSpacing: '-0.02em' }}
        >
          {title}
        </p>
        <p
          className={`mt-1 text-cream-dim ${small ? 'text-[10px]' : 'text-xs'}`}
        >
          {meta}
        </p>
      </div>

      <style jsx>{`
        @keyframes float-card {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
      `}</style>
    </motion.div>
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
