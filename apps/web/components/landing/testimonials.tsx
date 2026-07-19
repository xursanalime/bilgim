'use client';

import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';
import { SectionHeader } from './features-bento';

/**
 * Testimonials — masonry-style cards with Apple light theme.
 */
export function Testimonials() {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Sharhlar"
          title={
            <>
              <span className="italic text-hero-gradient">10 000+</span>{' '}
              o&apos;qituvchi tanlagan
            </>
          }
          subtitle="O'zbekistondagi yetakchi murabbiylar va tashkilotlar bilan tajriba almashing."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Card key={t.author} {...t} delay={i * 0.08} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface Quote {
  quote: string;
  author: string;
  role: string;
  avatarColor: string;
  highlight?: boolean;
  rating?: number;
}

const TESTIMONIALS: Quote[] = [
  {
    quote:
      "AI yordamchi talabalarimga vazifani yozib bermaydi — bu sifatni saqlab qoladi. O'qish samaradorligi 40% ortdi.",
    author: 'Aziza Karimova',
    role: "General English · Toshkent",
    avatarColor: 'from-blue-400 to-blue-600',
    rating: 5,
    highlight: true,
  },
  {
    quote:
      'Jonli efir va avtomatik yozib olish bilan har bir darsim qaytadan tomosha qilinadi. Talabalar soni 2x oshdi.',
    author: 'Sherzod Hamidov',
    role: "Speaking Coach · Najot Ta'lim",
    avatarColor: 'from-green-400 to-green-600',
    rating: 5,
  },
  {
    quote:
      "Payme bilan to'g'ridan-to'g'ri to'lov, avtomatik ro'yxatga olish va Telegram xabarnoma — barchasi ishlamoqda. Ajoyib.",
    author: 'Madina Yusupova',
    role: 'IELTS Coach',
    avatarColor: 'from-purple-400 to-purple-600',
    rating: 5,
  },
  {
    quote:
      "Qidiruv sahifasi tufayli yangi talabalar har hafta keladi. SEO va statistika ham ajoyib.",
    author: 'Otabek Rashidov',
    role: 'Business English · IT Park',
    avatarColor: 'from-orange-400 to-orange-600',
    rating: 5,
  },
  {
    quote:
      "Reading modulda so'z ustiga bosganda darhol tarjima — talabalar uchun haqiqiy yangilik. O'zbek talabalar uchun zarur.",
    author: 'Diyora Abdullayeva',
    role: 'TOEFL · Cambridge Learning',
    avatarColor: 'from-blue-400 to-purple-500',
    rating: 5,
  },
  {
    quote:
      "Admin panel orqali 200+ o'qituvchini bir joydan boshqarish — Profi Education uchun haqiqiy yengillik berdi.",
    author: 'Profi Education',
    role: 'Tashkilot · Samarqand',
    avatarColor: 'from-purple-400 to-green-500',
    rating: 5,
  },
];

function Card({ quote, author, role, avatarColor, highlight, rating, delay }: Quote & { delay: number }) {
  return (
    <motion.figure
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
      {/* Quote mark — subtle decorative */}
      <Quote
        className="pointer-events-none absolute -right-2 -top-2 h-20 w-20 text-blue/[0.05]"
        strokeWidth={1.5}
      />

      {/* Stars */}
      {rating && (
        <div className="flex items-center gap-0.5">
          {Array.from({ length: rating }).map((_, i) => (
            <Star
              key={i}
              className="h-3.5 w-3.5 fill-orange text-orange"
              strokeWidth={0}
            />
          ))}
        </div>
      )}

      <blockquote className="relative mt-3 text-sm leading-relaxed text-ink-strong sm:text-base">
        “{quote}”
      </blockquote>

      <figcaption className="relative mt-6 flex items-center gap-3 border-t border-rim pt-4">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor} font-bold text-white`}
        >
          {author.split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-bold text-ink-strong"
            style={{ letterSpacing: '-0.01em' }}
          >
            {author}
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
            {role}
          </p>
        </div>
      </figcaption>
    </motion.figure>
  );
}
