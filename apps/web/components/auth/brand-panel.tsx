'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

interface BrandPanelProps {
  locale: string;
}

const HIGHLIGHTS = [
  {
    title: 'AI yordamchi tutor',
    description:
      'Talabalar har qanday savolga tezda javob oladi, o‘qituvchilar darslarni boshqaradi.',
  },
  {
    title: 'Live efir va guruhli darslar',
    description:
      'Guruhlar uchun jonli efirlar, jadval va modul boshqaruvi — barchasi bir joyda.',
  },
  {
    title: 'AI baholash + analytics',
    description:
      'Uy vazifalari avtomatik baholanadi, har bir guruh statistika bilan ta’minlangan.',
  },
];

/**
 * BrandPanel — left split of the auth screen on lg+ viewports.
 * Forest 800 background with animated orbs, brand mark, testimonial,
 * and feature highlights to anchor the user inside the EduBridge world.
 */
export function BrandPanel({ locale }: BrandPanelProps) {
  return (
    <div className="relative hidden h-full flex-col overflow-hidden bg-forest-800 px-10 py-12 text-pomelo-100 lg:flex">
      {/* Animated orbs */}
      <motion.div
        aria-hidden
        className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-pomelo-400/20 blur-3xl"
        animate={{ y: [0, 30, 0], x: [0, 20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-24 -right-12 h-96 w-96 rounded-full bg-gold-400/20 blur-3xl"
        animate={{ y: [0, -30, 0], x: [0, -20, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="pomelo-grain pointer-events-none absolute inset-0 opacity-[0.08]" />

      {/* Logo */}
      <Link
        href={`/${locale}`}
        className="relative z-10 inline-flex items-center gap-2 self-start text-lg font-bold tracking-tight"
      >
        <motion.span
          whileHover={{ rotate: 6 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-pomelo-100 text-forest-800 shadow-lg shadow-forest-900/40"
        >
          <Logo />
        </motion.span>
        EduBridge
      </Link>

      {/* Center: testimonial */}
      <div className="relative z-10 mt-16 flex-1">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-pomelo-100/15 bg-pomelo-100/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-pomelo-100/70">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
            EduBridge
          </div>

          <h2 className="mt-6 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Bilim&apos;ga{' '}
            <span className="bg-gradient-to-r from-pomelo-300 via-gold-300 to-pomelo-200 bg-clip-text text-transparent">
              ko&apos;prik quring
            </span>
          </h2>

          <p className="mt-4 max-w-md text-base text-pomelo-100/75">
            O&apos;zbekistonning eng zamonaviy onlayn ta&apos;lim platformasi.
            O&apos;qituvchilar, talabalar va AI yordamchi — bitta ekosistemada.
          </p>

          <div className="mt-10 grid gap-4">
            {HIGHLIGHTS.map((h, i) => (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.55,
                  ease: [0.22, 1, 0.36, 1],
                  delay: 0.15 + i * 0.1,
                }}
                className="flex items-start gap-3 rounded-2xl border border-pomelo-100/10 bg-pomelo-100/5 p-4 backdrop-blur-sm"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-400 text-forest-800 shadow-sm">
                  <CheckIcon />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-pomelo-100">
                    {h.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-pomelo-100/70">
                    {h.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Bottom testimonial */}
      <motion.figure
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mt-12 rounded-3xl border border-pomelo-100/10 bg-forest-700/40 p-5 backdrop-blur-sm"
      >
        <blockquote className="text-sm italic leading-relaxed text-pomelo-100/85">
          &ldquo;EduBridge orqali 200 dan ortiq talabamga uzoqdan ta&apos;lim bera
          olmoqdaman. AI yordamchi vaqtimni qisqartirdi, jonli efirlar esa
          guruhlarni hayotga tatib qo&apos;ydi.&rdquo;
        </blockquote>
        <figcaption className="mt-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pomelo-100 text-sm font-bold text-forest-800">
            S
          </span>
          <span>
            <span className="block text-sm font-semibold text-pomelo-100">
              Sefer Aliyev
            </span>
            <span className="block text-xs text-pomelo-100/60">
              Ingliz tili o&apos;qituvchisi
            </span>
          </span>
        </figcaption>
      </motion.figure>
    </div>
  );
}

function Logo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
