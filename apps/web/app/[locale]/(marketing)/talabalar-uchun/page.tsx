import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowRight, Quote, Search, Star } from 'lucide-react';
import {
  FadeIn,
  Stagger,
  StaggerItem,
  AnimatedCounter,
} from '../../../../components/marketing/animated';

interface StudentPageProps {
  params: { locale: string };
}

export default function StudentPage({ params: { locale } }: StudentPageProps) {
  unstable_setRequestLocale(locale);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          HERO — light, centered with search bar
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-40 top-20 h-[500px] w-[500px] rounded-full bg-blue/5 blur-[120px]" />
        <div className="pointer-events-none absolute right-0 top-1/3 h-[500px] w-[500px] rounded-full bg-purple/5 blur-[120px]" />

        <div className="relative mx-auto max-w-5xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-20 lg:px-8 lg:pt-28">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
              <span className="text-base leading-none">🎓</span>
              Talabalar uchun
            </span>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1 className="mt-7 font-display text-4xl font-extrabold leading-[0.95] tracking-tight text-ink-strong sm:text-5xl lg:text-6xl">
              O&apos;qimoq endi <span className="text-blue">qiziqarli</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
              Sevimli o&apos;qituvchingizni toping, jonli darslarda ishtirok
              eting va AI tutor bilan istalgan vaqtda mashq qiling.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={`/${locale}/search`}
                className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-blue px-7 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 hover:shadow-[0_16px_32px_-8px_rgba(0,113,227,0.6)] active:scale-[0.98]"
              >
                O&apos;qituvchini topish
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href={`/${locale}/register?role=student`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rim bg-canvas px-7 py-3.5 text-sm font-bold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
              >
                Ro&apos;yxatdan o&apos;tish
              </Link>
            </div>
            <p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
              ✓ Bepul ro&apos;yxatdan o&apos;tish · ✓ Barcha daraja uchun ingliz tili
            </p>
          </FadeIn>

          {/* Search bar */}
          <FadeIn delay={0.5}>
            <div className="mx-auto mt-12 max-w-2xl">
              <div className="rounded-2xl border border-rim bg-canvas p-2 shadow-medium">
                <div className="flex items-center gap-2">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue">
                    <Search className="h-5 w-5" />
                  </div>
                  <input
                    type="text"
                    placeholder="Masalan: 'IELTS o'qituvchisi' yoki 'Speaking darslari'"
                    className="flex-1 bg-transparent px-2 py-2 text-sm text-ink-strong placeholder-ink-faint outline-none"
                  />
                  <Link
                    href={`/${locale}/search`}
                    className="hidden rounded-xl bg-blue px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-blue-600 sm:inline-flex"
                  >
                    Qidirish
                  </Link>
                </div>
              </div>

              {/* Popular tags */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                  Mashhur:
                </span>
                {['IELTS', 'Speaking', 'Grammar', 'Business English', 'TOEFL'].map(
                  (tag) => (
                    <Link
                      key={tag}
                      href={`/${locale}/search?q=${encodeURIComponent(tag)}`}
                      className="rounded-full border border-rim bg-tint px-3 py-1 text-xs font-bold text-ink-soft transition-all hover:border-blue/20 hover:bg-blue-tint hover:text-blue"
                    >
                      {tag}
                    </Link>
                  ),
                )}
              </div>
            </div>
          </FadeIn>

          {/* Stats */}
          <Stagger className="mt-20 grid grid-cols-2 gap-x-8 gap-y-10 border-t border-rim pt-12 md:grid-cols-4">
            <StaggerItem className="text-center">
              <div className="font-display text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
                <AnimatedCounter to={5} suffix="K+" />
              </div>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                Tasdiqlangan o&apos;qituvchilar
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div className="font-display text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
                <AnimatedCounter to={100} suffix="+" />
              </div>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                Ingliz tili kurslari
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div className="font-display text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
                <AnimatedCounter to={50} suffix="K+" />
              </div>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                Tugallangan kurslar
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div className="font-display flex items-center justify-center gap-1.5 text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
                4.8<Star className="h-7 w-7 fill-orange text-orange" />
              </div>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                O&apos;rtacha baho
              </p>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          BENEFITS — bento with emoji icons
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden py-24 sm:py-32" style={{ backgroundColor: '#F5F5F7' }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <SectionLabel>Nima uchun talabalar yoqtiradi</SectionLabel>
            <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
              O&apos;qish uchun yaratilgan
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-soft sm:text-lg">
              Diqqatni jamlash, mustaqil o&apos;rganish va savol berishingiz
              uchun barcha kerakli vositalar
            </p>
          </FadeIn>

          <Stagger className="mx-auto mt-14 grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                emoji: '🤖',
                title: '24/7 AI tutor',
                desc: "Tushunmagan joyingizni istalgan vaqtda so'rang. AI tushuntiradi, lekin tayyor javob bermaydi.",
                accent: 'green' as const,
              },
              {
                emoji: '🎥',
                title: 'Jonli darslar',
                desc: "O'qituvchi bilan real-time efir. Savol bering, qo'l ko'taring, chatda muloqot qiling.",
                accent: 'blue' as const,
              },
              {
                emoji: '📝',
                title: 'AI yordamida baholash',
                desc: 'Uy vazifasi tezda tahlil qilinadi. Aniq fikr-mulohaza va qaytadan urinish imkoniyati.',
                accent: 'purple' as const,
              },
              {
                emoji: '📱',
                title: 'Mobil ilova',
                desc: "iOS va Android. Avtobusda yoki sayohatda — internetsiz ham darslarni ko'ring.",
                accent: 'orange' as const,
              },
              {
                emoji: '💬',
                title: "O'qituvchiga DM",
                desc: "To'g'ridan-to'g'ri xabar yozing. Spam himoya, tinch muhit.",
                accent: 'green' as const,
              },
              {
                emoji: '🔔',
                title: 'Aqlli xabarnomalar',
                desc: 'Dars 15 daqiqa qolganda eslatma. Yangi material, baho — hammasi vaqtida.',
                accent: 'blue' as const,
              },
            ].map((item) => (
              <StaggerItem key={item.title}>
                <BenefitCard {...item} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          HOW STUDENTS START
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="pointer-events-none absolute -right-32 top-1/4 h-[400px] w-[400px] rounded-full bg-green/5 blur-[120px]" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <SectionLabel>Talaba sifatida boshlash</SectionLabel>
            <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
              3 qadamda kursga qo&apos;shilish
            </h2>
          </FadeIn>

          <Stagger className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
            <StaggerItem>
              <StepCard
                number={1}
                title="O'qituvchini toping"
                description="Fan yoki ism bo'yicha qidiring. Profilini, kurslarini va sharhlarni ko'ring."
              />
            </StaggerItem>
            <StaggerItem>
              <StepCard
                number={2}
                title="Payme orqali to'lang"
                description="Xavfsiz to'lov. To'lov o'tgandan keyin o'qituvchiga avtomatik so'rov yuboriladi."
              />
            </StaggerItem>
            <StaggerItem>
              <StepCard
                number={3}
                title="Darslarni boshlang"
                description="O'qituvchi tasdiqlagandan keyin barcha darslar, jonli efir va AI tutorga kirish ochiladi."
              />
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          STUDENT TESTIMONIAL
          ═══════════════════════════════════════════════════════════════ */}
      <section className="py-24 sm:py-32" style={{ backgroundColor: '#F5F5F7' }}>
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <figure className="text-center">
              <Quote className="mx-auto h-12 w-12 text-blue/40" />
              <blockquote className="mt-8 font-display text-2xl font-medium leading-snug tracking-tight text-ink-strong sm:text-3xl">
                &ldquo;AI tutor menga tayyor javob bermaydi, lekin shu o&apos;zi
                yoqimli — chunki o&apos;rganishga majbur qiladi. IELTS&apos;da
                7.5 oldim!&rdquo;
              </blockquote>
              <figcaption className="mt-10 flex items-center justify-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue text-lg font-bold text-white">
                  M
                </div>
                <div className="text-left">
                  <div className="font-bold text-ink-strong">Madina K.</div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                    IELTS Pre-Intermediate · 11-sinf
                  </div>
                </div>
              </figcaption>
            </figure>
          </FadeIn>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FINAL CTA
          ═══════════════════════════════════════════════════════════════ */}
      <section className="pb-24 sm:pb-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="relative overflow-hidden rounded-3xl border border-blue/15 bg-white p-10 shadow-[0_32px_64px_-16px_rgba(0,113,227,0.12)] sm:p-16">
              <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[100px]" />
              <div className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-purple/5 blur-[100px]" />

              <div className="relative mx-auto max-w-3xl text-center">
                <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
                  Bepul ro&apos;yxatdan o&apos;ting
                </h2>
                <p className="mt-4 text-ink-soft">
                  Talaba sifatida ro&apos;yxatdan o&apos;tish bepul. Faqat kurs
                  uchun o&apos;qituvchiga to&apos;laysiz.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link
                    href={`/${locale}/register?role=student`}
                    className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-blue px-7 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_-8px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
                  >
                    Ro&apos;yxatdan o&apos;tish
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                  <Link
                    href={`/${locale}/search`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rim bg-canvas px-7 py-3.5 text-sm font-bold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
                  >
                    Avval qidirib ko&apos;rish
                  </Link>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Sub-components
// ═════════════════════════════════════════════════════════════════════

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
      <span className="h-1.5 w-1.5 rounded-full bg-blue" />
      {children}
    </span>
  );
}

function BenefitCard({
  emoji,
  title,
  desc,
  accent,
}: {
  emoji: string;
  title: string;
  desc: string;
  accent: 'green' | 'blue' | 'purple' | 'orange';
}) {
  const accentHover = {
    green: 'hover:border-green/20',
    blue: 'hover:border-blue/20',
    purple: 'hover:border-purple/20',
    orange: 'hover:border-orange/20',
  }[accent];

  return (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border border-rim bg-canvas p-7 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-medium ${accentHover}`}
    >
      <div className="text-4xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6">
        {emoji}
      </div>
      <h3 className="mt-5 text-lg font-extrabold tracking-tight text-ink-strong">
        {title}
      </h3>
      <p className="mt-2 text-sm text-ink-soft">{desc}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="group relative h-full overflow-hidden rounded-3xl border border-rim bg-canvas p-8 shadow-soft transition-all hover:border-blue/20 hover:shadow-medium">
      <div className="font-display text-7xl font-bold text-blue/10 transition-colors group-hover:text-blue/20">
        0{number}
      </div>
      <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-strong">
        {title}
      </h3>
      <p className="mt-3 text-ink-soft">{description}</p>
    </div>
  );
}
