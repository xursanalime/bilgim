'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MorphingShape, type ShapeVariant } from './effects/morphing-shape';

/**
 * ServicesShowcase — Antimatter AI stilida xizmatlar ko'rgazmasi.
 *
 * Chap tomonda particle-based morphing shape (kursorlar tugmasini bosganda
 * shakl o'zgaradi). O'ngda — slideable kartochkalar chiziq.
 *
 * Bilgim konteksti: ko'p tilli o'qitish, AI yordamchi, jonli efir,
 * uy vazifa modullari, va h.k.
 */

interface Service {
  number: string;
  shape: ShapeVariant;
  title: string;
  description: string;
  features: string[];
  tools: string[];
  accent: 'purple' | 'blue' | 'green' | 'orange';
}

const SERVICES: Service[] = [
  {
    number: '01',
    shape: 'cube',
    title: 'Kurs va guruhlar',
    description:
      'Kurslarni yaratish, guruhlar tashkil qilish va talabalarni qabul qilish — barchasi bir joyda.',
    features: [
      'Cheksiz kurs va guruh',
      'Invite link yoki ochiq sahifa',
      'Avtomatik yozib olish',
      'Talaba progress kuzatish',
    ],
    tools: ['Schedule', 'Calendar', 'Roster'],
    accent: 'purple',
  },
  {
    number: '02',
    shape: 'diamond',
    title: 'Jonli efir',
    description:
      'mediasoup SFU bilan yuqori sifatli, kam kechikishli (≤1.5s) jonli darslar. 500+ talabaga.',
    features: [
      '1080p video, kristal aniq audio',
      'Avtomatik HLS yozish',
      'Real-time chat',
      'Ekran ulashish',
    ],
    tools: ['mediasoup', 'WebRTC', 'HLS'],
    accent: 'blue',
  },
  {
    number: '03',
    shape: 'code',
    title: 'AI yordamchi',
    description:
      'Claude AI orqali talabalarga 24/7 yordam. Vazifa tushuntirish, tarjima, misol — javob bermay.',
    features: [
      'Tushuntirish va misollar',
      'Tarjima (uz/ru/en)',
      'AI grading assistant',
      'Plagiat tekshiruvi',
    ],
    tools: ['Claude', 'AI Tutor', 'Grader'],
    accent: 'green',
  },
  {
    number: '04',
    shape: 'sphere',
    title: 'Uy vazifa modullari',
    description:
      'Reading, Writing, Listening, Speaking, Grammar va boshqa modullar. Har bir guruh uchun moslashtirilgan.',
    features: [
      '10+ modul turlari',
      'Auto-grading',
      'Versiya tarixi',
      'Audio diktovka',
    ],
    tools: ['Tiptap', 'Audio', 'AI'],
    accent: 'orange',
  },
];

export function ServicesShowcase() {
  const [active, setActive] = useState(0);
  const current = SERVICES[active]!;

  const accentClass = {
    purple: 'from-purple-500/40 to-purple-700/20',
    blue: 'from-blue-500/40 to-blue-700/20',
    green: 'from-emerald-500/40 to-emerald-700/20',
    orange: 'from-orange-500/40 to-orange-700/20',
  }[current.accent];

  const accentText = {
    purple: 'text-purple-400',
    blue: 'text-blue-400',
    green: 'text-emerald-400',
    orange: 'text-orange-400',
  }[current.accent];

  const shapeColor = {
    purple: 'rgba(190, 170, 255, 0.85)',
    blue: 'rgba(150, 200, 255, 0.85)',
    green: 'rgba(140, 255, 200, 0.85)',
    orange: 'rgba(255, 200, 140, 0.85)',
  }[current.accent];

  return (
    <section className="relative isolate overflow-hidden bg-ink py-24 sm:py-32">
      {/* Header row */}
      <div className="relative mx-auto mb-16 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-6 md:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
              Imkoniyatlar
            </span>
            <h2
              className="mt-5 text-balance font-extrabold tracking-tight text-cream"
              style={{
                fontSize: 'clamp(2.25rem, 5vw, 4rem)',
                letterSpacing: '-0.04em',
              }}
            >
              Bizning <span className="italic text-accent2-500">xizmatlar</span>
            </h2>
          </div>
          <p className="max-w-md text-base text-cream-dim sm:text-lg md:justify-self-end">
            Bilgim — kurs yaratishdan boshlab, AI yordamida vazifa baholashga
            qadar barcha imkoniyatlarni bir tizimda taqdim etadi.
          </p>
        </div>
      </div>

      {/* Main showcase area */}
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-12">
          {/* ─── Left: morphing particle shape ───────────────────── */}
          <div className="relative lg:col-span-4">
            <div
              className="relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-surface/40 backdrop-blur-sm"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.04), inset 0 0 80px rgba(0,0,0,0.6)',
              }}
            >
              {/* Subtle gradient backdrop matching accent */}
              <div
                className={`absolute inset-0 bg-gradient-to-br ${accentClass} opacity-30 transition-opacity duration-700`}
              />

              {/* Dot grid */}
              <div className="absolute inset-0 bg-dots opacity-20" />

              {/* The shape */}
              <div className="relative">
                <MorphingShape
                  variant={current.shape}
                  color={shapeColor}
                  size={360}
                />
              </div>

              {/* Number indicator (corner) */}
              <div className="absolute right-5 top-5 font-mono text-[10px] uppercase tracking-[0.2em] text-cream-dim">
                {current.number} / {String(SERVICES.length).padStart(2, '0')}
              </div>
            </div>

            {/* Navigation arrows */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() =>
                  setActive((a) => (a - 1 + SERVICES.length) % SERVICES.length)
                }
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-cream-dim transition-all hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-cream"
                aria-label="Oldingi"
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
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>

              <div className="flex gap-1.5">
                {SERVICES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActive(i)}
                    className={`h-1 rounded-full transition-all ${
                      i === active
                        ? 'w-8 bg-accent2-500'
                        : 'w-4 bg-white/[0.15] hover:bg-white/[0.3]'
                    }`}
                    aria-label={`Service ${i + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={() => setActive((a) => (a + 1) % SERVICES.length)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-cream-dim transition-all hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-cream"
                aria-label="Keyingi"
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
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>

          {/* ─── Center: active service detail card ──────────────── */}
          <div className="lg:col-span-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.number}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="relative h-full overflow-hidden rounded-3xl border border-white/[0.08] p-8 backdrop-blur-sm"
                style={{
                  background: `linear-gradient(135deg, ${
                    {
                      purple: 'rgba(120, 80, 220, 0.18)',
                      blue: 'rgba(60, 130, 220, 0.18)',
                      green: 'rgba(0, 232, 122, 0.15)',
                      orange: 'rgba(220, 130, 60, 0.18)',
                    }[current.accent]
                  } 0%, rgba(13, 31, 54, 0.5) 100%)`,
                }}
              >
                {/* Top label + arrow icon */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
                      Modul · {current.number}
                    </p>
                    <h3
                      className={`mt-3 text-3xl font-extrabold tracking-tight text-cream sm:text-4xl`}
                      style={{ letterSpacing: '-0.03em' }}
                    >
                      {current.title}
                    </h3>
                  </div>
                  <button
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] ${accentText} transition-all hover:bg-white/[0.08]`}
                    aria-label="Ko'proq"
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
                      <path d="M7 17 17 7" />
                      <path d="M7 7h10v10" />
                    </svg>
                  </button>
                </div>

                <p className="mt-6 text-sm leading-relaxed text-cream-dim sm:text-base">
                  {current.description}
                </p>

                {/* Features + Tools */}
                <div className="mt-10 grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
                      Imkoniyatlar
                    </p>
                    <ul className="mt-3 space-y-2">
                      {current.features.map((f) => (
                        <li
                          key={f}
                          className="text-sm text-cream"
                          style={{ letterSpacing: '-0.01em' }}
                        >
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
                      Texnologiyalar
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {current.tools.map((t) => (
                        <span
                          key={t}
                          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] font-medium text-cream-dim"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ─── Right: next service teaser cards ─────────────────── */}
          <div className="space-y-3 lg:col-span-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
              Boshqa modullar
            </p>
            {SERVICES.filter((_, i) => i !== active).map((s) => (
              <button
                key={s.number}
                onClick={() => setActive(SERVICES.indexOf(s))}
                className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left transition-all hover:border-white/[0.15] hover:bg-white/[0.06]"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-dim">
                    {s.number}
                  </span>
                  <svg
                    className="h-4 w-4 text-cream-dim transition-transform group-hover:translate-x-1 group-hover:translate-y-[-2px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17 17 7" />
                    <path d="M7 7h10v10" />
                  </svg>
                </div>
                <p
                  className="mt-6 text-base font-extrabold tracking-tight text-cream"
                  style={{ letterSpacing: '-0.02em' }}
                >
                  {s.title}
                </p>
                {/* Bottom dot pattern */}
                <div
                  className="mt-3 h-2 opacity-40"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
                    backgroundSize: '6px 6px',
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
