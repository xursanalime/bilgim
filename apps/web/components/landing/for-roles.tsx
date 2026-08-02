'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  GraduationCap,
  BookOpenCheck,
  Settings,
  ArrowRight,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { SectionHeader } from './features-bento';

export function ForRoles({ locale }: { locale: string }) {
  return (
    <section className="relative overflow-hidden section">
      <div className="container-page">
        <SectionHeader
          eyebrow="Har kim uchun"
          title={
            <>
              Bilgim —{' '}
              <span className="italic text-hero-gradient">siz</span> uchun
            </>
          }
          subtitle="O'qituvchi, talaba yoki administrator — har bir rol uchun maxsus tayyorlangan ish vositasi."
        />

        <div className="mx-auto mt-14 grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-3">
          <RoleCard
            tag="O'QITUVCHILAR"
            title="Daromad oling"
            icon={GraduationCap}
            tone="blue"
            features={[
              'Cheksiz kurs va guruh yarating',
              "Jonli darslar va yozuvlar bilan o'qiting",
              'AI yordamida vazifa baholang',
              "Talabalar sizni topishlari uchun ochiq sahifa",
              "Payme orqali to'lov qabul qiling",
              'Tushum va statistika hisobotlari',
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
            icon={BookOpenCheck}
            tone="green"
            features={[
              "Eng yaxshi o'qituvchilarni toping",
              "Jonli darslar va yozuvlarni ko'ring",
              'AI yordamchi 24 soat ishlaydi',
              "Vazifalarni topshirish va baho olish",
              "O'qish paytida so'z tarjimasi",
              "Mobil ilova bilan yo'lda ham",
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
            icon={Settings}
            tone="purple"
            features={[
              'Foydalanuvchi va tashkilot moderatsiyasi',
              "Yo'nalish va modullar boshqaruvi",
              "To'lov va daromad statistikasi",
              "Audit jurnali va xavfsizlik tekshiruvi",
              'Maʼlumotlarni eksport qilish',
              "Ma'lumotlar himoyasi vositalari",
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
  icon: Icon,
  tone,
  features,
  cta,
  highlighted,
  delay,
}: {
  tag: string;
  title: string;
  icon: LucideIcon;
  tone: 'blue' | 'green' | 'purple';
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
  delay: number;
}) {
  const colors = {
    blue: { hex: '#0071E3', bg: 'bg-blue-tint', text: 'text-blue', glow: 'rgba(0, 113, 227, 0.3)' },
    green: { hex: '#0071E3', bg: 'bg-teal-tint', text: 'text-teal', glow: 'rgba(0,113,227, 0.3)' },
    purple: { hex: '#AF52DE', bg: 'bg-purple-tint', text: 'text-purple', glow: 'rgba(175, 82, 222, 0.3)' },
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay }}
      className={`group relative overflow-hidden rounded-3xl border p-7 transition-all duration-500 hover:-translate-y-1 ${
        highlighted
          ? 'border-blue/20 bg-gradient-to-b from-blue/[0.04] to-canvas shadow-medium'
          : 'border-rim bg-canvas hover:border-rim-2 hover:shadow-medium'
      }`}
      style={{
        boxShadow: highlighted
          ? `0 0 0 1px ${colors.glow}, 0 30px 80px -20px ${colors.glow}`
          : '0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px -12px rgba(0, 0, 0, 0.06)',
      }}
    >
      <div className="relative">
        <div className="flex items-start justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink-soft">
            {tag}
          </span>
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-2xl ${colors.bg}`}
          >
            <Icon className={`h-6 w-6 ${colors.text}`} strokeWidth={2} />
          </span>
        </div>

        <h3
          className="mt-5 text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl"
          style={{ letterSpacing: '-0.03em' }}
        >
          {title}
        </h3>

        <ul className="mt-6 space-y-2.5">
          {features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2.5 text-sm text-ink-soft"
            >
              <Check
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                style={{ color: highlighted ? colors.hex : '#0071E3' }}
                strokeWidth={3}
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Link
          href={cta.href}
          className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all active:scale-[0.97] ${
            highlighted
              ? 'bg-blue text-white hover:bg-blue-600'
              : 'border border-rim bg-canvas text-white hover:border-rim-2 hover:bg-tint'
          }`}
          style={
            highlighted
              ? {
                  boxShadow:
                    '0 0 0 1px rgba(0, 113, 227, 0.4), 0 8px 24px -8px rgba(0, 113, 227, 0.5)',
                }
              : undefined
          }
        >
          {cta.label}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </Link>
      </div>
    </motion.div>
  );
}
