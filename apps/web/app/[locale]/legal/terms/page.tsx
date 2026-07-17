import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

interface Props {
  params: { locale: string };
}

export function generateMetadata(): Metadata {
  return {
    title: 'Foydalanish shartlari — Bilgim',
    description:
      'Bilgim platformasidan foydalanish shartlari: huquq va majburiyatlar, kontent himoyasi va kontent o‘g‘irlangan taqdirdagi oqibatlar.',
  };
}

export default function TermsPage({ params: { locale } }: Props) {
  unstable_setRequestLocale(locale);
  return (
    <main className="min-h-screen bg-surface text-ink-strong">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-blue"
        >
          <ArrowLeft className="h-4 w-4" /> Bosh sahifa
        </Link>

        <h1 className="mt-6 text-3xl font-black tracking-tight sm:text-4xl">
          Foydalanish shartlari
        </h1>
        <p className="mt-2 text-sm text-ink-faint">
          Oxirgi yangilanish: 2026-yil. Bilgim platformasi (bilgim.uz).
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-ink-soft sm:text-base">
          <Section n="1" title="Umumiy qoidalar">
            <p>
              Ushbu shartlar Bilgim platformasidan (keyingi o‘rinlarda —
              «Platforma») foydalanuvchi o‘qituvchi, talaba va boshqa
              foydalanuvchilar bilan Platforma o‘rtasidagi munosabatlarni
              tartibga soladi. Platformadan foydalanish orqali siz ushbu
              shartlarni to‘liq qabul qilgan hisoblanasiz.
            </p>
          </Section>

          <Section n="2" title="Hisob va xavfsizlik">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Siz hisobingiz va parolingiz maxfiyligi uchun javobgarsiz.</li>
              <li>Bir hisobdan faqat uning egasi foydalanishi lozim.</li>
              <li>Shubhali faollik aniqlansa, hisob vaqtincha bloklanishi mumkin.</li>
            </ul>
          </Section>

          <Section n="3" title="Kontent va mualliflik huquqi">
            <p>
              O‘qituvchilar tomonidan yuklangan video darslar, materiallar,
              uy ishlari va boshqa kontentning mualliflik huquqi mualliflarga
              tegishli. Talabalarga kontent faqat <strong>shaxsiy ta’lim
              maqsadida ko‘rish</strong> uchun beriladi.
            </p>
          </Section>

          <Section n="4" title="Kontentni nusxalash va o‘g‘irlash taqiqlanadi">
            <p className="font-semibold text-ink-strong">
              Quyidagilar qat’iyan taqiqlanadi:
            </p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                Video darslar yoki materiallarni ekrandan yozib olish, yuklab
                olish yoki tarqatish.
              </li>
              <li>
                Kontentni boshqa platformalarga (Telegram, YouTube, ijtimoiy
                tarmoqlar va h.k.) ruxsatsiz joylashtirish.
              </li>
              <li>
                Hisobni boshqalar bilan bo‘lishish yoki kirish ma’lumotlarini
                sotish.
              </li>
              <li>Platforma himoya choralarini chetlab o‘tishga urinish.</li>
            </ul>
            <div className="mt-4 rounded-2xl border border-red/30 bg-red-tint/40 p-4">
              <p className="font-bold text-red">
                Kontent o‘g‘irlangan taqdirda oqibatlar:
              </p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-soft">
                <li>
                  Hisob darhol va ogohlantirishsiz bloklanadi, barcha kirish
                  huquqlari bekor qilinadi.
                </li>
                <li>
                  Har bir video ustida foydalanuvchining yashirin ID belgisi
                  (watermark) joylashtirilganligi sababli, tarqalgan nusxa
                  orqali aybdor aniqlanadi.
                </li>
                <li>
                  Yetkazilgan zarar (mualliflik huquqi buzilishi) uchun
                  O‘zbekiston Respublikasi qonunchiligiga muvofiq fuqarolik va
                  jinoiy javobgarlik qo‘llanilishi mumkin.
                </li>
                <li>
                  Platforma zararni undirish uchun sudga murojaat qilish
                  huquqini saqlab qoladi.
                </li>
              </ul>
              <p className="mt-3 text-xs text-ink-faint">
                Eslatma: hech qanday raqamli himoya 100% kafolat bermaydi.
                Platforma himoyani kuchaytirish uchun watermark, imzolangan
                havolalar va ekran yozuvini aniqlash kabi choralarni qo‘llaydi,
                ammo foydalanuvchidan ham halol foydalanish talab qilinadi.
              </p>
            </div>
          </Section>

          <Section n="5" title="To‘lovlar">
            <p>
              Kurs va obuna to‘lovlari Payme orqali amalga oshiriladi.
              To‘lovlar shartlari kurs/obuna sahifasida ko‘rsatiladi. Qaytarish
              siyosati alohida belgilanadi.
            </p>
          </Section>

          <Section n="6" title="Taqiqlangan harakatlar">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Platformadan noqonuniy maqsadlarda foydalanish.</li>
              <li>Boshqa foydalanuvchilarni haqorat qilish yoki bezovta qilish.</li>
              <li>Spam, firibgarlik yoki zararli dasturlar tarqatish.</li>
            </ul>
          </Section>

          <Section n="7" title="Javobgarlikni cheklash">
            <p>
              Platforma uzluksiz va xatosiz ishlashini kafolatlamaydi.
              Texnik nosozliklar yoki uchinchi tomon xizmatlari (LiveKit,
              Payme, AI provayderlari) bilan bog‘liq uzilishlar uchun
              javobgarlik cheklangan.
            </p>
          </Section>

          <Section n="8" title="Shartlarning o‘zgarishi">
            <p>
              Platforma ushbu shartlarni istalgan vaqtda yangilashi mumkin.
              Muhim o‘zgarishlar haqida foydalanuvchilar xabardor qilinadi.
            </p>
          </Section>

          <Section n="9" title="Bog‘lanish">
            <p>
              Savollar bo‘yicha:{' '}
              <a className="font-semibold text-blue hover:underline" href="mailto:hello@bilgim.uz">
                hello@bilgim.uz
              </a>{' '}
              yoki{' '}
              <a className="font-semibold text-blue hover:underline" href="https://t.me/bilgim_uz">
                Telegram
              </a>
              .
            </p>
          </Section>
        </div>

        <div className="mt-12 border-t border-rim pt-6">
          <Link href={`/${locale}/legal/privacy`} className="text-sm font-semibold text-blue hover:underline">
            Maxfiylik siyosati →
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
