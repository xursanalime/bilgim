import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
} from '../../../../lib/server-discovery';
import type { DiscoveryCourseSummary } from '../../../../lib/api/discovery';
import { CourseCard } from '../../../../components/marketing/discovery-cards';
import {
  DiscoveryEmptyState,
  DiscoveryErrorState,
} from '../../../../components/discovery/discovery-states';
import { parseExamTrackParam } from '../../../../components/discovery/facets';

interface CoursesPageProps {
  params: { locale: string };
  searchParams: { cursor?: string; examTrack?: string };
}

const PAGE_SIZE = 20;

export function generateMetadata({
  params: { locale },
}: CoursesPageProps): Metadata {
  const title = 'Ochiq kurslar | Bilgim';
  const description =
    "Bilgim platformasidagi barcha ochiq ingliz tili kurslari. CEFR daraja va imtihon yo'nalishi bo'yicha o'zingizga mos kursni toping.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/courses` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/courses`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public course catalog (Req 15.2).
 *
 * Server Component — paginates `/discovery/courses`. Rich filtering by
 * CEFR level / Exam_Track / price lives on `/search?tab=courses`; this
 * page is the "browse all" entry point with an optional Exam_Track
 * shortcut from the URL.
 */
export default async function CoursesListPage({
  params: { locale },
  searchParams,
}: CoursesPageProps) {
  unstable_setRequestLocale(locale);

  const cursor = searchParams.cursor?.trim() || undefined;
  const examTrack = parseExamTrackParam(searchParams.examTrack);

  let courses: DiscoveryCourseSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    const page = await serverDiscovery.listCourses({
      ...(examTrack && { examTrack }),
      ...(cursor && { cursor }),
      pageSize: PAGE_SIZE,
    });
    courses = page.items;
    nextCursor = page.nextCursor;
  } catch (err) {
    if (err instanceof ServerDiscoveryError && err.statusCode < 500) {
      loadError = err.message;
    } else {
      loadError =
        "Kurslar ro'yxatini yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
    }
  }

  const buildCursorHref = (next: string) => {
    const sp = new URLSearchParams();
    if (examTrack) sp.set('examTrack', examTrack);
    sp.set('cursor', next);
    return `/${locale}/courses?${sp.toString()}`;
  };

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Kurslar
          </span>
          <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
            Bilgim kurslari
          </h1>
          <p className="mt-3 max-w-xl text-base text-ink-soft sm:text-lg">
            Platformadagi barcha ochiq ingliz tili kurslari. Sizga mos kursni
            toping va ustoz tasdig&apos;idan keyin qo&apos;shiling.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search?tab=courses`}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              CEFR / Exam Track bo&apos;yicha filtrlash
            </Link>
            <Link
              href={`/${locale}/teachers`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2 font-semibold text-ink-strong transition-colors hover:border-blue/30 hover:bg-blue-tint hover:text-blue"
            >
              Ustozlar
            </Link>
          </div>
        </header>

        <div className="mt-10">
          {loadError ? (
            <DiscoveryErrorState
              message={loadError}
              retryHref={`/${locale}/courses`}
            />
          ) : courses.length === 0 ? (
            <DiscoveryEmptyState description="Hozircha ochiq kurslar mavjud emas." />
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
              Keyingi sahifa
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
