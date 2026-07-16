'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { SectionHeader } from './features-bento';

export function Pricing({ locale }: { locale: string }) {
  return (
    <section id="pricing" className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Tariflar"
          title={
            <>
              Sizga mos{' '}
              <span className="italic text-blue-green-gradient">narx</span> tanlang
            </>
          }
          subtitle="14 kun bepul · Karta kerak emas · Istalgan vaqtda bekor qilish"
        />

        <div className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <Card key={p.name} {...p} locale={locale} delay={i * 0.1} />
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <Check /> Payme orqali to&apos;lov
          </span>
          <span className="flex items-center gap-1.5">
            <Check /> 24/7 qo&apos;llab-quvvatlash
          </span>
          <span className="flex items-center gap-1.5">
            <Check /> Yiliga to&apos;lasangiz 2 oy bepul
          </span>
        </div>
      </div>
    </section>
  );
}

interface Plan {
  name: string;
  tagline: string;
  price: string;
  unit: string;
  description: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Trial',
    tagline: 'Sinab ko‘rish',
    price: '0',
    unit: '14 kun',
    description: 'Barcha imkoniyatlar 14 kun davomida bepul.',
    features: [
      'Cheksiz kurs va guruh',
      '50 ta talabagacha',
      'Jonli efir (2 soat / dars)',
      'AI Tutor (cheklangan)',
      'In-app + email xabarnoma',
      'Email orqali yordam',
    ],
    cta: 'Bepul boshlash',
  },
  {
    name: 'Starter',
    tagline: 'Boshlovchi o‘qituvchi',
    price: '199 000',
    unit: 'oyiga',
    description: '100 ta talabagacha, cheksiz jonli efir.',
    features: [
      "Barcha Trial imkoniyatlari",
      "100 ta talabagacha",
      "Cheklanmagan jonli efir",
      "AI Tutor cheklanmagan",
      "Telegram + Push xabarnoma",
      "Discovery (public profil)",
      "Payme orqali to'lov qabul",
    ],
    cta: '14 kun bepul',
    popular: true,
  },
  {
    name: 'Pro',
    tagline: 'Faol o‘qituvchi',
    price: '399 000',
    unit: 'oyiga',
    description: 'Cheksiz talaba, kengaytirilgan analitika.',
    features: [
      'Barcha Starter imkoniyatlari',
      'Cheksiz talaba',
      'Kengaytirilgan analitika',
      'AI grading assistant',
      'Custom branding',
      'Priority qo&apos;llab-quvvatlash',
      'API kirish',
    ],
    cta: '14 kun bepul',
  },
];

function Card({
  name,
  tagline,
  price,
  unit,
  description,
  features,
  cta,
  popular,
  locale,
  delay,
}: Plan & { locale: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay }}
      className={`group relative overflow-hidden rounded-3xl border p-7 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 ${
        popular
          ? 'border-blue/40 bg-gradient-to-b from-blue/[0.08] to-canvas/40'
          : 'border-rim bg-canvas hover:border-rim-2'
      }`}
      style={{
        boxShadow: popular
          ? '0 0 0 1px rgba(255,122,89,0.2), 0 30px 80px -20px rgba(255,122,89,0.4)'
          : '0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      {popular && (
        <div className="absolute -top-px left-1/2 -translate-x-1/2 rounded-b-2xl bg-blue px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white">
          ⭐ Mashhur
        </div>
      )}

      <div
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100"
        style={{
          background: popular
            ? 'rgba(255,122,89,0.25)'
            : 'rgba(111,229,197,0.15)',
        }}
      />

      <div className="relative">
        <div className="mt-3 flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-extrabold ${popular ? 'text-blue' : 'text-ink'}`}
            style={{ letterSpacing: '-0.025em' }}
          >
            {name}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-soft">{tagline}</p>

        <div className="mt-6 flex items-baseline gap-2">
          <span
            className="font-extrabold tracking-tight text-ink"
            style={{
              fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
              letterSpacing: '-0.05em',
              lineHeight: '1',
            }}
          >
            {price === '0' ? 'Bepul' : price}
          </span>
          {price !== '0' && (
            <span className="font-mono text-xs text-ink-soft">UZS</span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            / {unit}
          </span>
        </div>

        <p className="mt-3 text-sm text-ink-soft">{description}</p>

        <Link
          href={`/${locale}/register?role=teacher&plan=${name.toLowerCase()}`}
          className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all active:scale-[0.97] ${
            popular
              ? 'bg-blue text-white hover:bg-blue-400'
              : 'border border-rim-2 bg-canvas text-ink hover:border-rim-2 hover:bg-soft'
          }`}
          style={
            popular
              ? {
                  boxShadow:
                    '0 0 0 1px rgba(255,122,89,0.4), 0 12px 32px -8px rgba(255,122,89,0.6)',
                }
              : undefined
          }
        >
          {cta}
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>

        <ul className="mt-7 space-y-2.5 border-t border-rim pt-7">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-sm text-ink-soft"
            >
              <Check className={popular ? 'text-blue' : 'text-green'} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

function Check({ className = 'text-green' }: { className?: string }) {
  return (
    <svg
      className={`mt-0.5 h-4 w-4 flex-shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
