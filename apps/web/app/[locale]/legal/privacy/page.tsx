import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

interface Props {
  params: { locale: string };
}

export function generateMetadata(): Metadata {
  return {
    title: 'Maxfiylik siyosati — Bilgim',
    description:
      'Bilgim platformasi qanday ma’lumotlarni to‘playdi, ulardan qanday foydalanadi va ularni qanday himoya qiladi.',
  };
}

export default function PrivacyPage({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);
  return (
    <main className="min-h-screen bg-base text-ink-strong">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-blue"
        >
          <ArrowLeft className="h-4 w-4" /> Bosh sahifa
        </Link>

        <h1 className="mt-6 text-3xl font-black tracking-tight sm:text-4xl">
          Maxfiylik siyosati
        </h1>
        <p className="mt-2 text-sm text-ink-faint">
          Oxirgi yangilanish: 2026-yil. Bilgim platformasi (bilgim.uz).
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-ink-soft sm:text-base">
          <Section n="1" title="Biz to‘playdigan ma’lumotlar">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Hisob ma’lumotlari: ism, email, username, rol (o‘qituvchi/talaba).</li>
              <li>Foydalanish ma’lumotlari: darslar, vazifalar, progress, XP.</li>
              <li>To‘lov ma’lumotlari: Payme orqali (karta ma’lumotlari bizda saqlanmaydi).</li>
              <li>Texnik ma’lumotlar: IP, qurilma turi, brauzer — xavfsizlik uchun.</li>
            </ul>
          </Section>

          <Section n="2" title="Ma’lumotlardan foydalanish">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Xizmatni taqdim etish va yaxshilash.</li>
              <li>Bildirishnomalar yuborish (in-app, email, Telegram).</li>
              <li>Xavfsizlik, firibgarlik va kontent o‘g‘irlanishining oldini olish.</li>
              <li>Statistika va tahlil (anonim shaklda).</li>
            </ul>
          </Section>

          <Section n="3" title="Kontent himoyasi va watermark">
            <p>
              Video darslarni himoya qilish maqsadida har bir ko‘rish vaqtida
              videoga foydalanuvchining yashirin ID belgisi (watermark)
              qo‘shiladi. Bu belgi kontent ruxsatsiz tarqalgan taqdirda manbani
              aniqlashga xizmat qiladi. Shuningdek, imzolangan (vaqt bilan
              cheklangan) havolalar va ekran yozuvini aniqlash choralari
              qo‘llaniladi.
            </p>
          </Section>

          <Section n="4" title="Ma’lumotlarni uchinchi tomonlar bilan bo‘lishish">
            <p>
              Biz sizning shaxsiy ma’lumotlaringizni sotmaymiz. Ma’lumotlar
              faqat xizmat ko‘rsatish uchun zarur bo‘lgan provayderlar bilan
              bo‘lishiladi: to‘lov (Payme), video (LiveKit), email (SMTP),
              Telegram bot, AI provayderlari. Har biri o‘z maqsadi doirasida
              ishlaydi.
            </p>
          </Section>

          <Section n="5" title="Xavfsizlik">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Parollar kriptografik xeshlanadi (hech kim, jumladan biz ham, ko‘ra olmaydi).</li>
              <li>Maxfiy maydonlar shifrlanadi.</li>
              <li>Ko‘p bosqichli autentifikatsiya (MFA) mavjud.</li>
              <li>Barcha aloqa shifrlangan kanal orqali uzatiladi.</li>
            </ul>
          </Section>

          <Section n="6" title="Sizning huquqlaringiz">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>O‘z ma’lumotlaringizni ko‘rish va tahrirlash.</li>
              <li>Hisobni va ma’lumotlarni o‘chirishni so‘rash.</li>
              <li>Bildirishnomalardan voz kechish.</li>
            </ul>
          </Section>

          <Section n="7" title="Bolalar maxfiyligi">
            <p>
              18 yoshga to‘lmagan foydalanuvchilar platformadan ota-ona yoki
              ustoz nazorati ostida foydalanishi tavsiya etiladi.
            </p>
          </Section>

          <Section n="8" title="Bog‘lanish">
            <p>
              Maxfiylik bo‘yicha savollar:{' '}
              <a className="font-semibold text-blue hover:underline" href="mailto:hello@bilgim.uz">
                hello@bilgim.uz
              </a>
              .
            </p>
          </Section>
        </div>

        <div className="mt-12 border-t border-rim pt-6">
          <Link href={`/${locale}/legal/terms`} className="text-sm font-semibold text-blue hover:underline">
            ← Foydalanish shartlari
          </Link>
        </div>
      </div>
    </main>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-extrabold tracking-tight text-ink-strong">
        <span className="text-blue">{n}.</span> {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
