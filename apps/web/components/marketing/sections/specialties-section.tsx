'use client';

import { motion } from 'framer-motion';

/**
 * SpecialtiesSection — yo'nalishlar (English, Math, IT, ...).
 *
 * Onboarding kvizidan kelib chiqib, har bir o'qituvchi bitta specialty ga
 * tegishli bo'ladi. Har bir specialty — 10 tagacha homework module turini
 * o'z ichiga oladi.
 */
export function SpecialtiesSection() {
  return (
    <section className="relative overflow-hidden bg-ink py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid items-end gap-8 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
              Yo&apos;nalishlar
            </span>
            <h2
              className="mt-5 text-balance font-extrabold tracking-tight text-cream"
              style={{
                fontSize: 'clamp(2.25rem, 5vw, 4rem)',
                letterSpacing: '-0.04em',
              }}
            >
              Har <span className="text-accent2-500">fan</span> uchun
              <br />
              maxsus tizim.
            </h2>
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-base text-cream-dim sm:text-lg md:justify-self-end md:max-w-md"
          >
            Onboarding kvizi orqali sizga eng mos yo&apos;nalish belgilanadi.
            Har bir yo&apos;nalish — o&apos;ziga xos modul, vazifa va analitika
            bilan jihozlangan.
          </motion.p>
        </div>

        {/* Specialty grid */}
        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {SPECIALTIES.map((s, i) => (
            <SpecialtyCard key={s.name} {...s} delay={i * 0.05} />
          ))}
        </div>

        {/* Bottom note */}
        <div className="mt-10 flex items-center justify-center gap-3">
          <div className="h-px w-12 bg-white/[0.08]" />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream-dim">
            Va ko&apos;p boshqalar
          </p>
          <div className="h-px w-12 bg-white/[0.08]" />
        </div>
      </div>
    </section>
  );
}

const SPECIALTIES = [
  { name: 'English', emoji: '🇬🇧', count: '4 modul', color: 'rgba(91,168,255,0.4)' },
  { name: 'Math', emoji: '∫', count: '6 modul', color: 'rgba(0,232,122,0.4)' },
  { name: 'IT / Coding', emoji: '⌨️', count: '5 modul', color: 'rgba(167,139,250,0.4)' },
  { name: 'SMM', emoji: '📱', count: '4 modul', color: 'rgba(251,146,60,0.4)' },
  { name: 'Russian', emoji: '🇷🇺', count: '5 modul', color: 'rgba(220,38,38,0.4)' },
  { name: 'Physics', emoji: '⚛️', count: '4 modul', color: 'rgba(34,211,238,0.4)' },
  { name: 'Chemistry', emoji: '🧪', count: '4 modul', color: 'rgba(168,85,247,0.4)' },
  { name: 'Biology', emoji: '🧬', count: '4 modul', color: 'rgba(34,197,94,0.4)' },
  { name: 'Korean', emoji: '🇰🇷', count: '4 modul', color: 'rgba(244,63,94,0.4)' },
  { name: 'Design', emoji: '🎨', count: '5 modul', color: 'rgba(236,72,153,0.4)' },
  { name: 'Business', emoji: '💼', count: '5 modul', color: 'rgba(245,158,11,0.4)' },
  { name: 'IELTS', emoji: '🎯', count: '4 modul', color: 'rgba(0,232,122,0.4)' },
];

function SpecialtyCard({
  name,
  emoji,
  count,
  color,
  delay,
}: {
  name: string;
  emoji: string;
  count: string;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay }}
    >
      <div
        className="group relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-surface/40 p-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.18] hover:bg-ink-surface/70"
        style={{
          boxShadow: `0 0 0 1px rgba(255,255,255,0.04)`,
        }}
      >
        {/* Hover glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(circle at center, ${color} 0%, transparent 70%)`,
          }}
        />

        <span
          className="relative z-10 transition-transform duration-300 group-hover:scale-110"
          style={{ fontSize: '32px' }}
        >
          {emoji}
        </span>
        <p
          className="relative z-10 text-center text-sm font-extrabold tracking-tight text-cream"
          style={{ letterSpacing: '-0.02em' }}
        >
          {name}
        </p>
        <p className="relative z-10 font-mono text-[9px] uppercase tracking-[0.15em] text-cream-dim">
          {count}
        </p>
      </div>
    </motion.div>
  );
}
