'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * FaqSection — accordion FAQ
 */
export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="relative overflow-hidden bg-ink py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cream-dim"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Tez-tez so&apos;raladigan
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-5 text-balance font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
              letterSpacing: '-0.04em',
            }}
          >
            Sizda <span className="text-accent2-500">savol</span> bormi?
          </motion.h2>
        </div>

        {/* FAQ items */}
        <div className="mt-14 space-y-3">
          {FAQS.map((faq, i) => (
            <FaqItem
              key={faq.q}
              {...faq}
              isOpen={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              delay={i * 0.05}
            />
          ))}
        </div>

        {/* Contact CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mt-14 flex flex-col items-center gap-4 rounded-3xl border border-white/[0.08] bg-ink-surface/40 p-8 text-center backdrop-blur-sm"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent2-500/10 text-2xl ring-1 ring-inset ring-accent2-500/30">
            💬
          </div>
          <div>
            <p className="text-lg font-bold text-cream">Yana savollar bormi?</p>
            <p className="mt-1 text-sm text-cream-dim">
              Telegram bot yoki email orqali biz bilan bog&apos;laning
            </p>
          </div>
          <div className="flex gap-3">
            <a
              href="https://t.me/edubridge_uz"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
              Telegram
            </a>
            <a
              href="mailto:hello@edubridge.uz"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Email
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: 'EduBridge nima va kimlar uchun?',
    a: 'EduBridge — O‘zbekistondagi onlayn o‘qituvchilar va talabalarni bog‘lovchi platforma. O‘qituvchilar kurs yaratadi, jonli efir o‘tkazadi, vazifa beradi va to‘lov qabul qiladi. Talabalar esa kurslarga qo‘shilib, AI yordamchi bilan o‘rganadilar.',
  },
  {
    q: '14 kun bepul davrida nima bor?',
    a: 'Trial davrida barcha asosiy imkoniyatlar — cheksiz kurs/guruh, jonli efir, AI Tutor, vazifa baholash, chat, schedule — ochiq. 14 kundan so‘ng siz Starter yoki Pro tarifiga o‘tasiz, yoki to‘xtatib qo‘yasiz.',
  },
  {
    q: 'AI Tutor talabaga vazifa javobini yozib beradimi?',
    a: 'YO‘Q. Bu eng muhim qoida. Claude AI faqat tushuntiradi, misol keltiradi va o‘rgatadi — lekin yakuniy javobni yozib bermaydi. Plagiat oldini olish va o‘quv sifatini saqlash uchun.',
  },
  {
    q: 'Jonli efir qancha talabaga bir vaqtda yetadi?',
    a: 'Bizning mediasoup SFU 500+ ishtirokchini bir vaqtda qo‘llab-quvvatlaydi. Video sifati 1080p gacha, audio kristal aniq. Dars avtomatik HLS formatda yozib olinadi.',
  },
  {
    q: 'Qanday to‘lov qabul qilaman?',
    a: 'Payme orqali to‘g‘ridan-to‘g‘ri talabalardan to‘lov qabul qilasiz. Subscription va kurs to‘lovlari avtomatik. Tushum va refund hisobotlari dashboard da.',
  },
  {
    q: 'Mobil ilova bormi?',
    a: 'Ha, React Native (Expo) asosida iOS va Android uchun ilova mavjud. Push xabarnoma, offline lesson ko‘rish, sync qilish — barchasi qo‘llab-quvvatlanadi.',
  },
  {
    q: 'Talabalar meni qanday topadi?',
    a: 'Public profil sahifangiz (edubridge.uz/t/sizning-username) avtomatik yaratiladi. Discovery qidiruvida ko‘rinasiz. Yoki invite link orqali to‘g‘ridan-to‘g‘ri taklif qila olasiz.',
  },
  {
    q: 'Ma‘lumotlarim xavfsizmi?',
    a: 'Ha. Barcha ma‘lumotlar AES-256-GCM bilan shifrlangan, TLS 1.3 orqali uzatiladi. MFA, audit log, GDPR-compatible va O‘zbekiston PDP qonuniga moslashtirilgan.',
  },
];

function FaqItem({
  q,
  a,
  isOpen,
  onToggle,
  delay,
}: {
  q: string;
  a: string;
  isOpen: boolean;
  onToggle: () => void;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay }}
      className={`overflow-hidden rounded-2xl border transition-all ${
        isOpen
          ? 'border-accent2-500/30 bg-accent2-500/[0.04]'
          : 'border-white/[0.08] bg-ink-surface/30 hover:border-white/[0.15]'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span
          className="text-base font-bold text-cream sm:text-lg"
          style={{ letterSpacing: '-0.02em' }}
        >
          {q}
        </span>
        <span
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all ${
            isOpen
              ? 'bg-accent2-500 text-ink'
              : 'bg-white/[0.05] text-cream-dim'
          }`}
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="px-5 pb-5 text-sm leading-relaxed text-cream-dim sm:text-base">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
