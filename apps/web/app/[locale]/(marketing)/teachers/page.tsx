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
  const title = "Ochiq ustozlar ro'yxati | EduBridge";
  const description =
    "EduBridge platformasidagi barcha ochiq ustozlar. Profilini ko'ring, kurslariga yoziling.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/teachers` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/teachers`,
      siteName: 'EduBridge',
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
 * (canvas/rim/ink, blue accent) rather than the marketing site's dark
 * theme, per explicit design direction to keep this listing consistent
 * with the rest of the product.
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
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[400px] w-[400px] rounded-full bg-blue/5 blur-[100px]" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-[300px] w-[300px] rounded-full bg-purple/5 blur-[100px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Ustozlar
          </span>
          <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
            EduBridge ustozlari
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
            Platformadagi barcha ochiq ustozlar. Profil ochib, ularning
            ochiq kurslariga koʻz tashlang.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 font-semibold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
            >
              <Search className="h-4 w-4" />
              Qidirish
            </Link>
            <Link
              href={`/${locale}/courses`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 font-semibold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
            >
              <BookOpen className="h-4 w-4" />
              Kurslar
            </Link>
          </div>
        </header>

        <div className="mt-10">
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
            <div className="rounded-3xl border border-rim bg-canvas p-12 text-center shadow-soft">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-tint text-blue">
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
              {teachers.map((teacher) => (
                <li key={teacher.id}>
                  <LightTeacherCard teacher={teacher} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {nextCursor && !loadError && (
          <div className="mt-10 text-center">
            <Link
              href={buildCursorHref(nextCursor)}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-6 py-3 text-sm font-bold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
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

function LightTeacherCard({
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

  const card = (
    <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:border-blue/20 hover:shadow-medium">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blue-tint text-blue">
          {teacher.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.avatarUrl}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-base font-extrabold tracking-tight">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
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
        <div className="mt-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-blue">
            {teacher.specialty.nameUz}
          </span>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-rim pt-4 text-center">
        <Stat icon={Star} label="Reyting" value={formatRating(teacher.rating)} />
        <Stat icon={Users} label="Talabalar" value={String(teacher.studentsCount)} />
        <Stat icon={Layers} label="Kurslar" value={String(teacher.courseCount)} />
      </dl>

      <div className="mt-6">
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
    <Link href={profileHref} className="block focus:outline-none">
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
