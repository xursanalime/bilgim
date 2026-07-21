import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowRight, Search, Users } from 'lucide-react';

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
 *
 * Styled with the platform's light Apple-style tokens, matching
 * `/teachers` and the rest of the discovery surface.
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
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[400px] w-[400px] rounded-full bg-blue/5 blur-[100px]" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-[300px] w-[300px] rounded-full bg-purple/5 blur-[100px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Kurslar
          </span>
          <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
            EduBridge kurslari
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
            Platformadagi barcha ochiq kurslar. Sizga mos kursni toping va
            ustoz tasdig&apos;idan keyin qo&apos;shiling.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search?tab=courses`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 font-semibold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
            >
              <Search className="h-4 w-4" />
              Filtrlash
            </Link>
            <Link
              href={`/${locale}/teachers`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 font-semibold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
            >
              <Users className="h-4 w-4" />
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
