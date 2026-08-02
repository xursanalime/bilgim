'use client';

import { motion } from 'framer-motion';
import {
  Sparkles,
  GraduationCap,
  Layers,
  Search,
  Calendar,
  CreditCard,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

/**
 * FeaturesBento — spotlight feature grid.
 *
 * The live-lesson showcase now lives only in LiveShowcase (rendered right
 * after this section), so it isn't duplicated here.
 */
export function FeaturesBento() {
  return (
    <section id="features" className="relative overflow-hidden section">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-blue/[0.04] to-transparent" />

      <div className="container-page relative">
        <SectionHeader
          eyebrow="Imkoniyatlar"
          title={
            <>
              Bitta tizim,{' '}
              <span className="text-hero-gradient">cheksiz</span> imkoniyatlar
            </>
          }
          subtitle="Kursdan to'lovgacha — barcha kerakli asboblar zamonaviy va sodda interfeysda."
        />

        {/* Feature grid — spotlight cards */}
        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} {...f} index={i + 1} delay={i * 0.09} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Section header
// ─────────────────────────────────────────────────────────────────

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = 'center',
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div
      className={`max-w-3xl ${align === 'center' ? 'mx-auto text-center' : ''}`}
    >
      <motion.span
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.5 }}
        className="inline-flex items-center gap-2 rounded-full border border-rim bg-canvas px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink-soft shadow-soft"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-blue" />
        {eyebrow}
      </motion.span>
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="mt-5 text-balance font-display font-extrabold text-ink-strong"
        style={{
          fontSize: 'clamp(2rem, 4.5vw, 3.75rem)',
          letterSpacing: '-0.04em',
          lineHeight: '1.05',
        }}
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-4 text-balance text-base text-ink-soft sm:text-lg"
        >
          {subtitle}
        </motion.p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Feature grid
// ─────────────────────────────────────────────────────────────────

type Accent = 'blue' | 'green' | 'orange' | 'purple' | 'red';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  accent: Accent;
  span: string;
}

const FEATURES: Feature[] = [
  { icon: Sparkles, title: 'AI yordamchi', body: 'Tushuntiradi, javob bermaydi — 24 soat ishlaydi.', accent: 'purple', span: 'lg:col-span-3' },
  { icon: Layers, title: '10+ uy vazifa turi', body: "O'qish, yozish, eshitish, gapirish.", accent: 'green', span: 'lg:col-span-3' },
  { icon: GraduationCap, title: 'Cheksiz kurs va guruh', body: 'Talabalar progressi va statistika bir joyda.', accent: 'orange', span: 'lg:col-span-2' },
  { icon: Search, title: 'Sizni topishadi', body: 'Ochiq sahifa va qidiruv tizimi orqali.', accent: 'green', span: 'lg:col-span-2' },
  { icon: Calendar, title: 'Avtomatik xabarnoma', body: 'Jadval o‘zgarsa, hammaga xabar boradi.', accent: 'orange', span: 'lg:col-span-2' },
  { icon: CreditCard, title: "Payme bilan to'g'ridan-to'g'ri", body: "Obuna, qaytarish va batafsil hisobotlar.", accent: 'blue', span: 'lg:col-span-3' },
  { icon: Smartphone, title: 'iOS va Android', body: 'Push xabarnoma, oflayn rejim, Telegram bot.', accent: 'purple', span: 'lg:col-span-3' },
];

const GLOW: Record<Accent, string> = {
  blue: 'rgba(0, 113, 227, 0.22)',
  green: 'rgba(0,113,227, 0.22)',
  orange: 'rgba(255, 159, 10, 0.22)',
  purple: 'rgba(175, 82, 222, 0.22)',
  red: 'rgba(255, 59, 48, 0.22)',
};

function FeatureCard({
  icon: Icon,
  title,
  body,
  accent,
  span,
  index,
  delay,
}: Feature & { index: number; delay: number }) {
  const accentClasses = {
    blue: { text: 'text-blue', tint: 'bg-blue-tint' },
    green: { text: 'text-teal', tint: 'bg-teal-tint' },
    orange: { text: 'text-orange', tint: 'bg-orange-tint' },
    purple: { text: 'text-purple', tint: 'bg-purple-tint' },
    red: { text: 'text-red', tint: 'bg-red-tint' },
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 28, scale: 0.94 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 transition-all duration-500 hover:-translate-y-1 hover:border-rim-2 hover:shadow-medium sm:p-7 ${span}`}
    >
      {/* Hover glow blob */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, ${GLOW[accent]} 0%, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${accentClasses.tint} shadow-soft transition-transform duration-500 group-hover:scale-110`}
        >
          <Icon className={`h-6 w-6 ${accentClasses.text}`} strokeWidth={2} />
        </span>
        <span className="font-mono text-[10px] font-bold text-ink-soft/50">
          {String(index).padStart(2, '0')}
        </span>
      </div>

      <h3
        className="relative mt-5 text-lg font-extrabold tracking-tight text-ink-strong"
        style={{ letterSpacing: '-0.02em' }}
      >
        {title}
      </h3>
      <p className="relative mt-1.5 text-sm leading-relaxed text-ink-soft">{body}</p>
    </motion.div>
  );
}
