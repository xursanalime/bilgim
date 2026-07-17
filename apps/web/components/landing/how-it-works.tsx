'use client';

import { motion } from 'framer-motion';
import { UserPlus, LayoutTemplate, Wallet, type LucideIcon } from 'lucide-react';
import { SectionHeader } from './features-bento';

/**
 * HowItWorks — "3 qadamda boshlang" onboarding steps.
 * Gives trial users a concrete first-win path instead of a bare feature list.
 */
export function HowItWorks() {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Qanday ishlaydi"
          title={
            <>
              <span className="italic text-hero-gradient">3 qadamda</span>{' '}
              boshlang
            </>
          }
          subtitle="Ro'yxatdan o'tishdan birinchi to'lovgacha — texnik bilim shart emas."
        />

        <div className="relative mt-16 grid gap-8 md:grid-cols-3 md:gap-6">
          {/* Connecting line — desktop only */}
          <div className="pointer-events-none absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-rim-2 to-transparent md:block" />

          {STEPS.map((s, i) => (
            <Step key={s.title} {...s} index={i + 1} delay={i * 0.12} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface StepData {
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: 'blue' | 'purple' | 'green';
}

const STEPS: StepData[] = [
  {
    title: "Ro'yxatdan o'ting",
    desc: "5 daqiqa, karta kerak emas. Email yoki telefon raqami bilan darhol boshlaysiz.",
    icon: UserPlus,
    accent: 'blue',
  },
  {
    title: 'Birinchi kursingizni yarating',
    desc: "Tayyor shablon orqali — modul, dars va narxni belgilab, sahifangiz darhol ishga tushadi.",
    icon: LayoutTemplate,
    accent: 'purple',
  },
  {
    title: 'Talaba to\'lov qiladi',
    desc: "Payme orqali avtomatik to'lov qabul qilinadi, pul to'g'ridan-to'g'ri hisobingizga tushadi.",
    icon: Wallet,
    accent: 'green',
  },
];

function Step({
  title,
  desc,
  icon: Icon,
  accent,
  index,
  delay,
}: StepData & { index: number; delay: number }) {
  const accentClasses = {
    blue: { tint: 'bg-blue-tint', text: 'text-blue', ring: 'ring-blue/20' },
    purple: { tint: 'bg-purple-tint', text: 'text-purple', ring: 'ring-purple/20' },
    green: { tint: 'bg-green-tint', text: 'text-green', ring: 'ring-green/20' },
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay }}
      className="relative flex flex-col items-center text-center"
    >
      {/* Numbered icon badge — sits on the connecting line */}
      <div className={`relative flex h-16 w-16 items-center justify-center rounded-3xl ${accentClasses.tint} ring-4 ring-canvas`}>
        <Icon className={`h-7 w-7 ${accentClasses.text}`} strokeWidth={2.25} />
        <span
          className={`absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-canvas font-mono text-[11px] font-bold text-ink-strong ring-2 ${accentClasses.ring}`}
        >
          {index}
        </span>
      </div>

      <h3 className="mt-5 text-lg font-extrabold tracking-tight text-ink-strong" style={{ letterSpacing: '-0.02em' }}>
        {title}
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">{desc}</p>
    </motion.div>
  );
}
