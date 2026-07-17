'use client';

import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Video,
  CreditCard,
  Search,
  Languages,
  type LucideIcon,
} from 'lucide-react';
import { SectionHeader } from './features-bento';

/**
 * Testimonials — product promises, not customer quotes.
 *
 * Bilgim has no named institutional customers yet (Beta stage), so this
 * section intentionally avoids fabricated reviews/ratings/avatars. Each
 * card states a concrete, already-built capability instead of a claimed
 * outcome from an invented person.
 */
export function Testimonials() {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Beta dasturi"
          title={
            <>
              Nega o&apos;qituvchilar{' '}
              <span className="italic text-hero-gradient">Bilgim</span>ni
              tanlaydi
            </>
          }
          subtitle="Biz hali yangi platformamiz — lekin har bir va'da orqasida ishlaydigan funksiya bor."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PROMISES.map((p, i) => (
            <Card key={p.title} {...p} delay={i * 0.08} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface Promise {
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: 'blue' | 'green' | 'purple' | 'orange';
  highlight?: boolean;
}

const PROMISES: Promise[] = [
  {
    title: 'Sifatni saqlaydigan AI',
    desc: "AI yordamchi vazifa javobini yozib bermaydi — faqat tushuntiradi, halollikni tekshiradi.",
    icon: ShieldCheck,
    accent: 'purple',
    highlight: true,
  },
  {
    title: 'Hech bir dars yo\'qolmaydi',
    desc: 'Jonli efir avtomatik yozib olinadi — talaba istalgan vaqt qaytadan tomosha qiladi.',
    icon: Video,
    accent: 'blue',
  },
  {
    title: "To'lov qo'lda emas",
    desc: "Payme orqali to'g'ridan-to'g'ri to'lov va avtomatik hisobot — qo'lda hisob-kitob shart emas.",
    icon: CreditCard,
    accent: 'orange',
  },
  {
    title: 'Sizni topib olishadi',
    desc: "Discovery sahifasi orqali yangi talaba sizning profilingizni qidirib topadi.",
    icon: Search,
    accent: 'green',
  },
  {
    title: 'Talaba uchun qulaylik',
    desc: "O'qish paytida so'z ustiga bosgan zahoti tarjima ko'rinadi — alohida lug'atga hojat yo'q.",
    icon: Languages,
    accent: 'blue',
  },
];

function Card({ title, desc, icon: Icon, accent, highlight, delay }: Promise & { delay: number }) {
  const accentClasses = {
    blue: { tint: 'bg-blue-tint', text: 'text-blue' },
    green: { tint: 'bg-green-tint', text: 'text-green' },
    orange: { tint: 'bg-orange-tint', text: 'text-orange' },
    purple: { tint: 'bg-purple-tint', text: 'text-purple' },
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, delay }}
      className={`group relative flex flex-col overflow-hidden rounded-3xl border p-6 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-medium ${
        highlight
          ? 'border-blue/20 bg-gradient-to-br from-blue/[0.06] to-canvas'
          : 'border-rim bg-canvas hover:border-rim-2'
      }`}
      style={{
        boxShadow: highlight
          ? '0 0 0 1px rgba(0, 113, 227, 0.1), 0 16px 48px -16px rgba(0, 113, 227, 0.18)'
          : '0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px -12px rgba(0, 0, 0, 0.06)',
      }}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${accentClasses.tint}`}>
        <Icon className={`h-5 w-5 ${accentClasses.text}`} strokeWidth={2.25} />
      </span>

      <p className="relative mt-4 text-base font-extrabold text-ink-strong" style={{ letterSpacing: '-0.02em' }}>
        {title}
      </p>
      <p className="relative mt-1.5 text-sm leading-relaxed text-ink-soft">{desc}</p>
    </motion.div>
  );
}
