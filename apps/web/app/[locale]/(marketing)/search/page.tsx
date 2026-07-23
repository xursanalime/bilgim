import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
  type DiscoveryTeacherSummary,
} from '../../../../lib/discovery-api';
import { SearchControls } from '../../../../components/marketing/search-controls';
import {
  CourseCard,
  EmptyState,
  ErrorBanner,
  TeacherCard,
} from '../../../../components/marketing/discovery-cards';

interface SearchPageProps {
  params: { locale: string };
  searchParams: {
    tab?: string;
    q?: string;
    level?: string;
    priceMin?: string;
    priceMax?: string;
    cursor?: string;
  };
}

const PAGE_SIZE = 20;

type SearchTab = 'teachers' | 'courses';

export function generateMetadata({
  params: { locale },
  searchParams,
}: SearchPageProps): Metadata {
  const tab = parseTab(searchParams.tab);
  const q = (searchParams.q ?? '').trim();
  const tabLabel = tab === 'courses' ? 'Kurslar' : 'Ustozlar';
  const baseTitle = `${tabLabel} bo'yicha qidiruv | Bilgim`;
  const title = q.length >= 2 ? `${q} — ${tabLabel} | Bilgim` : baseTitle;
  const description =
    tab === 'courses'
      ? "Bilgim platformasida ochiq ingliz tili kurslarini qidiring: daraja va narx bo'yicha filtrlash."
      : 'Bilgim platformasida ingliz tili ustozlarini qidiring va toping.';

  return {
    title,
    description,
    alternates: { canonical: `/${locale}/search` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/search`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public discovery search page (Task 25.5, Req 14.1–14.7).
 *
 * Server Component — reads filters from `searchParams` and queries the
 * public discovery endpoints. The tab switcher, search input, and
 * filter sidebar are a client island (`SearchControls`) that updates
 * the URL; the SSR pass re-runs from the new `searchParams` and streams
 * the new results in.
 */
export default async function SearchPage({
  params: { locale },
  searchParams,
}: SearchPageProps) {
  unstable_setRequestLocale(locale);

  const tab = parseTab(searchParams.tab);
  const q = (searchParams.q ?? '').trim();
  const apiQuery = q.length >= 2 ? q : undefined;
  const cursor = searchParams.cursor?.trim() || undefined;
  const level = searchParams.level?.trim() || undefined;
  const priceMin = parseNonNegativeInt(searchParams.priceMin);
  const priceMax = parseNonNegativeInt(searchParams.priceMax);

  const hasFilters = !!(q || level || priceMin || priceMax);

  // Capture all current params so we can build a back/cursor link that
  // preserves the user's filter state.
  const buildCursorHref = (next: string) => {
    const sp = new URLSearchParams();
    if (tab === 'courses') sp.set('tab', 'courses');
    if (q) sp.set('q', q);
    if (tab === 'courses') {
      if (level) sp.set('level', level);
      if (priceMin !== undefined) sp.set('priceMin', String(priceMin));
      if (priceMax !== undefined) sp.set('priceMax', String(priceMax));
    }
    sp.set('cursor', next);
    return `/${locale}/search?${sp.toString()}`;
  };

  const retryHref =
    tab === 'teachers'
      ? `/${locale}/search`
      : `/${locale}/search?tab=courses`;

  let teachers: DiscoveryTeacherSummary[] = [];
  let courses: DiscoveryCourseSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    if (tab === 'teachers') {
      const page = await serverDiscovery.listTeachers({
        ...(apiQuery && { q: apiQuery }),
        ...(cursor && { cursor }),
        pageSize: PAGE_SIZE,
      });
      teachers = page.items;
      nextCursor = page.nextCursor;
    } else {
      const page = await serverDiscovery.listCourses({
        ...(apiQuery && { q: apiQuery }),
        ...(level && { level }),
        ...(priceMin !== undefined && { priceMin }),
        ...(priceMax !== undefined && { priceMax }),
        ...(cursor && { cursor }),
        pageSize: PAGE_SIZE,
      });
      courses = page.items;
      nextCursor = page.nextCursor;
    }
  } catch (err) {
    if (err instanceof ServerDiscoveryError && err.statusCode < 500) {
      loadError = err.message;
    } else {
      loadError =
        "Natijalarni yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
    }
  }

  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[400px] w-[400px] rounded-full bg-blue/5 blur-[100px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Qidiruv
          </span>
          <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
            {tab === 'courses' ? 'Kurslar' : 'Ustozlar'}ni toping
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
            Bilgim platformasidagi ochiq{' '}
            {tab === 'courses' ? 'ingliz tili kurslari' : 'ingliz tili ustozlari'}{' '}
            ro&apos;yxati.
            {tab === 'courses'
              ? ' Daraja yoki narx bo\u2019yicha filtrlang.'
              : ' Ism bo\u2019yicha qidiring.'}
          </p>
        </header>

        <div className="mt-10">
          <SearchControls
            locale={locale}
            tab={tab}
            initialQuery={q}
            initialFilters={{
              ...(level && { level }),
              ...(priceMin !== undefined && { priceMin: String(priceMin) }),
              ...(priceMax !== undefined && { priceMax: String(priceMax) }),
            }}
          />
        </div>

        <div className="mt-10">
          {loadError ? (
            <ErrorBanner message={loadError} retryHref={retryHref} />
          ) : tab === 'teachers' ? (
            teachers.length === 0 ? (
              <EmptyState resetHref={retryHref} hasFilters={hasFilters} />
            ) : (
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {teachers.map((teacher) => (
                  <li key={teacher.id}>
                    <TeacherCard teacher={teacher} locale={locale} />
                  </li>
                ))}
              </ul>
            )
          ) : courses.length === 0 ? (
            <EmptyState resetHref={retryHref} hasFilters={hasFilters} />
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <li key={course.id}>
                  <CourseCard course={course} locale={locale} />
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
              Ko&apos;proq ko&apos;rish
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function parseTab(value: string | undefined): SearchTab {
  return value === 'courses' ? 'courses' : 'teachers';
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}
