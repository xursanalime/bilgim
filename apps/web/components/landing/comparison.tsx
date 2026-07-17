'use client';

import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { SectionHeader } from './features-bento';

/**
 * Comparison — "eski usul" (Telegram + Zoom) vs Bilgim.
 * Makes the core differentiator explicit instead of leaving it implicit.
 */
export function Comparison() {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Nega Bilgim"
          title={
            <>
              Telegram + Zoom o&apos;rniga{' '}
              <span className="italic text-hero-gradient">bitta tizim</span>
            </>
          }
          subtitle="Ko'pchilik o'qituvchi bugun shu usulda ishlaydi — Bilgim shu og'riqlarni yechadi."
        />

        <div className="mx-auto mt-14 grid max-w-4xl gap-4 md:grid-cols-2">
          {/* Old way */}
          <div className="rounded-3xl border border-rim bg-tint p-7">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink-soft">
              Hozirgi usul
            </span>
            <h3 className="mt-3 text-xl font-extrabold text-ink-strong" style={{ letterSpacing: '-0.02em' }}>
              Telegram + Zoom
            </h3>
            <ul className="mt-6 space-y-3">
              {PAINS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-ink-soft">
                  <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red" strokeWidth={3} />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Bilgim way */}
          <div
            className="relative overflow-hidden rounded-3xl border border-blue/20 bg-gradient-to-b from-blue/[0.05] to-canvas p-7"
            style={{ boxShadow: '0 0 0 1px rgba(0,113,227,0.08), 0 30px 80px -30px rgba(0,113,227,0.35)' }}
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-blue">
              Bilgim bilan
            </span>
            <h3 className="mt-3 text-xl font-extrabold text-ink-strong" style={{ letterSpacing: '-0.02em' }}>
              Bitta brendlangan tizim
            </h3>
            <ul className="mt-6 space-y-3">
              {SOLUTIONS.map((s, i) => (
                <motion.li
                  key={s}
                  initial={{ opacity: 0, x: 8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="flex items-start gap-2.5 text-sm font-medium text-ink-strong"
                >
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue" strokeWidth={3} />
                  <span>{s}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const PAINS = [
  "Talabalarni qo'lda ro'yxatga olish va kuzatish",
  "To'lovni qo'lda so'rash va tekshirish",
  'Zoom havolasini har safar qayta yuborish',
  "Vazifani qo'lda tekshirish — ko'p vaqt ketadi",
  'Yangi talaba sizni faqat tanish orqali topadi',
  "Professional ko'rinish yo'q — hammasi tarqoq",
];

const SOLUTIONS = [
  'Avtomatik ro\'yxat va progress kuzatuvi',
  "Payme orqali avtomatik to'lov va hisobot",
  "Bitta doimiy jadval, avtomatik eslatma",
  'AI yordamida tezkor baholash',
  'Discovery sahifasi orqali qidirib topiladi',
  'Bitta brendlangan shaxsiy sahifa',
];
