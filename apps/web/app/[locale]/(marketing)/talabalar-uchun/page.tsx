import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowRight, Search } from 'lucide-react';
import {
  FadeIn,
  Stagger,
  StaggerItem,
  AnimatedCounter,
} from '../../../../components/marketing/animated';
import { Button } from '../../../../components/ui/button';

interface StudentPageProps {
  params: { locale: string };
}

export function generateMetadata({
  params: { locale },
}: StudentPageProps): Metadata {
  const title = "Talabalar uchun — Bilgim bilan ingliz tilini o'rganing";
  const description =
    "Sevimli ingliz tili o'qituvchingizni toping, jonli darslarda ishtirok eting " +
    'va AI tutor bilan istalgan vaqtda mashq qiling. Bepul ro\u2019yxatdan o\u2019tish.';

  return {
    title,
    description,
    alternates: { canonical: `/${locale}/talabalar-uchun` },
    openGraph: {
      title,
      description,
      type: 'website',
      locale,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function StudentPage({ params: { locale } }: StudentPageProps) {
  unstable_setRequestLocale(locale);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          HERO — light, centered with search bar
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative isolate overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-dotgrid opacity-40" />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 top-20 h-[500px] w-[500px] rounded-full opacity-60"
          style={{
            background:
              'radial-gradient(circle, rgba(0, 113, 227, 0.16) 0%, transparent 70%)',
            filter: 'blur(80px)',
            mixBlendMode: 'multiply',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-1/3 h-[500px] w-[500px] rounded-full opacity-60"
          style={{
            background:
              'radial-gradient(circle, rgba(52, 199, 89, 0.14) 0%, transparent 70%)',
            filter: 'blur(80px)',
            mixBlendMode: 'multiply',
          }}
        />

        <div className="container-aurora relative pb-20 pt-8 text-center sm:pt-10 lg:pt-16">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
              <span className="text-base leading-none">🎓</span>
              Talabalar uchun
            </span>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1
              className="mt-7 text-balance font-display font-extrabold leading-[0.95] text-ink-strong"
              style={{
                fontSize: 'clamp(2.75rem, 6vw, 5rem)',
                letterSpacing: '-0.04em',
                fontWeight: 900,
              }}
            >
              O&apos;qimoq endi{' '}
              <span className="relative inline-block">
                <span className="relative z-10 italic text-hero-gradient">
                  qiziqarli
                </span>
                <svg
                  className="absolute -bottom-2 left-0 z-0 h-3 w-full text-blue/40"
                  viewBox="0 0 200 12"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M0 8 Q 50 0, 100 6 T 200 4"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-ink-soft sm:text-lg">
              Sevimli ingliz tili o&apos;qituvchingizni toping, jonli darslarda
              ishtirok eting va AI tutor bilan istalgan vaqtda mashq qiling.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
              >
                <Link href={`/${locale}/search`}>O&apos;qituvchini topish</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href={`/${locale}/register?role=student`}>
                  Ro&apos;yxatdan o&apos;tish
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              ✓ Bepul ro&apos;yxatdan o&apos;tish · ✓ Barcha daraja uchun ingliz tili
            </p>
          </FadeIn>

          {/* Search bar */}
          <FadeIn delay={0.5}>
            <div className="mx-auto mt-12 max-w-2xl">
              <div className="rounded-2xl border border-rim bg-canvas p-2 shadow-medium">
                <div className="flex items-center gap-2">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue">
                    <Search className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <input
                    type="text"
                    placeholder="Masalan: 'IELTS o'qituvchisi' yoki 'Speaking darslari'"
                    className="flex-1 bg-transparent px-2 py-2 text-sm text-ink-strong placeholder-ink-faint outline-none"
                  />
                  <Button asChild size="md" className="hidden sm:inline-flex">
                    <Link href={`/${locale}/search`}>Qidirish</Link>
                  </Button>
                </div>
              </div>

              {/* Popular tags */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                  Mashhur:
                </span>
                {['IELTS', 'Speaking', 'Grammar', 'Business English', 'TOEFL'].map(
                  (tag) => (
                    <Link
                      key={tag}
                      href={`/${locale}/search?q=${encodeURIComponent(tag)}`}
                      className="rounded-full border border-rim bg-canvas px-3 py-1 text-xs font-semibold text-ink-soft transition-all hover:border-blue/40 hover:bg-blue-tint hover:text-blue"
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
              <div
                className="font-extrabold text-ink-strong"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                <AnimatedCounter to={5} suffix="K+" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft">
                Tasdiqlangan o&apos;qituvchilar
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-ink-strong"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                <AnimatedCounter to={100} suffix="+" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft">
                Ingliz tili kurslari
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-ink-strong"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                <AnimatedCounter to={50} suffix="K+" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft">
                Tugallangan kurslar
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-ink-strong"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                4.8<span className="text-blue">★</span>
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft">
                O&apos;rtacha baho
              </p>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          BENEFITS — bento with emoji icons
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-tint section">
        <div className="container-aurora">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <SectionLabel>Nima uchun talabalar yoqtiradi</SectionLabel>
            <h2
              className="mt-4 text-balance font-extrabold tracking-tight text-ink-strong"
              style={{
                fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
                letterSpacing: '-0.04em',
              }}
            >
              O&apos;qish uchun yaratilgan
            </h2>
            <p className="mt-4 text-base text-ink-soft sm:text-lg">
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
                accent: 'purple' as const,
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
                accent: 'green' as const,
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
                accent: 'blue' as const,
              },
              {
                emoji: '🔔',
                title: 'Aqlli xabarnomalar',
                desc: 'Dars 15 daqiqa qolganda eslatma. Yangi material, baho — hammasi vaqtida.',
                accent: 'green' as const,
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
      <section className="relative overflow-hidden section">
        <div className="pointer-events-none absolute inset-0 bg-dotgrid opacity-30" />

        <div className="container-aurora relative">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <SectionLabel>Talaba sifatida boshlash</SectionLabel>
            <h2
              className="mt-4 text-balance font-extrabold tracking-tight text-ink-strong"
              style={{
                fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
                letterSpacing: '-0.04em',
              }}
            >
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
      <section className="bg-tint section">
        <div className="container-aurora">
          <FadeIn>
            <figure className="mx-auto max-w-5xl text-center">
              <svg
                className="mx-auto h-12 w-12 text-blue/50"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
              </svg>
              <blockquote
                className="mt-8 text-balance font-medium leading-snug text-ink-strong"
                style={{
                  fontSize: 'clamp(1.5rem, 2.5vw, 2.25rem)',
                  letterSpacing: '-0.02em',
                }}
              >
                &ldquo;AI tutor menga tayyor javob bermaydi, lekin shu o&apos;zi
                yoqimli — chunki o&apos;rganishga majbur qiladi. IELTS&apos;da
                7.5 oldim!&rdquo;
              </blockquote>
              <figcaption className="mt-10 flex items-center justify-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue text-lg font-bold text-white">
                  M
                </div>
                <div className="text-left">
                  <div className="font-semibold text-ink-strong">Madina K.</div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-soft">
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
      <section className="section pt-0">
        <div className="container-aurora">
          <FadeIn>
            <div
              className="relative isolate overflow-hidden rounded-3xl border border-blue/30 bg-gradient-to-b from-blue/[0.06] to-canvas p-10 shadow-large sm:p-16"
            >
              <div className="pointer-events-none absolute inset-0 bg-linegrid opacity-30" />
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(0, 113, 227, 0.18) 0%, transparent 70%)',
                  filter: 'blur(60px)',
                  mixBlendMode: 'multiply',
                }}
              />

              <div className="relative mx-auto max-w-3xl text-center">
                <h2
                  className="text-balance font-extrabold tracking-tight text-ink-strong"
                  style={{
                    fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
                    letterSpacing: '-0.04em',
                  }}
                >
                  Bepul ro&apos;yxatdan o&apos;ting
                </h2>
                <p className="mt-4 text-ink-soft">
                  Talaba sifatida ro&apos;yxatdan o&apos;tish bepul. Faqat kurs
                  uchun o&apos;qituvchiga to&apos;laysiz.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Button
                    asChild
                    size="lg"
                    rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
                  >
                    <Link href={`/${locale}/register?role=student`}>
                      Ro&apos;yxatdan o&apos;tish
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="secondary">
                    <Link href={`/${locale}/search`}>
                      Avval qidirib ko&apos;rish
                    </Link>
                  </Button>
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
    <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
      <span className="h-1.5 w-1.5 rounded-full bg-blue" />
      {children}
    </span>
  );
}

const BENEFIT_ACCENT: Record<
  'green' | 'blue' | 'purple' | 'orange',
  string
> = {
  green: 'bg-green-tint',
  blue: 'bg-blue-tint',
  purple: 'bg-purple-tint',
  orange: 'bg-orange-tint',
};

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
  return (
    <div className="group relative h-full overflow-hidden rounded-2xl border border-rim bg-canvas p-7 shadow-soft transition-all duration-500 hover:-translate-y-1 hover:border-rim-2 hover:shadow-medium">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-2xl text-3xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6 ${BENEFIT_ACCENT[accent]}`}
      >
        {emoji}
      </div>
      <h3
        className="mt-5 text-lg font-extrabold tracking-tight text-ink-strong"
        style={{ letterSpacing: '-0.02em' }}
      >
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
    <div className="group relative h-full overflow-hidden rounded-3xl border border-rim bg-canvas p-8 shadow-soft transition-all hover:border-blue/30 hover:shadow-medium">
      <div
        className="font-mono text-7xl font-bold text-blue/20 transition-colors group-hover:text-blue/40"
        style={{ letterSpacing: '-0.04em' }}
      >
        0{number}
      </div>
      <h3
        className="mt-2 text-2xl font-extrabold tracking-tight text-ink-strong"
        style={{ letterSpacing: '-0.02em' }}
      >
        {title}
      </h3>
      <p className="mt-3 text-ink-soft">{description}</p>
    </div>
  );
}
