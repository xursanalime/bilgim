'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  CalendarDays,
  Sparkles,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import { LightBeam } from './light-beam';

/**
 * Hero — Apple Liquid Glass light edition.
 *
 * Composition:
 *   - Soft gray-white background with subtle aurora orbs
 *   - Eyebrow badge (Apple pill style)
 *   - Display headline with hero gradient ("yangi" word)
 *   - Subhead in soft ink
 *   - Two CTAs: blue primary + ghost secondary
 *   - Trust strip
 *   - Right-side hero illustration (liquid glass dashboard)
 */
export function Hero({ locale, title, subtitle }: { locale: string; title?: string; subtitle?: string }) {
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-20 sm:pt-36 lg:pt-40 lg:pb-28">
      {/* Soft ambient orbs in background */}
      <Backdrop />

      {/* Vertical light beam (Huly / Antimatter signature) */}
      <LightBeam className="opacity-70" />

      {/* Subtle dot grid */}
      <div className="pointer-events-none absolute inset-0 bg-dotgrid opacity-30" />

      <div className="container-aurora relative">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-12">
          {/* LEFT — content */}
          <div className="lg:col-span-6">
            {/* Eyebrow */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="liquid-glass inline-flex items-center gap-2.5 rounded-full py-1.5 pl-2 pr-4"
            >
              <span className="flex items-center gap-1.5 rounded-full bg-blue px-2.5 py-0.5 text-white">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Beta
                </span>
              </span>
              <span className="text-xs font-medium text-ink-strong">
                O&apos;zbekiston uchun ta&apos;lim platformasi
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-7 max-w-[14ch] font-display font-extrabold leading-[1] text-ink-strong"
              style={{
                fontSize: 'clamp(2.75rem, 7vw, 5.75rem)',
                letterSpacing: '-0.045em',
              }}
            >
              <span className="block">Ta&apos;limning</span>
              <span className="relative inline-block pr-[0.15em] pb-[0.05em]">
                <span
                  className="relative z-10 italic"
                  style={{
                    background:
                      'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    paddingRight: '0.05em',
                  }}
                >
                  yangi
                </span>
                <svg
                  className="absolute -bottom-1 left-0 w-[calc(100%-0.15em)]"
                  viewBox="0 0 200 12"
                  fill="none"
                  aria-hidden
                >
                  <motion.path
                    d="M2 8 Q 50 2 100 6 T 198 4"
                    stroke="url(#hero-line)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 1, delay: 0.7 }}
                  />
                  <defs>
                    <linearGradient id="hero-line" x1="0" y1="0" x2="200" y2="0">
                      <stop offset="0%" stopColor="#667EEA" />
                      <stop offset="100%" stopColor="#764BA2" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              <span className="block">yorug&apos;ligi.</span>
            </motion.h1>

            {/* Subhead */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="mt-7 max-w-xl text-balance text-base leading-relaxed text-ink-soft sm:text-lg"
            >
              {subtitle || (
                <>
                  Kurs yarating, jonli efir o&apos;ting, AI yordamchi bilan
                  o&apos;rganing —{' '}
                  <span className="font-semibold text-ink-strong">bir tizimda</span>.
                </>
              )}
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="mt-9 flex flex-col items-start gap-3 sm:flex-row"
            >
              {/* Primary — Apple Blue */}
              <Link
                href={`/${locale}/register?role=teacher`}
                className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-blue px-7 py-3.5 text-sm font-bold text-white transition-all hover:bg-blue-600 active:scale-[0.97] sm:text-base"
                style={{
                  boxShadow:
                    '0 0 0 1px rgba(0, 113, 227, 0.4), 0 16px 48px -12px rgba(0, 113, 227, 0.5), 0 0 0 4px rgba(0, 113, 227, 0.05)',
                }}
              >
                <span className="relative z-10">14 kun bepul boshlash</span>
                <ArrowRight className="relative z-10 h-4 w-4 transition-transform group-hover:translate-x-1" />
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
              </Link>

              {/* Secondary — Liquid Glass */}
              <Link
                href="#features"
                className="liquid-glass group inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-sm font-semibold text-ink-strong transition-all hover:bg-canvas/95 sm:text-base"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-tint">
                  <svg
                    className="h-3 w-3 translate-x-[1px] text-blue"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </span>
                Demo ko&apos;rish
              </Link>
            </motion.div>

            {/* Trust */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-soft"
            >
              <span className="flex items-center gap-1.5">
                <Check /> Karta kerak emas
              </span>
              <span className="flex items-center gap-1.5">
                <Check /> 5 daqiqada
              </span>
              <span className="flex items-center gap-1.5">
                <Check /> O&apos;zbek tilida
              </span>
            </motion.div>
          </div>

          {/* RIGHT — illustration */}
          <div className="relative lg:col-span-6">
            <RightIllustration />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Backdrop — soft pastel orbs
// ─────────────────────────────────────────────────────────────────

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -left-[5%] -top-[5%] h-[65vh] w-[55vw] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(124, 58, 237, 0.28) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animation: 'float-slow 18s ease-in-out infinite',
          mixBlendMode: 'multiply',
        }}
      />
      <div
        className="absolute -right-[5%] top-[15%] h-[55vh] w-[50vw] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animation: 'float-medium 22s ease-in-out infinite',
          mixBlendMode: 'multiply',
        }}
      />
      <div
        className="absolute bottom-[0%] left-[25%] h-[45vh] w-[45vw] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.20) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animation: 'float-slow 16s ease-in-out infinite',
          mixBlendMode: 'multiply',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right illustration — liquid glass dashboard preview
// ─────────────────────────────────────────────────────────────────

function RightIllustration() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.4 }}
      className="relative h-[520px]"
    >
      {/* Main dashboard card */}
      <div
        className="liquid-glass-strong absolute inset-0 overflow-hidden rounded-3xl p-2 sm:rounded-[2rem] sm:p-3"
      >
        {/* Window header */}
        <div className="flex items-center justify-between rounded-t-2xl border-b border-rim/60 bg-canvas px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red" />
            <span className="h-2.5 w-2.5 rounded-full bg-orange" />
            <span className="h-2.5 w-2.5 rounded-full bg-green" />
          </div>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint sm:inline">
            edubridge.uz
          </span>
          <span className="rounded-full bg-green/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-green">
            Live
          </span>
        </div>

        {/* Body */}
        <div className="grid grid-cols-12 gap-2 p-3 sm:gap-3 sm:p-4">
          {/* Sidebar */}
          <div className="col-span-4 space-y-1">
            {[
              { name: 'Boshqaruv', icon: LayoutDashboard, active: true },
              { name: 'Kurslar', icon: GraduationCap },
              { name: 'Talabalar', icon: Users },
              { name: 'Jadval', icon: CalendarDays },
              { name: 'AI Tutor', icon: Sparkles },
            ].map((item) => {
              const Icon = item.icon as LucideIcon;
              return (
                <div
                  key={item.name}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                    item.active
                      ? 'bg-blue-tint text-blue'
                      : 'text-ink-soft hover:bg-soft'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
                  <span className="text-[11px] font-medium">{item.name}</span>
                </div>
              );
            })}
          </div>

          {/* Main */}
          <div className="col-span-8 space-y-2.5">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Talabalar" value="248" delta="+12" tone="green" />
              <Kpi label="Tushum" value="12.4M" delta="+24%" tone="orange" />
            </div>

            {/* Live class card */}
            <div className="rounded-xl border border-purple/20 bg-purple/[0.04] p-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
                  <span className="relative h-2 w-2 rounded-full bg-red" />
                </span>
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-red">
                  Live · 42
                </span>
              </div>
              <p className="mt-1.5 text-xs font-bold text-ink-strong">
                English Speaking
              </p>
              <div className="mt-2 flex -space-x-1.5">
                {[
                  'from-blue-400 to-blue-600',
                  'from-green-400 to-green-600',
                  'from-purple-400 to-purple-600',
                  'from-orange-400 to-orange-600',
                ].map((g, i) => (
                  <span
                    key={i}
                    className={`h-5 w-5 rounded-full border-2 border-canvas bg-gradient-to-br ${g}`}
                  />
                ))}
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-canvas bg-soft font-mono text-[8px] font-bold text-ink-soft">
                  +38
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating notification — top right */}
      <motion.div
        initial={{ opacity: 0, y: -10, x: 10 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ duration: 0.6, delay: 0.8 }}
        className="absolute -right-2 -top-4 w-[200px] sm:-right-6 sm:-top-6"
        style={{
          animation: 'float-medium 5s ease-in-out 0.5s infinite',
        }}
      >
        <div
          className="liquid-glass-strong rounded-2xl p-3"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-purple text-white" style={{ boxShadow: '0 0 12px rgba(175, 82, 222, 0.4)' }}>
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold text-ink-strong">
                AI Tutor
              </p>
              <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-ink-faint">
                hozirgina
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            Past tense ni tushuntirib bering
          </p>
        </div>
      </motion.div>

      {/* Floating notification — bottom left */}
      <motion.div
        initial={{ opacity: 0, y: 10, x: -10 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ duration: 0.6, delay: 1.0 }}
        className="absolute -bottom-4 -left-2 w-[220px] sm:-bottom-6 sm:-left-6"
        style={{
          animation: 'float-slow 6s ease-in-out 0.8s infinite',
        }}
      >
        <div
          className="liquid-glass-strong rounded-2xl p-3"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 rounded-full bg-orange-tint px-2 py-0.5">
              <span className="h-1 w-1 rounded-full bg-orange" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-orange">
                Yangi to&apos;lov
              </span>
            </span>
            <span className="font-mono text-[8px] text-ink-faint">2 daq</span>
          </div>
          <p className="mt-2 text-[11px] font-bold text-ink-strong">
            350 000 UZS
          </p>
          <p className="text-[10px] text-ink-soft">Olim K. · English course</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Kpi({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: 'green' | 'orange' | 'blue' | 'purple';
}) {
  const toneClass = {
    green: 'bg-green/10 text-green',
    orange: 'bg-orange/10 text-orange',
    blue: 'bg-blue/10 text-blue',
    purple: 'bg-purple/10 text-purple',
  }[tone];

  return (
    <div className="rounded-xl border border-rim bg-canvas p-2.5 shadow-soft">
      <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-ink-faint">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-extrabold text-ink-strong"
          style={{ fontSize: '20px', letterSpacing: '-0.04em' }}
        >
          {value}
        </span>
        <span
          className={`rounded-md px-1 py-0.5 font-mono text-[9px] font-bold ${toneClass}`}
        >
          {delta}
        </span>
      </div>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────

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
