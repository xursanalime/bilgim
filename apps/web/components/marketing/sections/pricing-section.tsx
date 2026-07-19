'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

/**
 * PricingSection — 3 ta tarif: Trial, Starter, Pro.
 *
 * Trial 14 kun bepul. Keyin Payme orqali oylik to'lov.
 */
export function PricingSection({ locale }: { locale: string }) {
  return (
    <section
      id="pricing"
      className="relative overflow-hidden bg-ink py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Tariflar
          </motion.span>

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
            Sizga mos{' '}
            <span className="italic text-accent2-500">narx</span> tanlang
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-4 text-base text-cream-dim sm:text-lg"
          >
            14 kun bepul · Karta kerak emas · Istalgan vaqtda bekor qilish
          </motion.p>
        </div>

        {/* Pricing grid */}
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <PricingCard key={plan.name} {...plan} locale={locale} delay={i * 0.1} />
          ))}
        </div>

        {/* Footnote */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-cream-dim">
          <span className="flex items-center gap-1.5">
            <CheckIcon /> Payme orqali to&apos;lov
          </span>
          <span className="flex items-center gap-1.5">
            <CheckIcon /> 24/7 qo&apos;llab-quvvatlash
          </span>
          <span className="flex items-center gap-1.5">
            <CheckIcon /> Yiliga 2 oy bepul
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
  priceUnit: string;
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
    priceUnit: '14 kun',
    description: 'Barcha imkoniyatlar 14 kun davomida bepul.',
    features: [
      'Cheksiz kurs va guruh',
      '50 ta talabagacha',
      'Jonli efir (2 soat / dars)',
      'AI Tutor (cheklangan)',
      'In-app + email xabarnoma',
      "Email orqali qo'llab-quvvatlash",
    ],
    cta: 'Bepul boshlash',
  },
  {
    name: 'Starter',
    tagline: 'Boshlovchi o‘qituvchi',
    price: '199 000',
    priceUnit: 'oyiga',
    description: 'Bir xil kurs va 100 ta talabagacha.',
    features: [
      "Barcha Trial imkoniyatlari",
      "100 ta talabagacha",
      "Cheklanmagan jonli efir",
      "AI Tutor cheklanmagan",
      "Telegram + Push xabarnoma",
      "Discovery (public profil)",
      "Payme orqali to'lov qabul qilish",
    ],
    cta: '14 kun bepul',
    popular: true,
  },
  {
    name: 'Pro',
    tagline: 'Faol o‘qituvchi',
    price: '399 000',
    priceUnit: 'oyiga',
    description: 'Cheksiz talaba, kengaytirilgan analitika.',
    features: [
      'Barcha Starter imkoniyatlari',
      'Cheksiz talaba',
      'Kengaytirilgan analitika',
      'AI grading assistant',
      'Custom branding',
      'Priority qo&apos;llab-quvvatlash',
      'API kirish (Phase 2)',
    ],
    cta: '14 kun bepul',
  },
];

function PricingCard({
  name,
  tagline,
  price,
  priceUnit,
  description,
  features,
  cta,
  popular,
  locale,
  delay,
}: Plan & { locale: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay }}
      className={`group relative overflow-hidden rounded-3xl border p-7 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 ${
        popular
          ? 'border-accent2-500/40 bg-gradient-to-b from-accent2-500/[0.08] to-ink-surface/40'
          : 'border-white/[0.08] bg-ink-surface/40 hover:border-white/[0.18]'
      }`}
      style={{
        boxShadow: popular
          ? '0 0 0 1px rgba(0,232,122,0.2), 0 30px 80px -20px rgba(0,232,122,0.4)'
          : '0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      {/* Popular badge */}
      {popular && (
        <div className="absolute -top-px left-1/2 -translate-x-1/2 rounded-b-xl bg-accent2-500 px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink">
          Mashhur
        </div>
      )}

      {/* Glow on hover */}
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100"
        style={{
          background: popular
            ? 'rgba(0,232,122,0.2)'
            : 'rgba(91,168,255,0.15)',
        }}
      />

      {/* Plan name */}
      <div className="relative">
        <p
          className={`text-2xl font-extrabold tracking-tight ${
            popular ? 'text-accent2-500' : 'text-cream'
          }`}
          style={{ letterSpacing: '-0.025em' }}
        >
          {name}
        </p>
        <p className="mt-1 text-xs text-cream-dim">{tagline}</p>

        {/* Price */}
        <div className="mt-6 flex items-baseline gap-2">
          <span
            className="font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 4vw, 3rem)',
              letterSpacing: '-0.04em',
            }}
          >
            {price === '0' ? 'Bepul' : `${price}`}
          </span>
          {price !== '0' && (
            <span className="font-mono text-xs text-cream-dim">UZS</span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-dim">
            / {priceUnit}
          </span>
        </div>

        <p className="mt-3 text-sm text-cream-dim">{description}</p>

        {/* CTA */}
        <Link
          href={`/${locale}/register?role=teacher&plan=${name.toLowerCase()}`}
          className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all active:scale-[0.97] ${
            popular
              ? 'bg-accent2-500 text-ink hover:bg-accent2-400'
              : 'border border-white/[0.1] bg-white/[0.04] text-cream hover:border-white/[0.2] hover:bg-white/[0.08]'
          }`}
          style={
            popular
              ? {
                  boxShadow:
                    '0 0 0 1px rgba(0,232,122,0.4), 0 12px 32px -8px rgba(0,232,122,0.6)',
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

        {/* Features */}
        <ul className="mt-7 space-y-3 border-t border-white/[0.06] pt-7">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-sm text-cream-dim"
            >
              <CheckIcon
                className={popular ? 'text-accent2-500' : 'text-accent2-500/80'}
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

function CheckIcon({ className = 'text-accent2-500' }: { className?: string }) {
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
