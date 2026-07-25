import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Layers,
  Search,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryTeacherSummary,
} from '../../../../lib/discovery-api';

interface TeachersPageProps {
  params: { locale: string };
  searchParams: { cursor?: string };
}

const PAGE_SIZE = 20;

export function generateMetadata({
  params: { locale },
}: TeachersPageProps): Metadata {
  const title = "Ochiq ustozlar ro'yxati | Bilgim";
  const description =
    "Bilgim platformasidagi barcha ochiq ustozlar. Profilini ko'ring, kurslariga yoziling.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/teachers` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/teachers`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public teacher catalog (Task 25.5, Req 14.1, 14.4).
 *
 * Server Component — paginates the `/discovery/teachers` endpoint with
 * a cursor. Filtering lives on `/search`; this page is the simple
 * "browse all" entry point.
 *
 * Styled with the platform's own light Apple-style design tokens
 * (canvas/rim/ink, blue accent, liquid-glass, hero gradient) — the same
 * language as the homepage hero — rather than an invented theme.
 */
export default async function TeachersListPage({
  params: { locale },
  searchParams,
}: TeachersPageProps) {
  unstable_setRequestLocale(locale);

  const cursor = searchParams.cursor?.trim() || undefined;

  let teachers: DiscoveryTeacherSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    const page = await serverDiscovery.listTeachers({
      ...(cursor && { cursor }),
      pageSize: PAGE_SIZE,
    });
    teachers = page.items;
    nextCursor = page.nextCursor;
  } catch (err) {
    if (err instanceof ServerDiscoveryError && err.statusCode < 500) {
      loadError = err.message;
    } else {
      loadError =
        "Ustozlar ro'yxatini yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
    }
  }

  const buildCursorHref = (next: string) =>
    `/${locale}/teachers?cursor=${encodeURIComponent(next)}`;

  return (
    <section className="relative isolate overflow-hidden py-16 sm:py-20 lg:py-24">
      {/* Ambient backdrop — dot grid + soft aurora orbs, fading into the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dotgrid opacity-40"
        style={{
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 60%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black 0%, transparent 60%)',
        }}
      />
      <div className="pointer-events-none absolute -right-32 -top-48 h-[480px] w-[480px] rounded-full bg-blue/10 blur-[120px]" />
      <div className="pointer-events-none absolute -left-40 top-1/4 h-[380px] w-[380px] rounded-full bg-purple/10 blur-[120px]" />

      <div className="relative container-aurora">
        <header className="max-w-3xl">
          <span className="liquid-glass inline-flex items-center gap-2.5 rounded-full py-1.5 pl-2 pr-4">
            <span className="flex items-center gap-1.5 rounded-full bg-blue px-2.5 py-0.5 text-white">
              <Sparkles className="h-3 w-3" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                Ustozlar
              </span>
            </span>
            <span className="text-xs font-medium text-ink-strong">
              Platformadagi barcha ochiq profillar
            </span>
          </span>

          <h1
            className="mt-6 font-display font-extrabold leading-[1.05] text-ink-strong"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.25rem)', letterSpacing: '-0.035em' }}
          >
            Bilgim <span className="text-hero-gradient italic">ustozlari</span>
          </h1>
          <p className="mt-4 max-w-xl text-balance text-base leading-relaxed text-ink-soft sm:text-lg">
            Platformadagi barcha ochiq ustozlar. Profil ochib, ularning
            ochiq kurslariga koʻz tashlang.
          </p>

          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search`}
              className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-semibold text-ink-soft transition-all hover:text-blue"
            >
              <Search className="h-4 w-4" />
              Qidirish
            </Link>
            <Link
              href={`/${locale}/courses`}
              className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-semibold text-ink-soft transition-all hover:text-blue"
            >
              <BookOpen className="h-4 w-4" />
              Kurslar
            </Link>
          </div>
        </header>

        <div className="mt-12">
          {loadError ? (
            <div className="flex flex-col gap-4 rounded-3xl border border-red/15 bg-red-tint p-6 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 font-bold text-red">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                {loadError}
              </div>
              <Link
                href={`/${locale}/teachers`}
                className="inline-flex shrink-0 items-center justify-center rounded-xl border border-red/20 bg-canvas px-4 py-2 text-xs font-bold text-red transition-colors hover:bg-red/5"
              >
                Qayta urinib koʻrish
              </Link>
            </div>
          ) : teachers.length === 0 ? (
            <div className="liquid-glass rounded-3xl p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-hero-gradient text-white shadow-blue-soft">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold text-ink-strong">
                Hech narsa topilmadi
              </h3>
              <p className="mt-2 text-sm text-ink-soft">
                Hozircha ochiq profilga ega ustozlar mavjud emas.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {teachers.map((teacher, index) => (
                <li
                  key={teacher.id}
                  className="animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-500"
                  style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
                >
                  <TeacherCard teacher={teacher} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {nextCursor && !loadError && (
          <div className="mt-10 text-center">
            <Link
              href={buildCursorHref(nextCursor)}
              className="liquid-glass inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-ink-soft transition-all hover:text-blue"
            >
              Keyingi sahifa
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

const SPECIALTY_ACCENTS = [
  { text: 'text-blue', border: 'border-blue/15', bg: 'bg-blue-tint' },
  { text: 'text-purple', border: 'border-purple/15', bg: 'bg-purple-tint' },
  { text: 'text-teal', border: 'border-teal/15', bg: 'bg-teal-tint' },
  { text: 'text-orange', border: 'border-orange/15', bg: 'bg-orange-tint' },
] as const;

function accentForSpecialty(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SPECIALTY_ACCENTS[hash % SPECIALTY_ACCENTS.length]!;
}

function TeacherCard({
  teacher,
  locale,
}: {
  teacher: DiscoveryTeacherSummary;
  locale: string;
}) {
  const fullName = teacher.fullName ?? 'Ustoz';
  const slug = teacher.slug;
  const profileHref = slug ? `/${locale}/teachers/${slug}` : null;
  const initials = getInitials(fullName);
  const accent = teacher.specialty
    ? accentForSpecialty(teacher.specialty.nameUz)
    : SPECIALTY_ACCENTS[0]!;

  const card = (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-blue/20 hover:shadow-large">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-blue/5 blur-2xl transition-colors duration-300 group-hover:bg-blue/10" />

      <div className="relative flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-blue-soft ring-4 ring-white">
          {teacher.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.avatarUrl}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-lg font-extrabold tracking-tight">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <h3 className="truncate text-base font-extrabold tracking-tight text-ink-strong">
            {fullName}
          </h3>
          {teacher.headline && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
              {teacher.headline}
            </p>
          )}
        </div>
      </div>

      {teacher.specialty && (
        <div className="relative mt-5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${accent.border} ${accent.bg} ${accent.text}`}
          >
            {teacher.specialty.nameUz}
          </span>
        </div>
      )}

      <dl className="relative mt-5 grid grid-cols-3 gap-3 border-t border-rim pt-4 text-center">
        <Stat icon={Star} label="Reyting" value={formatRating(teacher.rating)} />
        <Stat icon={Users} label="Talabalar" value={String(teacher.studentsCount)} />
        <Stat icon={Layers} label="Kurslar" value={String(teacher.courseCount)} />
      </dl>

      <div className="relative mt-6">
        {profileHref ? (
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-tint px-4 py-2.5 text-sm font-bold text-blue transition-colors group-hover:bg-blue group-hover:text-white">
            Profilga kirish
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        ) : (
          <span className="inline-flex w-full items-center justify-center rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-faint">
            Profil tez orada
          </span>
        )}
      </div>
    </article>
  );

  if (!profileHref) return card;
  return (
    <Link href={profileHref} className="block h-full focus:outline-none">
      {card}
    </Link>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Star;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-sm font-extrabold tracking-tight text-ink-strong">
        <Icon className="h-3.5 w-3.5 text-ink-faint" />
        {value}
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </div>
    </div>
  );
}

function formatRating(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(1);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return (parts[0]!.charAt(0) || 'U').toUpperCase();
  return (
    (parts[0]!.charAt(0) || '') + (parts[parts.length - 1]!.charAt(0) || '')
  ).toUpperCase();
}
