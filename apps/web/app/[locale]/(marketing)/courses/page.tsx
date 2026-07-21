import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
} from '../../../../lib/discovery-api';
import {
  CourseCard,
  EmptyState,
  ErrorBanner,
} from '../../../../components/marketing/discovery-cards';

interface CoursesPageProps {
  params: { locale: string };
  searchParams: { cursor?: string };
}

const PAGE_SIZE = 20;

export function generateMetadata({
  params: { locale },
}: CoursesPageProps): Metadata {
  const title = 'Ochiq kurslar | EduBridge';
  const description =
    "EduBridge platformasidagi barcha ochiq kurslar. O'zingizga mos kursni toping va ustoz tasdig'idan keyin qo'shiling.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/courses` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/courses`,
      siteName: 'EduBridge',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public course catalog (Task 25.5, Req 14.1, 14.2).
 *
 * Server Component — paginates `/discovery/courses`. Filtering by
 * specialty/level/price lives on `/search?tab=courses`; this page is
 * the "browse all" entry point.
 */
export default async function CoursesListPage({
  params: { locale },
  searchParams,
}: CoursesPageProps) {
  unstable_setRequestLocale(locale);

  const cursor = searchParams.cursor?.trim() || undefined;

  let courses: DiscoveryCourseSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    const page = await serverDiscovery.listCourses({
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

  const buildCursorHref = (next: string) =>
    `/${locale}/courses?cursor=${encodeURIComponent(next)}`;

  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="pointer-events-none absolute -right-40 top-10 h-[400px] w-[400px] rounded-full bg-accent2-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Kurslar
          </span>
          <h1
            className="mt-4 text-balance font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
              letterSpacing: '-0.04em',
            }}
          >
            EduBridge kurslari
          </h1>
          <p className="mt-3 max-w-xl text-base text-cream-dim sm:text-lg">
            Platformadagi barcha ochiq kurslar. Sizga mos kursni toping va
            ustoz tasdig&apos;idan keyin qo&apos;shiling.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search?tab=courses`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Filtrlash
            </Link>
            <Link
              href={`/${locale}/teachers`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              Ustozlar
            </Link>
          </div>
        </header>

        <div className="mt-10">
          {loadError ? (
            <ErrorBanner
              message={loadError}
              retryHref={`/${locale}/courses`}
            />
          ) : courses.length === 0 ? (
            <EmptyState
              resetHref={`/${locale}/courses`}
              hasFilters={false}
              message="Hozircha ochiq kurslar mavjud emas."
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
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-cream transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
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
