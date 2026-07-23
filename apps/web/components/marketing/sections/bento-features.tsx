'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';

/**
 * BentoFeatures — 8-card bento grid with mixed sizes and live mockups.
 *
 * Showcases Bilgim's core capabilities at a glance:
 *   - Live streaming (large)
 *   - AI Tutor
 *   - Homework modules
 *   - Course management
 *   - Chat / DM
 *   - Schedule
 *   - Discovery
 *   - Payments
 */
export function BentoFeatures() {
  return (
    <section
      id="features"
      className="relative overflow-hidden bg-ink py-24 sm:py-32"
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-blue-500/[0.04] to-transparent" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
              Asosiy imkoniyatlar
            </span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-5 text-balance font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 5vw, 4rem)',
              letterSpacing: '-0.04em',
            }}
          >
            Bitta platforma —{' '}
            <span className="italic text-accent2-500">cheksiz</span>{' '}
            imkoniyatlar
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto mt-5 max-w-2xl text-balance text-base text-cream-dim sm:text-lg"
          >
            Kurs yaratishdan AI yordamida vazifa baholashgacha — barcha kerakli
            asboblar bir tizimda.
          </motion.p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6 md:gap-5 lg:gap-6">
          {/* 1. Live streaming — LARGE (4 cols) */}
          <BentoCard
            className="md:col-span-4 md:row-span-2"
            tag="JONLI EFIR"
            title="mediasoup SFU bilan kristal aniq efir"
            description="500+ ishtirokchi, ≤1.5s kechikish, avtomatik HLS yozish va real-time chat. Sinfdek tajriba."
            accent="blue"
            mockup={<LiveMockup />}
            big
          />

          {/* 2. AI Tutor */}
          <BentoCard
            className="md:col-span-2"
            tag="AI YORDAMCHI"
            title="Claude AI bilan 24/7 tutor"
            description="Tushuntiradi, lekin javob bermaydi. Plagiat tekshiruvi va grading."
            accent="green"
            mockup={<AiMockup />}
          />

          {/* 3. Homework modules */}
          <BentoCard
            className="md:col-span-2"
            tag="UY VAZIFA"
            title="10+ modul turlari"
            description="Reading, Writing, Listening, Speaking, Grammar, Spelling — har bir guruhga moslashtirilgan."
            accent="purple"
            mockup={<HomeworkMockup />}
          />

          {/* 4. Course management */}
          <BentoCard
            className="md:col-span-2"
            tag="KURS BOSHQARUV"
            title="Cheksiz kurs va guruh"
            description="Invite link, public sahifa, talaba progress va attendance kuzatuvi."
            accent="orange"
            mockup={<CourseMockup />}
          />

          {/* 5. Chat */}
          <BentoCard
            className="md:col-span-2"
            tag="CHAT & DM"
            title="Real-time muloqot"
            description="Guruh chat, jonli efir chat, talaba ↔ o‘qituvchi DM."
            accent="green"
            mockup={<ChatMockup />}
          />

          {/* 6. Schedule */}
          <BentoCard
            className="md:col-span-2"
            tag="JADVAL"
            title="RRULE bilan takroriy"
            description="O‘zgartirsangiz — hamma talabaga avtomatik xabarnoma."
            accent="blue"
            mockup={<ScheduleMockup />}
          />

          {/* 7. Discovery */}
          <BentoCard
            className="md:col-span-3"
            tag="DISCOVERY"
            title="Talabalar sizni topadi"
            description="Public profil sahifa, qidiruv tizimida ko‘rinish, online tarz invoy va to‘lov."
            accent="purple"
            mockup={<DiscoveryMockup />}
          />

          {/* 8. Payments */}
          <BentoCard
            className="md:col-span-3"
            tag="TO'LOVLAR"
            title="Payme bilan birlashgan"
            description="Subscription tariflari, atomik enrollment, tushum hisobotlari va refund."
            accent="orange"
            mockup={<PaymentsMockup />}
          />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────

interface BentoCardProps {
  className?: string;
  tag: string;
  title: string;
  description: string;
  accent: 'green' | 'blue' | 'purple' | 'orange';
  mockup: React.ReactNode;
  big?: boolean;
}

function BentoCard({
  className = '',
  tag,
  title,
  description,
  accent,
  mockup,
  big,
}: BentoCardProps) {
  const [hovered, setHovered] = useState(false);

  const accentRing = {
    green: 'group-hover:border-accent2-500/40',
    blue: 'group-hover:border-blue-500/40',
    purple: 'group-hover:border-purple-500/40',
    orange: 'group-hover:border-orange-500/40',
  }[accent];

  const accentGlow = {
    green: 'rgba(0,232,122,0.15)',
    blue: 'rgba(91,168,255,0.15)',
    purple: 'rgba(167,139,250,0.15)',
    orange: 'rgba(251,146,60,0.15)',
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-surface/40 backdrop-blur-sm transition-all duration-500 hover:bg-ink-surface/70 ${accentRing} ${className}`}
      style={{
        boxShadow: hovered
          ? `0 0 0 1px rgba(255,255,255,0.06), 0 30px 80px -20px ${accentGlow}`
          : '0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      {/* Mockup area */}
      <div
        className={`relative flex-1 overflow-hidden ${big ? 'min-h-[280px]' : 'min-h-[180px]'}`}
      >
        <div className="absolute inset-0 flex items-center justify-center p-6">
          {mockup}
        </div>
        {/* Gradient overlay at bottom */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-surface/80 to-transparent" />
      </div>

      {/* Text content */}
      <div className="relative p-6 pt-0">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
          {tag}
        </span>
        <h3
          className={`mt-2 font-extrabold tracking-tight text-cream ${
            big ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
          }`}
          style={{ letterSpacing: '-0.025em' }}
        >
          {title}
        </h3>
        <p
          className={`mt-2 leading-relaxed text-cream-dim ${
            big ? 'text-base' : 'text-sm'
          }`}
        >
          {description}
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Mini mockups for bento cards
// ─────────────────────────────────────────────────────────────────

function LiveMockup() {
  return (
    <div className="relative h-full w-full">
      {/* Pulse rings */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-400/40"
          style={{
            animation: `live-pulse 3s ease-out ${i * 1}s infinite`,
            opacity: 0,
          }}
        />
      ))}
      {/* Center video card */}
      <div className="relative mx-auto flex h-40 w-64 flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-blue-900/40 to-purple-900/30 sm:h-48 sm:w-80">
        <div className="flex items-center gap-2 border-b border-white/[0.07] bg-ink/50 px-3 py-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          <span className="font-mono text-[8px] font-bold uppercase tracking-[0.15em] text-cream">
            LIVE
          </span>
          <span className="ml-2 text-[10px] font-semibold text-cream">
            English Speaking
          </span>
          <span className="ml-auto font-mono text-[9px] text-cream-dim">
            42 👥
          </span>
        </div>
        <div className="relative flex flex-1 items-center justify-center">
          <div className="absolute left-[20%] top-[15%] h-12 w-12 rounded-full bg-blue-500/30 blur-xl" />
          <div className="absolute right-[20%] bottom-[15%] h-14 w-14 rounded-full bg-purple-500/25 blur-xl" />
          <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent2-500 to-accent2-700 text-2xl font-extrabold text-ink shadow-2xl">
            A
          </div>
          {/* Participant thumbnails */}
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1">
            {['from-pink-500 to-orange-500', 'from-blue-500 to-cyan-500', 'from-emerald-500 to-blue-500'].map((c, i) => (
              <div
                key={i}
                className={`h-6 w-9 rounded bg-gradient-to-br ${c} shadow-md`}
              />
            ))}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes live-pulse {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0;
          }
          20% {
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

function AiMockup() {
  return (
    <div className="relative w-full">
      <div className="space-y-2">
        <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-sm bg-accent2-500/15 px-3 py-2 text-xs text-cream">
          Past tense ni tushuntiring
        </div>
        <div className="flex w-fit max-w-[85%] items-start gap-2 rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.04] px-3 py-2">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent2-500 text-[10px] font-bold text-ink">
            AI
          </div>
          <p className="text-[11px] leading-relaxed text-cream-dim">
            Past tense — bo&apos;lib o&apos;tgan harakatni tasvirlaydi...
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-1 font-mono text-[9px] text-cream-dim">
          <span className="h-1 w-1 animate-pulse rounded-full bg-accent2-500" />
          AI yozmoqda
        </div>
      </div>
    </div>
  );
}

function HomeworkMockup() {
  const modules = ['Reading', 'Writing', 'Listening', 'Speaking', 'Grammar'];
  return (
    <div className="grid w-full grid-cols-2 gap-1.5">
      {modules.slice(0, 4).map((m, i) => (
        <div
          key={m}
          className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5"
          style={{
            animation: `module-pulse 4s ease-in-out ${i * 0.5}s infinite`,
          }}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              i % 2 === 0 ? 'bg-accent2-500' : 'bg-purple-400'
            }`}
          />
          <span className="text-[10px] font-medium text-cream">{m}</span>
        </div>
      ))}
      <div className="col-span-2 flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/[0.08] py-1.5 text-[10px] font-mono text-cream-dim">
        +6 boshqa
      </div>
      <style jsx>{`
        @keyframes module-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
}

function CourseMockup() {
  return (
    <div className="w-full space-y-2">
      {['English Beginner', 'Math 5-sinf', 'IT Fundamentals'].map((c, i) => (
        <div
          key={c}
          className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2"
        >
          <div
            className="h-6 w-6 rounded-md"
            style={{
              background: [
                'linear-gradient(135deg, #00E87A, #00B560)',
                'linear-gradient(135deg, #5BA8FF, #2563EB)',
                'linear-gradient(135deg, #FB923C, #EA580C)',
              ][i],
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold text-cream">{c}</p>
            <p className="text-[9px] text-cream-dim">
              {[24, 38, 16][i]} talaba
            </p>
          </div>
          <span className="font-mono text-[9px] text-cream-dim">
            {[80, 60, 30][i]}%
          </span>
        </div>
      ))}
    </div>
  );
}

function ChatMockup() {
  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="h-5 w-5 flex-shrink-0 rounded-full bg-gradient-to-br from-pink-500 to-orange-500" />
        <div className="rounded-2xl rounded-tl-sm bg-white/[0.05] px-2.5 py-1.5">
          <p className="text-[10px] text-cream">Salom, dars 14:00 da bo&apos;ladimi?</p>
        </div>
      </div>
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-tr-sm bg-accent2-500/15 px-2.5 py-1.5">
          <p className="text-[10px] text-cream">Ha, tayyorlaning ✨</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <div className="h-5 w-5 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500" />
        <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white/[0.05] px-2.5 py-1.5">
          <span className="h-1 w-1 animate-bounce rounded-full bg-cream-dim" />
          <span
            className="h-1 w-1 animate-bounce rounded-full bg-cream-dim"
            style={{ animationDelay: '0.2s' }}
          />
          <span
            className="h-1 w-1 animate-bounce rounded-full bg-cream-dim"
            style={{ animationDelay: '0.4s' }}
          />
        </div>
      </div>
    </div>
  );
}

function ScheduleMockup() {
  const days = ['Du', 'Se', 'Ch', 'Pa', 'Ju'];
  return (
    <div className="w-full">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.15em] text-cream-dim">
        <span>May 2026</span>
        <span>14:00 - 15:30</span>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {days.map((d, i) => (
          <div
            key={d}
            className={`flex flex-col items-center rounded-lg py-1.5 ${
              i === 1
                ? 'bg-accent2-500/20 ring-1 ring-accent2-500/40'
                : 'bg-white/[0.03]'
            }`}
          >
            <span className="text-[9px] text-cream-dim">{d}</span>
            <span
              className={`text-[10px] font-bold ${
                i === 1 ? 'text-accent2-500' : 'text-cream'
              }`}
            >
              {25 + i}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-lg bg-accent2-500/10 px-2 py-1.5">
        <p className="text-[10px] font-bold text-cream">English Speaking</p>
        <p className="text-[9px] text-cream-dim">Har Sesh, 14:00</p>
      </div>
    </div>
  );
}

function DiscoveryMockup() {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-2">
        <svg
          className="h-3 w-3 text-cream-dim"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <span className="text-[10px] text-cream-dim">English teacher</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-1.5"
          >
            <div
              className="h-8 w-8 rounded-full"
              style={{
                background: `linear-gradient(135deg, hsl(${i * 90}, 60%, 50%), hsl(${i * 90 + 30}, 60%, 70%))`,
              }}
            />
            <p className="mt-1 truncate text-[9px] font-bold text-cream">
              T{i}
            </p>
            <p className="text-[8px] text-cream-dim">★ 4.{8 + i}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsMockup() {
  return (
    <div className="w-full">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-cream-dim">
            Bu oydagi tushum
          </span>
          <span className="rounded-full bg-accent2-500/20 px-1.5 py-0.5 font-mono text-[8px] text-accent2-500">
            +24%
          </span>
        </div>
        <p
          className="mt-1 font-extrabold text-cream"
          style={{ fontSize: '20px', letterSpacing: '-0.04em' }}
        >
          12 480 000{' '}
          <span className="font-mono text-[10px] text-cream-dim">UZS</span>
        </p>
        <div className="mt-2 flex h-6 items-end gap-1">
          {[40, 65, 30, 80, 55, 90, 70].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-gradient-to-t from-accent2-500/30 to-accent2-500"
              style={{
                height: `${h}%`,
                animation: `bar-rise 1s ease-out ${i * 0.1}s backwards`,
              }}
            />
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes bar-rise {
          from {
            height: 0% !important;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
