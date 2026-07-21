'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Send, Mail, MessageCircle } from 'lucide-react';
import { SectionHeader } from './features-bento';

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="relative overflow-hidden section">
      <div className="container-aurora">
        <SectionHeader
          eyebrow="Tez-tez so'raladigan"
          title={
            <>
              Sizda <span className="italic text-hero-gradient">savol</span>{' '}
              bormi?
            </>
          }
        />

        <div className="mx-auto mt-14 max-w-3xl space-y-3">
          {FAQS.map((f, i) => (
            <Item
              key={f.q}
              {...f}
              isOpen={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              delay={i * 0.04}
            />
          ))}
        </div>

        {/* Contact card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mx-auto mt-12 flex max-w-3xl flex-col items-center gap-4 rounded-3xl border border-rim bg-canvas p-8 text-center shadow-soft sm:flex-row sm:text-left"
        >
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-blue text-white shadow-blue-soft">
            <MessageCircle className="h-6 w-6" strokeWidth={2} />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-ink-strong">Yana savollar bormi?</p>
            <p className="mt-1 text-sm text-ink-soft">
              Telegram yoki email orqali biz bilan bog&apos;laning
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="https://t.me/edubridge_uz"
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 text-sm font-semibold text-ink-strong transition-all hover:border-blue/30 hover:bg-blue-tint hover:text-blue"
            >
              <Send className="h-4 w-4" strokeWidth={2.25} />
              Telegram
            </a>
            <a
              href="mailto:hello@edubridge.uz"
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 text-sm font-semibold text-ink-strong transition-all hover:border-green/30 hover:bg-green-tint hover:text-green"
            >
              <Mail className="h-4 w-4" strokeWidth={2.25} />
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
    q: 'EduBridge kimlar uchun?',
    a: "EduBridge — O'zbekistondagi onlayn ingliz tili o'qituvchilari va talabalari uchun. O'qituvchilar ingliz tili kurslarini yaratadi, jonli darslar o'tkazadi, vazifa beradi va to'lov qabul qiladi. Talabalar kurslarga qo'shilib, AI yordamchi bilan ingliz tilini o'rganadilar.",
  },
  {
    q: '14 kun bepul davrida nima bor?',
    a: "Bepul davrida barcha asosiy imkoniyatlar — cheksiz kurs/guruh, jonli darslar, AI yordamchi, vazifa baholash, chat, jadval — ochiq. 14 kundan so'ng siz Starter yoki Pro tarifiga o'tasiz, yoki to'xtatib qo'yasiz. Karta kerak emas.",
  },
  {
    q: 'AI yordamchi talabaga vazifa javobini yozib beradimi?',
    a: "Yo'q. Bu eng muhim qoida. AI faqat tushuntiradi, misol keltiradi va o'rgatadi — lekin yakuniy javobni yozib bermaydi. Talaba o'zi o'ylab javob topadi.",
  },
  {
    q: 'Jonli darsda qancha talaba bo&apos;lishi mumkin?',
    a: "Bizning tizimimiz 500 ta talabani bir vaqtda qo'llab-quvvatlaydi. Video sifati eng yuqori darajada, ovoz toza, kechikish minimal. Har bir dars avtomatik yozib olinadi.",
  },
  {
    q: "To'lovni qanday qabul qilaman?",
    a: "Payme orqali to'g'ridan-to'g'ri talabalardan to'lov qabul qilasiz. Obuna va kurs to'lovlari avtomatik. Tushum, qaytarish va soliq hisobotlari boshqaruv panelida.",
  },
  {
    q: 'Mobil ilova bormi?',
    a: "Ha, iOS va Android uchun ilova mavjud. Push xabarnoma, oflayn rejimda dars ko'rish, sinxronlash — barchasi ishlaydi.",
  },
  {
    q: 'Talabalar meni qanday topadi?',
    a: "Sizning ochiq sahifangiz (edubridge.uz/t/sizning-username) avtomatik yaratiladi. Qidiruv tizimida ko'rinasiz. Yoki maxsus havola orqali to'g'ridan-to'g'ri taklif qila olasiz.",
  },
  {
    q: "Ma'lumotlarim xavfsizmi?",
    a: "Ha. Barcha ma'lumotlar shifrlangan, xavfsiz aloqa kanali orqali uzatiladi. Ko'p bosqichli autentifikatsiya, audit jurnali va O'zbekiston shaxsiy ma'lumotlar himoyasi qonuniga moslashtirilgan.",
  },
];

function Item({
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
      className={`overflow-hidden rounded-3xl border transition-all ${
        isOpen
          ? 'border-blue/20 bg-blue-tint/30 shadow-soft'
          : 'border-rim bg-canvas hover:border-rim-2 hover:shadow-soft'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <span
          className="text-base font-bold text-ink-strong sm:text-lg"
          style={{ letterSpacing: '-0.02em' }}
        >
          {q}
        </span>
        <span
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all ${
            isOpen ? 'bg-blue text-white' : 'bg-soft text-ink-soft'
          }`}
        >
          <Plus
            className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}
            strokeWidth={3}
          />
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
            <p className="px-6 pb-6 text-sm leading-relaxed text-ink-soft sm:text-base">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
