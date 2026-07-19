'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

/**
 * ForRoles — 3 column section: Teachers / Students / Admins.
 */
export function ForRoles({ locale }: { locale: string }) {
  return (
    <section className="relative overflow-hidden bg-ink py-24 sm:py-32">
      {/* Subtle bg glow */}
      <div className="pointer-events-none absolute inset-0 bg-glow-green opacity-30" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Har kim uchun
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
            EduBridge — siz uchun
          </motion.h2>
        </div>

        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-3">
          <RoleCard
            tag="O'QITUVCHILAR"
            title="Daromad oling"
            icon="👨‍🏫"
            color="#00E87A"
            features={[
              'Cheksiz kurs va guruh yarating',
              "Jonli efir va yozuvlar bilan o'qiting",
              'AI yordamida vazifa baholang',
              "Discovery orqali talabalar topadi sizni",
              'Payme orqali to&apos;lov qabul qiling',
              'Tushum analitikasi va hisobotlar',
            ]}
            cta={{
              label: 'Bepul boshlash',
              href: `/${locale}/register?role=teacher`,
            }}
            highlighted
            delay={0}
          />
          <RoleCard
            tag="TALABALAR"
            title="Sifatli o'rganing"
            icon="🎓"
            color="#5BA8FF"
            features={[
              "Eng yaxshi o'qituvchilarni toping",
              'Jonli darslar va yozuvlarni ko&apos;ring',
              'AI tutor bilan 24/7 yordam',
              "Vazifalarni topshirish va baho olish",
              'Reading da so&apos;z tarjimasi',
              'Mobil ilova bilan yo&apos;lda ham',
            ]}
            cta={{
              label: 'Talabalar uchun',
              href: `/${locale}/talabalar-uchun`,
            }}
            delay={0.1}
          />
          <RoleCard
            tag="ADMIN"
            title="Boshqaruv panel"
            icon="⚙️"
            color="#A78BFA"
            features={[
              'Foydalanuvchi va tashkilot moderatsiyasi',
              "Specialty va modullar boshqaruvi",
              "To'lov va daromad analitikasi",
              'Audit log va xavfsizlik tekshiruvi',
              'Data export (CSV / JSON)',
              'GDPR compliance asboblari',
            ]}
            cta={{
              label: 'Admin panel',
              href: `/${locale}/login`,
            }}
            delay={0.2}
          />
        </div>
      </div>
    </section>
  );
}

function RoleCard({
  tag,
  title,
  icon,
  color,
  features,
  cta,
  highlighted,
  delay,
}: {
  tag: string;
  title: string;
  icon: string;
  color: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay }}
      className={`group relative overflow-hidden rounded-3xl border p-7 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 ${
        highlighted
          ? 'border-accent2-500/40 bg-gradient-to-b from-accent2-500/[0.08] to-ink-surface/40'
          : 'border-white/[0.08] bg-ink-surface/40 hover:border-white/[0.18]'
      }`}
      style={{
        boxShadow: highlighted
          ? '0 0 0 1px rgba(0,232,122,0.2), 0 30px 80px -20px rgba(0,232,122,0.4)'
          : '0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      {/* Glow */}
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-20 blur-3xl transition-opacity duration-500 group-hover:opacity-40"
        style={{ background: color }}
      />

      <div className="relative">
        <div className="flex items-start justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim">
            {tag}
          </span>
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl text-3xl"
            style={{
              background: `linear-gradient(135deg, ${color}30 0%, ${color}10 100%)`,
              boxShadow: `0 0 0 1px ${color}40`,
            }}
          >
            {icon}
          </span>
        </div>

        <h3
          className="mt-5 text-2xl font-extrabold tracking-tight text-cream sm:text-3xl"
          style={{ letterSpacing: '-0.03em' }}
        >
          {title}
        </h3>

        <ul className="mt-6 space-y-3">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-sm text-cream-dim"
            >
              <CheckIcon
                className={
                  highlighted ? 'text-accent2-500' : 'text-accent2-500/80'
                }
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href={cta.href}
          className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all active:scale-[0.97] ${
            highlighted
              ? 'bg-accent2-500 text-ink hover:bg-accent2-400'
              : 'border border-white/[0.1] bg-white/[0.04] text-cream hover:border-white/[0.2] hover:bg-white/[0.08]'
          }`}
          style={
            highlighted
              ? {
                  boxShadow:
                    '0 0 0 1px rgba(0,232,122,0.4), 0 8px 24px -8px rgba(0,232,122,0.6)',
                }
              : undefined
          }
        >
          {cta.label}
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
