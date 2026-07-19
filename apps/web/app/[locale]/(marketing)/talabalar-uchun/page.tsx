import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
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
          HERO — dark, centered with search bar
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-ink">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
        <div className="pointer-events-none absolute -left-40 top-20 h-[500px] w-[500px] rounded-full bg-accent2-500/15 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-1/3 h-[500px] w-[500px] rounded-full bg-accent2-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-20 lg:px-8 lg:pt-28">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
              <span className="text-base leading-none">🎓</span>
              Talabalar uchun
            </span>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1
              className="mt-7 text-balance font-extrabold leading-[0.95] text-cream"
              style={{
                fontSize: 'clamp(2.75rem, 6vw, 5rem)',
                letterSpacing: '-0.04em',
                fontWeight: 900,
              }}
            >
              O&apos;qimoq endi{' '}
              <span className="relative inline-block">
                <span className="relative z-10 text-accent2-500">
                  qiziqarli
                </span>
                <svg
                  className="absolute -bottom-2 left-0 z-0 h-3 w-full text-accent2-500/50"
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
            <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-cream-dim sm:text-lg">
              Sevimli o&apos;qituvchingizni toping, jonli darslarda ishtirok
              eting va AI tutor bilan istalgan vaqtda mashq qiling.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={`/${locale}/search`}
                className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-accent2-500 px-7 py-3.5 text-sm font-bold text-ink shadow-[0_0_0_1px_rgba(0,232,122,0.4),0_8px_32px_-8px_rgba(0,232,122,0.7)] transition-all hover:bg-accent2-400 hover:shadow-[0_0_0_1px_rgba(0,232,122,0.6),0_12px_40px_-8px_rgba(0,232,122,0.9)] active:scale-[0.98]"
              >
                O&apos;qituvchini topish
                <svg
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
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
              <Link
                href={`/${locale}/register?role=student`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-cream backdrop-blur-sm transition-all hover:border-white/[0.2] hover:bg-white/[0.07]"
              >
                Ro&apos;yxatdan o&apos;tish
              </Link>
            </div>
            <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim/70">
              ✓ Bepul ro&apos;yxatdan o&apos;tish · ✓ Barcha daraja uchun ingliz tili
            </p>
          </FadeIn>

          {/* Search bar */}
          <FadeIn delay={0.5}>
            <div className="mx-auto mt-12 max-w-2xl">
              <div className="rounded-2xl border border-white/[0.07] bg-ink-surface p-2 shadow-2xl">
                <div className="flex items-center gap-2">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-accent2-500/10 text-accent2-500">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Masalan: 'IELTS o'qituvchisi' yoki 'Speaking darslari'"
                    className="flex-1 bg-transparent px-2 py-2 text-sm text-cream placeholder-cream-dim/60 outline-none"
                  />
                  <Link
                    href={`/${locale}/search`}
                    className="hidden rounded-xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink transition-all hover:bg-accent2-400 sm:inline-flex"
                  >
                    Qidirish
                  </Link>
                </div>
              </div>

              {/* Popular tags */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim/70">
                  Mashhur:
                </span>
                {['IELTS', 'Speaking', 'Grammar', 'Business English', 'TOEFL'].map(
                  (tag) => (
                    <Link
                      key={tag}
                      href={`/${locale}/search?q=${encodeURIComponent(tag)}`}
                      className="rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1 text-xs font-semibold text-cream-dim transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
                    >
                      {tag}
                    </Link>
                  ),
                )}
              </div>
            </div>
          </FadeIn>

          {/* Stats */}
          <Stagger className="mt-20 grid grid-cols-2 gap-x-8 gap-y-10 border-t border-white/[0.07] pt-12 md:grid-cols-4">
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-cream"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                <AnimatedCounter to={5} suffix="K+" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
                Tasdiqlangan o&apos;qituvchilar
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-cream"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                <AnimatedCounter to={100} suffix="+" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
                Ingliz tili kurslari
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-cream"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                <AnimatedCounter to={50} suffix="K+" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
                Tugallangan kurslar
              </p>
            </StaggerItem>
            <StaggerItem className="text-center">
              <div
                className="font-extrabold text-cream"
                style={{
                  fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                4.8<span className="text-accent2-500">★</span>
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
                O&apos;rtacha baho
              </p>
            </StaggerItem>
          </Stagger>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          BENEFITS — bento with emoji icons
          ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-ink py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <SectionLabel>Nima uchun talabalar yoqtiradi</SectionLabel>
            <h2
              className="mt-4 text-balance font-extrabold tracking-tight text-cream"
              style={{
                fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
                letterSpacing: '-0.04em',
              }}
            >
              O&apos;qish uchun yaratilgan
            </h2>
            <p className="mt-4 text-base text-cream-dim sm:text-lg">
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
      <section className="relative overflow-hidden bg-ink py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 bg-glow-green opacity-60" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <SectionLabel>Talaba sifatida boshlash</SectionLabel>
            <h2
              className="mt-4 text-balance font-extrabold tracking-tight text-cream"
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
      <section className="bg-ink py-24 sm:py-32">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <figure className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-accent2-500/60"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
              </svg>
              <blockquote
                className="mt-8 text-balance font-medium leading-snug text-cream"
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
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent2-500 text-lg font-bold text-ink">
                  M
                </div>
                <div className="text-left">
                  <div className="font-semibold text-cream">Madina K.</div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
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
      <section className="bg-ink pb-24 sm:pb-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="relative overflow-hidden rounded-3xl border border-accent2-500/30 bg-gradient-to-br from-ink-surface to-ink p-10 shadow-[0_0_60px_-12px_rgba(0,232,122,0.4)] sm:p-16">
              <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
              <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-accent2-500/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-accent2-500/15 blur-3xl" />

              <div className="relative mx-auto max-w-3xl text-center">
                <h2
                  className="text-balance font-extrabold tracking-tight text-cream"
                  style={{
                    fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
                    letterSpacing: '-0.04em',
                  }}
                >
                  Bepul ro&apos;yxatdan o&apos;ting
                </h2>
                <p className="mt-4 text-cream-dim">
                  Talaba sifatida ro&apos;yxatdan o&apos;tish bepul. Faqat kurs
                  uchun o&apos;qituvchiga to&apos;laysiz.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link
                    href={`/${locale}/register?role=student`}
                    className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-accent2-500 px-7 py-3.5 text-sm font-bold text-ink shadow-[0_0_0_1px_rgba(0,232,122,0.4),0_8px_32px_-8px_rgba(0,232,122,0.7)] transition-all hover:bg-accent2-400 active:scale-[0.98]"
                  >
                    Ro&apos;yxatdan o&apos;tish
                    <svg
                      className="h-4 w-4 transition-transform group-hover:translate-x-1"
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
                  <Link
                    href={`/${locale}/search`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-cream backdrop-blur-sm transition-all hover:border-white/[0.2] hover:bg-white/[0.07]"
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
    <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
      <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
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
  const accentRing = {
    green: 'group-hover:shadow-[0_0_24px_rgba(0,232,122,0.3)]',
    blue: 'group-hover:shadow-[0_0_24px_rgba(59,130,246,0.3)]',
    purple: 'group-hover:shadow-[0_0_24px_rgba(168,85,247,0.3)]',
    orange: 'group-hover:shadow-[0_0_24px_rgba(249,115,22,0.3)]',
  }[accent];

  return (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-surface p-7 transition-all duration-500 hover:-translate-y-1 hover:border-white/[0.15] ${accentRing}`}
    >
      <div className="text-4xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6">
        {emoji}
      </div>
      <h3
        className="mt-5 text-lg font-extrabold tracking-tight text-cream"
        style={{ letterSpacing: '-0.02em' }}
      >
        {title}
      </h3>
      <p className="mt-2 text-sm text-cream-dim">{desc}</p>
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
    <div className="group relative h-full overflow-hidden rounded-3xl border border-white/[0.07] bg-ink-surface p-8 transition-all hover:border-accent2-500/30 hover:shadow-[0_0_0_1px_rgba(0,232,122,0.2)]">
      <div
        className="font-mono text-7xl font-bold text-accent2-500/30 transition-colors group-hover:text-accent2-500/60"
        style={{ letterSpacing: '-0.04em' }}
      >
        0{number}
      </div>
      <h3
        className="mt-2 text-2xl font-extrabold tracking-tight text-cream"
        style={{ letterSpacing: '-0.02em' }}
      >
        {title}
      </h3>
      <p className="mt-3 text-cream-dim">{description}</p>
    </div>
  );
}
