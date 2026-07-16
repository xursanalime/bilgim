'use client';

import { motion } from 'framer-motion';
import {
  Target,
  Award,
  Mic,
  BookOpenText,
  PenLine,
  Headphones,
  MessagesSquare,
  Briefcase,
  GraduationCap,
  Plane,
  SpellCheck,
  Baby,
  type LucideIcon,
} from 'lucide-react';
import { SectionHeader } from './features-bento';

/**
 * Specialties — ingliz tili yo'nalishlari grid, Apple light theme.
 */
export function Specialties() {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Yo'nalishlar"
          title={
            <>
              Har <span className="italic text-hero-gradient">maqsad</span> uchun
              ingliz tili
            </>
          }
          subtitle="Onboarding kvizidan keyin sizga eng mos ingliz tili yo'nalishi tanlanadi. Har bir yo'nalish — o'ziga xos modullar va analitika bilan jihozlangan."
        />

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {SPECIALTIES.map((s, i) => (
            <Tile key={s.name} {...s} delay={i * 0.04} />
          ))}
        </div>

        <div className="mt-10 flex items-center justify-center gap-3">
          <div className="h-px w-12 bg-rim" />
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
            Va boshqa ingliz tili yo&apos;nalishlari
          </p>
          <div className="h-px w-12 bg-rim" />
        </div>
      </div>
    </section>
  );
}

interface Specialty {
  name: string;
  icon: LucideIcon;
  count: string;
  tone: 'blue' | 'green' | 'orange' | 'purple' | 'red';
}

const SPECIALTIES: Specialty[] = [
  { name: 'General English', icon: BookOpenText, count: '6 modul', tone: 'blue' },
  { name: 'IELTS', icon: Target, count: '5 modul', tone: 'green' },
  { name: 'TOEFL', icon: Award, count: '5 modul', tone: 'purple' },
  { name: 'Speaking', icon: Mic, count: '4 modul', tone: 'orange' },
  { name: 'Grammar', icon: SpellCheck, count: '5 modul', tone: 'red' },
  { name: 'Writing', icon: PenLine, count: '4 modul', tone: 'blue' },
  { name: 'Listening', icon: Headphones, count: '4 modul', tone: 'purple' },
  { name: 'Conversation', icon: MessagesSquare, count: '4 modul', tone: 'green' },
  { name: 'Business English', icon: Briefcase, count: '5 modul', tone: 'orange' },
  { name: 'Kids English', icon: Baby, count: '4 modul', tone: 'red' },
  { name: 'Academic English', icon: GraduationCap, count: '5 modul', tone: 'purple' },
  { name: 'Travel English', icon: Plane, count: '3 modul', tone: 'orange' },
];

function Tile({
  name,
  icon: Icon,
  count,
  tone,
  delay,
}: Specialty & { delay: number }) {
  const toneClasses = {
    blue: { bg: 'bg-blue-tint', text: 'text-blue', glow: 'rgba(0, 113, 227, 0.18)' },
    green: { bg: 'bg-green-tint', text: 'text-green', glow: 'rgba(52, 199, 89, 0.18)' },
    orange: { bg: 'bg-orange-tint', text: 'text-orange', glow: 'rgba(255, 159, 10, 0.18)' },
    purple: { bg: 'bg-purple-tint', text: 'text-purple', glow: 'rgba(175, 82, 222, 0.18)' },
    red: { bg: 'bg-red-tint', text: 'text-red', glow: 'rgba(255, 59, 48, 0.18)' },
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay }}
    >
      <div className="group relative flex aspect-square flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border border-rim bg-canvas p-4 transition-all duration-500 hover:-translate-y-1 hover:border-rim-2 hover:shadow-medium">
        {/* Hover radial glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(circle at center, ${toneClasses.glow} 0%, transparent 70%)`,
          }}
        />

        <span
          className={`relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl ${toneClasses.bg} transition-transform duration-500 group-hover:scale-110`}
        >
          <Icon
            className={`h-7 w-7 ${toneClasses.text}`}
            strokeWidth={2}
          />
        </span>
        <p
          className="relative z-10 text-center text-sm font-extrabold text-ink-strong"
          style={{ letterSpacing: '-0.02em' }}
        >
          {name}
        </p>
        <p className="relative z-10 font-mono text-[8px] uppercase tracking-[0.18em] text-ink-soft">
          {count}
        </p>
      </div>
    </motion.div>
  );
}
