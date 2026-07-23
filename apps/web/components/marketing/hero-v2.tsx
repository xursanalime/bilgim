'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { LightPillar } from './effects/light-pillar';
import { ParticleField } from './effects/particle-field';
import { RevealOnCursor } from './effects/reveal-on-cursor';

/**
 * HeroV2 — yangi kreativ hero seksiyasi.
 *
 * Tarkibi:
 *   - Markaziy light pillar (Huly stilida)
 *   - Sichqoncha bilan reveal qilinadigan glass kartochkalar
 *   - Particle fon
 *   - Asosiy headline + 2 CTA tugma
 *
 * Mavjud HeroVisual o'rniga ishlatiladi.
 */
export function HeroV2({ locale }: { locale: string }): JSX.Element {
  return (
    <section className="relative isolate overflow-hidden bg-ink">
      {/* ── Backdrop layers ───────────────────────────────────── */}
      {/* Vertical light pillar */}
      <div className="absolute inset-0">
        <LightPillar hue="electric" intensity={0.85} />
      </div>

      {/* Particle field */}
      <ParticleField
        density={50}
        color="rgba(180, 200, 255, 0.45)"
        linkColor="rgba(180, 200, 255, 0.18)"
      />

      {/* Subtle dot grid */}
      <div className="pointer-events-none absolute inset-0 bg-dots opacity-30" />

      {/* Vignette — edges fade to ink */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(8,12,16,0.85) 100%)',
        }}
      />

      {/* ── Reveal-on-cursor floating cards ───────────────────── */}
      <RevealOnCursor
        radius={320}
        baseOpacity={0.08}
        className="absolute inset-0"
      >
        <div className="absolute inset-0 mx-auto max-w-7xl">
          {/* Top-left card */}
          <FloatingCard
            className="absolute left-[6%] top-[12%]"
            tag="LIVE STREAM"
            title="English Speaking Club"
            meta="42 ishtirokchi"
            accent="green"
          />

          {/* Top-right card */}
          <FloatingCard
            className="absolute right-[6%] top-[18%]"
            tag="HOMEWORK"
            title="Reading Comprehension #12"
            meta="Bajarilmoqda · 60%"
            accent="blue"
          />

          {/* Bottom-left card */}
          <FloatingCard
            className="absolute bottom-[16%] left-[8%]"
            tag="SPECIALTY"
            title="Math · 5-sinf"
            meta="248 talaba"
            accent="purple"
          />

          {/* Bottom-right card */}
          <FloatingCard
            className="absolute bottom-[20%] right-[8%]"
            tag="AI TUTOR"
            title="Vazifa tushuntirish"
            meta="24/7 mavjud"
            accent="green"
          />

          {/* Mid-right small */}
          <FloatingCard
            className="absolute right-[14%] top-[48%]"
            tag="CHAT"
            title="Sefer · Group"
            meta="6 yangi xabar"
            small
            accent="blue"
          />

          {/* Mid-left small */}
          <FloatingCard
            className="absolute left-[12%] top-[52%]"
            tag="SCHEDULE"
            title="14:00 · Algebra"
            meta="20 daqiqada"
            small
            accent="purple"
          />
        </div>
      </RevealOnCursor>

      {/* ── Foreground content ─────────────────────────────────── */}
      <div className="relative mx-auto flex min-h-[88vh] max-w-7xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6 lg:px-8">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-1.5 backdrop-blur-md"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent2-500" />
          </span>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-cream">
            Yangi · O&apos;zbekiston uchun ta&apos;lim platformasi
          </span>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="mt-8 text-balance font-extrabold leading-[0.95] text-cream"
          style={{
            fontSize: 'clamp(2.75rem, 7vw, 6.5rem)',
            letterSpacing: '-0.045em',
            fontWeight: 900,
          }}
        >
          Bilim,{' '}
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
              o&apos;rganish
            </span>
            <svg
              className="absolute -bottom-2 left-0 w-full"
              viewBox="0 0 200 12"
              fill="none"
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
          va ulanish — bir joyda.
        </motion.h1>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mt-7 max-w-2xl text-balance text-base leading-relaxed text-cream-dim sm:text-lg md:text-xl"
        >
          Bilgim — o&apos;qituvchilar va talabalarni bog&apos;lovchi aqlli
          platforma. Jonli efir, AI yordamchi, vazifa baholash, ko&apos;p
          modulli ta&apos;lim — bir tizimda.
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
                '0 0 0 1px rgba(0,232,122,0.5), 0 12px 40px -12px rgba(0,232,122,0.6), 0 0 60px -20px rgba(0,232,122,0.8)',
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
            {/* Shine sweep */}
            <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </Link>

          <Link
            href={`/${locale}/discover`}
            className="group inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] bg-white/[0.04] px-7 py-4 text-sm font-semibold text-cream backdrop-blur-md transition-all hover:border-white/[0.25] hover:bg-white/[0.08]"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            O&apos;qituvchilarni topish
          </Link>
        </motion.div>

        {/* Helper text */}
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
            <CheckIcon /> PC, mobil, telegram
          </span>
        </motion.div>

        {/* Hint to interact */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: 1, delay: 1.2 }}
          className="mt-16 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.25em] text-cream-dim/60"
        >
          <span className="h-px w-8 bg-cream-dim/30" />
          <span>Sichqoncha bilan harakatlanib ko&apos;ring</span>
          <span className="h-px w-8 bg-cream-dim/30" />
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Floating reveal card
// ─────────────────────────────────────────────────────────────────

function FloatingCard({
  tag,
  title,
  meta,
  accent,
  small,
  className = '',
}: {
  tag: string;
  title: string;
  meta: string;
  accent: 'green' | 'blue' | 'purple';
  small?: boolean;
  className?: string;
}) {
  const accentColors = {
    green: { dot: '#00E87A', glow: 'rgba(0,232,122,0.4)' },
    blue: { dot: '#5BA8FF', glow: 'rgba(91,168,255,0.4)' },
    purple: { dot: '#A78BFA', glow: 'rgba(167,139,250,0.4)' },
  }[accent];

  return (
    <div
      className={`group ${className} ${small ? 'w-[180px]' : 'w-[260px]'}`}
      style={{
        animation: `float-card ${6 + Math.random() * 4}s ease-in-out infinite`,
      }}
    >
      <div
        className="relative rounded-2xl border border-white/[0.1] bg-white/[0.02] p-4 backdrop-blur-md"
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
            transform: translateY(-8px);
          }
        }
      `}</style>
    </div>
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
