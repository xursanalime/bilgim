import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
  type DiscoveryTeacherSummary,
} from '../../../../lib/discovery-api';
import { SearchControls } from '../../../../components/marketing/search-controls';
import { CourseCard, TeacherCard } from '../../../../components/marketing/discovery-cards';
import {
  DiscoveryEmptyState,
  DiscoveryErrorState,
} from '../../../../components/discovery/discovery-states';
import {
  parseCefrParam,
  parseExamTrackParam,
} from '../../../../components/discovery/facets';

interface SearchPageProps {
  params: { locale: string };
  searchParams: {
    tab?: string;
    q?: string;
    cefrLevel?: string | string[];
    examTrack?: string;
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
      ? "Bilgim platformasida ochiq ingliz tili kurslarini qidiring: CEFR daraja va imtihon yo'nalishi bo'yicha filtrlash."
      : "Bilgim platformasida ingliz tili ustozlarini CEFR daraja va imtihon yo'nalishi bo'yicha toping.";

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
 * Public discovery search page (Req 15.2).
 *
 * Server Component — reads filters from `searchParams` and queries the
 * public discovery endpoints filtered by CEFR level + Exam_Track. The
 * tab switcher, search input, and filter sidebar are a client island
 * (`SearchControls`) that updates the URL; the SSR pass re-runs from the
 * new `searchParams` and streams the new results in.
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
  const cefrLevels = parseCefrParam(searchParams.cefrLevel);
  const examTrack = parseExamTrackParam(searchParams.examTrack);
  const priceMin = parseNonNegativeInt(searchParams.priceMin);
  const priceMax = parseNonNegativeInt(searchParams.priceMax);

  const hasFilters = !!(
    q ||
    cefrLevels.length > 0 ||
    examTrack ||
    priceMin ||
    priceMax
  );

  // Capture all current params so the cursor link preserves filter state.
  const buildCursorHref = (next: string) => {
    const sp = new URLSearchParams();
    if (tab === 'courses') sp.set('tab', 'courses');
    if (q) sp.set('q', q);
    for (const level of cefrLevels) sp.append('cefrLevel', level);
    if (examTrack) sp.set('examTrack', examTrack);
    if (tab === 'courses') {
      if (priceMin !== undefined) sp.set('priceMin', String(priceMin));
      if (priceMax !== undefined) sp.set('priceMax', String(priceMax));
    }
    sp.set('cursor', next);
    return `/${locale}/search?${sp.toString()}`;
  };

  const retryHref =
    tab === 'teachers' ? `/${locale}/search` : `/${locale}/search?tab=courses`;

  let teachers: DiscoveryTeacherSummary[] = [];
  let courses: DiscoveryCourseSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    if (tab === 'teachers') {
      const page = await serverDiscovery.listTeachers({
        ...(apiQuery && { q: apiQuery }),
        ...(cefrLevels.length > 0 && { cefrLevel: cefrLevels }),
        ...(examTrack && { examTrack }),
        ...(cursor && { cursor }),
        pageSize: PAGE_SIZE,
      });
      teachers = page.items;
      nextCursor = page.nextCursor;
    } else {
      const page = await serverDiscovery.listCourses({
        ...(apiQuery && { q: apiQuery }),
        ...(cefrLevels.length > 0 && { cefrLevel: cefrLevels }),
        ...(examTrack && { examTrack }),
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
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Qidiruv
          </span>
          <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
            {tab === 'courses' ? 'Kurslar' : 'Ustozlar'}ni toping
          </h1>
          <p className="mt-3 max-w-xl text-base text-ink-soft sm:text-lg">
            Bilgim platformasidagi ochiq{' '}
            {tab === 'courses' ? 'ingliz tili kurslari' : 'ingliz tili ustozlari'}.{' '}
            CEFR daraja yoki imtihon yo&apos;nalishi (masalan IELTS) bo&apos;yicha filtrlang.
          </p>
        </header>

        <div className="mt-10">
          <SearchControls
            locale={locale}
            tab={tab}
            initialQuery={q}
            initialCefr={cefrLevels}
            {...(examTrack && { initialExamTrack: examTrack })}
            initialFilters={{
              ...(priceMin !== undefined && { priceMin: String(priceMin) }),
              ...(priceMax !== undefined && { priceMax: String(priceMax) }),
            }}
          />
        </div>

        <div className="mt-10">
          {loadError ? (
            <DiscoveryErrorState message={loadError} retryHref={retryHref} />
          ) : tab === 'teachers' ? (
            teachers.length === 0 ? (
              <DiscoveryEmptyState
                description={
                  hasFilters
                    ? "Filtrlarni o'zgartirib qayta urinib ko'ring."
                    : 'Hozircha ochiq natijalar mavjud emas.'
                }
                {...(hasFilters && { resetHref: retryHref })}
              />
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
            <DiscoveryEmptyState
              description={
                hasFilters
                  ? "Filtrlarni o'zgartirib qayta urinib ko'ring."
                  : 'Hozircha ochiq kurslar mavjud emas.'
              }
              {...(hasFilters && { resetHref: retryHref })}
            />
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
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-6 py-3 text-sm font-semibold text-ink-strong shadow-sm transition-colors hover:border-blue/30 hover:bg-blue-tint hover:text-blue"
            >
              Ko&apos;proq ko&apos;rish
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
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
