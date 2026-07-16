'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  Tv2,
  Sparkles,
  GraduationCap,
  Layers,
  Search,
  Calendar,
  CreditCard,
  Smartphone,
  Users,
  ScreenShare,
  MessageCircle,
  CheckCircle2,
  Star,
  Bell,
  Mic,
  Video,
  type LucideIcon,
} from 'lucide-react';

/**
 * FeaturesBento — 8-tile bento grid, Apple light theme.
 *
 * Plain Uzbek copy (no jargon). Lucide icons (no emojis).
 */
export function FeaturesBento() {
  return (
    <section
      id="features"
      className="relative overflow-hidden section"
    >
      {/* Soft top tint */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-blue/[0.04] to-transparent" />

      <div className="container-aurora relative">
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

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6 md:gap-5">
          {/* HERO — Live (4×2) */}
          <BentoTile
            className="md:col-span-4 md:row-span-2"
            tag="JONLI DARSLAR"
            title="Sinfdek tajriba, lekin onlayn"
            body="500 talabagacha bir vaqtda. Kechikishsiz video va ovoz. Har bir dars avtomatik yozib olinadi."
            accent="purple"
            big
            icon={Tv2}
            mockup={<LiveMockup />}
          />

          {/* AI Tutor */}
          <BentoTile
            className="md:col-span-2"
            tag="AI YORDAMCHI"
            title="Tushuntiradi, javob bermaydi"
            body="Aqlli yordamchi 24 soat ishlaydi."
            accent="purple"
            icon={Sparkles}
            mockup={<AiMockup />}
          />

          {/* Homework */}
          <BentoTile
            className="md:col-span-2"
            tag="UY VAZIFA"
            title="10+ vazifa turlari"
            body="O'qish, yozish, eshitish, gapirish..."
            accent="green"
            icon={Layers}
            mockup={<HomeworkMockup />}
          />

          {/* Course */}
          <BentoTile
            className="md:col-span-2"
            tag="KURS BOSHQARUV"
            title="Cheksiz kurs va guruh"
            body="Talabalar progressi va statistika."
            accent="orange"
            icon={GraduationCap}
            mockup={<CourseMockup />}
          />

          {/* Discovery */}
          <BentoTile
            className="md:col-span-2"
            tag="QIDIRUV"
            title="Sizni topishadi"
            body="Ochiq sahifa va qidiruv tizimi."
            accent="green"
            icon={Search}
            mockup={<DiscoveryMockup />}
          />

          {/* Schedule */}
          <BentoTile
            className="md:col-span-2"
            tag="JADVAL"
            title="Avtomatik xabarnoma"
            body="O'zgartirsangiz hammaga xabar boradi."
            accent="orange"
            icon={Calendar}
            mockup={<ScheduleMockup />}
          />

          {/* Payments */}
          <BentoTile
            className="md:col-span-3"
            tag="TO'LOVLAR"
            title="Payme bilan to'g'ridan-to'g'ri"
            body="Obuna, qaytarish va batafsil hisobotlar."
            accent="orange"
            icon={CreditCard}
            mockup={<PaymentsMockup />}
          />

          {/* Mobile */}
          <BentoTile
            className="md:col-span-3"
            tag="MOBIL ILOVA"
            title="iOS va Android"
            body="Push xabarnoma, oflayn rejimda dars ko'rish, Telegram bot."
            accent="purple"
            icon={Smartphone}
            mockup={<MobileMockup />}
          />
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
// Bento tile
// ─────────────────────────────────────────────────────────────────

type Accent = 'blue' | 'green' | 'orange' | 'purple' | 'red';

function BentoTile({
  className = '',
  tag,
  title,
  body,
  accent,
  big,
  icon: Icon,
  mockup,
}: {
  className?: string;
  tag: string;
  title: string;
  body: string;
  accent: Accent;
  big?: boolean;
  icon: LucideIcon;
  mockup: React.ReactNode;
}) {
  const accentClasses = {
    blue: { dot: 'bg-blue', text: 'text-blue', tint: 'bg-blue-tint' },
    green: { dot: 'bg-green', text: 'text-green', tint: 'bg-green-tint' },
    orange: { dot: 'bg-orange', text: 'text-orange', tint: 'bg-orange-tint' },
    purple: { dot: 'bg-purple', text: 'text-purple', tint: 'bg-purple-tint' },
    red: { dot: 'bg-red', text: 'text-red', tint: 'bg-red-tint' },
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5 }}
      className={`group relative flex h-full flex-col overflow-hidden rounded-3xl border border-rim bg-canvas backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:border-rim-2 hover:shadow-medium ${className}`}
      style={{
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px -12px rgba(0, 0, 0, 0.06)',
      }}
    >
      {/* Mockup area */}
      <div
        className={`relative flex-1 overflow-hidden ${big ? 'min-h-[280px]' : 'min-h-[160px]'}`}
      >
        <div className="absolute inset-0 flex items-center justify-center p-6">
          {mockup}
        </div>
        {/* Bottom fade */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      {/* Text */}
      <div className="relative space-y-2 p-6 pt-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ${accentClasses.tint}`}>
            <Icon className={`h-3.5 w-3.5 ${accentClasses.text}`} strokeWidth={2.25} />
          </span>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-ink-soft">
            {tag}
          </span>
        </div>
        <h3
          className={`font-extrabold tracking-tight text-ink-strong ${
            big ? 'text-2xl sm:text-3xl' : 'text-lg'
          }`}
          style={{ letterSpacing: '-0.025em', lineHeight: '1.15' }}
        >
          {title}
        </h3>
        <p
          className={`leading-relaxed text-ink-soft ${
            big ? 'text-base' : 'text-sm'
          }`}
        >
          {body}
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Mockups
// ─────────────────────────────────────────────────────────────────

function LiveMockup() {
  return (
    <div className="relative h-full w-full">
      {/* Concentric pulse rings */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-purple/30"
          style={{
            animation: `ripple 4s ease-out ${i * 1.3}s infinite`,
            opacity: 0,
          }}
        />
      ))}

      {/* Stage card */}
      <div className="relative mx-auto w-full max-w-[420px]">
        <div className="overflow-hidden rounded-2xl border border-rim bg-canvas shadow-medium">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-rim bg-canvas px-3 py-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
              <span className="relative h-2 w-2 rounded-full bg-red" />
            </span>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-red">
              Efirda
            </span>
            <span className="ml-2 text-[11px] font-semibold text-ink-strong">
              Ingliz tili · 5-sinf
            </span>
            <span className="ml-auto flex items-center gap-1 font-mono text-[9px] text-ink-soft">
              <Users className="h-3 w-3" /> 42
            </span>
          </div>

          {/* Stage with real video */}
          <div className="relative aspect-[16/10] bg-gradient-to-br from-blue-tint via-canvas to-purple-tint">
            <Image
              src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=800&q=80"
              alt="Teacher"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover opacity-90"
            />
            {/* Vignette */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />

            {/* Right thumbs */}
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
              {[
                'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=200&q=80',
                'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
                'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
              ].map((src, i) => (
                <div
                  key={i}
                  className="relative h-10 w-14 overflow-hidden rounded border-2 border-white/80"
                >
                  <Image src={src} alt="" fill sizes="56px" className="object-cover" />
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 border-t border-rim bg-canvas px-3 py-2">
            {[Mic, Video, ScreenShare, MessageCircle].map((I, i) => (
              <span
                key={i}
                className={`flex h-7 w-7 items-center justify-center rounded-full ${
                  i < 2 ? 'bg-blue-tint text-blue' : 'bg-soft text-ink-soft'
                }`}
              >
                <I className="h-3.5 w-3.5" />
              </span>
            ))}
            <span className="ml-auto rounded-full bg-red px-3 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.15em] text-white">
              Tugatish
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AiMockup() {
  return (
    <div className="w-full space-y-2">
      {/* Student msg */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-tint px-3 py-2 text-[11px] text-blue">
          Past tense ni tushuntiring
        </div>
      </div>
      {/* AI msg */}
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple">
          <Sparkles className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
        </span>
        <div className="flex-1 rounded-2xl rounded-tl-sm border border-purple/15 bg-purple-tint px-3 py-2 text-[11px] leading-relaxed text-ink-strong">
          O&apos;tgan zamon — bo&apos;lib o&apos;tgan harakatni ifodalaydi...
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-1 font-mono text-[8px] uppercase tracking-[0.15em] text-purple">
        <span className="h-1 w-1 animate-pulse rounded-full bg-purple" />
        AI yozmoqda
      </div>
    </div>
  );
}

function HomeworkMockup() {
  const modules = [
    { name: 'Reading', dot: 'bg-blue' },
    { name: 'Writing', dot: 'bg-orange' },
    { name: 'Listening', dot: 'bg-purple' },
    { name: 'Speaking', dot: 'bg-green' },
  ];
  return (
    <div className="grid w-full grid-cols-2 gap-1.5">
      {modules.map((m, i) => (
        <motion.div
          key={m.name}
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.08 }}
          className="flex items-center gap-2 rounded-lg border border-rim bg-tint px-2 py-1.5"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          <span className="text-[10px] font-medium text-ink-strong">{m.name}</span>
        </motion.div>
      ))}
      <div className="col-span-2 flex items-center justify-center rounded-lg border border-dashed border-rim-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-ink-soft">
        + 6 boshqa
      </div>
    </div>
  );
}

function CourseMockup() {
  const courses = [
    { name: 'English Beginner', students: 24, progress: 80, gradient: 'from-blue-400 to-blue-600' },
    { name: 'IELTS Intensive', students: 38, progress: 60, gradient: 'from-green-400 to-green-600' },
    { name: 'Business English', students: 16, progress: 30, gradient: 'from-purple-400 to-purple-600' },
  ];
  return (
    <div className="w-full space-y-1.5">
      {courses.map((c, i) => (
        <motion.div
          key={c.name}
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.1 }}
          className="flex items-center gap-2 rounded-lg border border-rim bg-tint px-2 py-1.5"
        >
          <div className={`h-6 w-6 rounded-md bg-gradient-to-br ${c.gradient}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-bold text-ink-strong">{c.name}</p>
            <p className="font-mono text-[8px] text-ink-soft">
              {c.students} talaba
            </p>
          </div>
          <span className="font-mono text-[9px] font-bold text-green">
            {c.progress}%
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function DiscoveryMockup() {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-full border border-rim bg-tint px-3 py-1.5">
        <Search className="h-3 w-3 text-ink-soft" />
        <span className="text-[10px] text-ink-soft">English teacher</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {[
          { color: 'from-blue-400 to-blue-600', rating: 4.9 },
          { color: 'from-green-400 to-green-600', rating: 4.8 },
          { color: 'from-purple-400 to-purple-600', rating: 4.9 },
        ].map((t, i) => (
          <div key={i} className="rounded-lg border border-rim bg-tint p-1.5">
            <div
              className={`mx-auto h-8 w-8 rounded-full bg-gradient-to-br ${t.color}`}
            />
            <p className="mt-1 flex items-center justify-center gap-0.5 font-mono text-[8px] text-orange">
              <Star className="h-2 w-2 fill-orange" strokeWidth={0} /> {t.rating}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleMockup() {
  const days = ['Du', 'Se', 'Ch', 'Pa', 'Ju'];
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.15em] text-ink-soft">
        <span>May 2026</span>
        <span className="text-orange">14:00</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {days.map((d, i) => (
          <div
            key={d}
            className={`flex flex-col items-center rounded-md py-1.5 ${
              i === 1
                ? 'bg-orange-tint ring-1 ring-orange/30'
                : 'bg-tint'
            }`}
          >
            <span className="text-[8px] text-ink-soft">{d}</span>
            <span
              className={`text-[10px] font-bold ${
                i === 1 ? 'text-orange' : 'text-ink-strong'
              }`}
            >
              {25 + i}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 rounded-md bg-orange-tint px-2 py-1">
        <span className="h-1 w-1 rounded-full bg-orange" />
        <p className="text-[9px] font-bold text-ink-strong">Ingliz tili · Sefer guruhi</p>
      </div>
    </div>
  );
}

function PaymentsMockup() {
  return (
    <div className="w-full max-w-xs">
      <div className="rounded-2xl border border-rim bg-tint p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-soft">
            Bu oyda
          </span>
          <span className="rounded-full bg-green-tint px-1.5 py-0.5 font-mono text-[8px] font-bold text-green">
            +24%
          </span>
        </div>
        <p
          className="mt-1 font-extrabold text-ink-strong"
          style={{ fontSize: '24px', letterSpacing: '-0.04em' }}
        >
          12.4M{' '}
          <span className="font-mono text-[10px] text-ink-soft">UZS</span>
        </p>
        <div className="mt-2 flex h-8 items-end gap-1">
          {[40, 65, 30, 80, 55, 90, 70].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-gradient-to-t from-orange-300 to-orange"
              style={{
                height: `${h}%`,
                animation: `bar-rise 1s cubic-bezier(0.4, 0, 0.2, 1) ${i * 0.1}s backwards`,
              }}
            />
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes bar-rise {
          from { height: 0% !important; }
        }
      `}</style>
    </div>
  );
}

function MobileMockup() {
  return (
    <div className="relative flex w-full justify-center">
      {/* Phone frame */}
      <div className="relative h-44 w-24 overflow-hidden rounded-[1.5rem] border-2 border-rim-2 bg-gradient-to-br from-canvas to-tint shadow-medium">
        <div className="absolute left-1/2 top-1 h-2 w-10 -translate-x-1/2 rounded-full bg-ink-strong/20" />
        <div className="absolute inset-x-1 top-3 bottom-1 overflow-hidden rounded-2xl bg-canvas">
          <div className="flex items-center justify-between border-b border-rim px-2 py-1.5">
            <span className="text-[7px] font-bold text-ink-strong">Bilgim</span>
            <span className="h-1 w-1 rounded-full bg-green" />
          </div>
          <div className="m-1.5 rounded-lg border border-rim bg-tint p-1.5">
            <div className="h-8 rounded bg-gradient-to-br from-purple-300 to-blue-300" />
            <p className="mt-1 text-[7px] font-bold text-ink-strong">English #12</p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-soft">
              <div className="h-full w-3/5 bg-green" />
            </div>
          </div>
          <div className="m-1.5 mt-0 flex items-center gap-1 rounded-lg bg-orange-tint px-1.5 py-1">
            <Bell className="h-2 w-2 text-orange" />
            <p className="text-[7px] font-medium text-ink-strong">14:00 da dars</p>
          </div>
        </div>
      </div>
      {/* Push notification floating */}
      <motion.div
        initial={{ opacity: 0, x: 20, y: -20 }}
        whileInView={{ opacity: 1, x: 0, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.6 }}
        className="liquid-glass-strong absolute -right-4 top-2 flex items-center gap-1.5 rounded-xl px-2 py-1.5"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue">
          <Bell className="h-2 w-2 text-white" strokeWidth={2.5} />
        </span>
        <span className="font-mono text-[7px] uppercase tracking-[0.15em] text-ink-soft">
          Push
        </span>
      </motion.div>
    </div>
  );
}
