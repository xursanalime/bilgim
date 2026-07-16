import Link from 'next/link';

import {
  ServerDiscoveryError,
  serverDiscovery,
} from '../../lib/server-discovery';
import type {
  DiscoveryCourseSummary,
  DiscoveryTeacherSummary,
} from '../../lib/api/discovery';
import { CourseCard, TeacherCard } from './discovery-cards';

interface FeaturedDiscoveryProps {
  locale: string;
}

const TOP_TEACHERS = 3;
const FEATURED_COURSES = 3;

/**
 * Featured discovery widget for the public homepage (Task 25.5).
 *
 * Server Component — pulls top teachers and featured courses from the
 * public `/discovery/*` endpoints (no auth) and renders two compact
 * grids side-by-side. Errors degrade silently: if the API is down, the
 * widget renders nothing rather than crashing the marketing page.
 *
 * The cards reuse the same `TeacherCard` / `CourseCard` from the
 * search/profile pages so visual styling stays consistent across the
 * discovery surface.
 */
export async function FeaturedDiscovery({ locale }: FeaturedDiscoveryProps) {
  let teachers: DiscoveryTeacherSummary[] = [];
  let courses: DiscoveryCourseSummary[] = [];

  // Fire the two requests in parallel — neither blocks the other and a
  // failure on one side still lets the other render.
  const [teacherResult, courseResult] = await Promise.allSettled([
    serverDiscovery.listTeachers({ pageSize: TOP_TEACHERS }),
    serverDiscovery.listCourses({ pageSize: FEATURED_COURSES }),
  ]);

  if (teacherResult.status === 'fulfilled') {
    teachers = teacherResult.value.items;
  } else if (
    !(teacherResult.reason instanceof ServerDiscoveryError) ||
    teacherResult.reason.statusCode >= 500
  ) {
    // Log only — never bubble: marketing must always render.
    console.warn(
      '[FeaturedDiscovery] listTeachers failed',
      teacherResult.reason,
    );
  }

  if (courseResult.status === 'fulfilled') {
    courses = courseResult.value.items;
  } else if (
    !(courseResult.reason instanceof ServerDiscoveryError) ||
    courseResult.reason.statusCode >= 500
  ) {
    console.warn(
      '[FeaturedDiscovery] listCourses failed',
      courseResult.reason,
    );
  }

  // Hide the whole section if we have nothing to show — keeps a fresh
  // platform without seeded teachers from looking broken on launch day.
  if (teachers.length === 0 && courses.length === 0) {
    return null;
  }

  return (
    <section className="relative overflow-hidden bg-ink py-24 sm:py-28">
      <div className="pointer-events-none absolute -right-32 top-10 h-[400px] w-[400px] rounded-full bg-accent2-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl space-y-20 px-4 sm:px-6 lg:px-8">
        {teachers.length > 0 && (
          <div>
            <FeaturedHeader
              eyebrow="Ustozlar"
              title="Faol ustozlarni kashf qiling"
              description="Mutaxassisliklar bo'yicha ko'rish va profil ochish."
              ctaHref={`/${locale}/teachers`}
              ctaLabel="Barcha ustozlar"
            />
            <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {teachers.map((teacher) => (
                <li key={teacher.id}>
                  <TeacherCard teacher={teacher} locale={locale} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {courses.length > 0 && (
          <div>
            <FeaturedHeader
              eyebrow="Kurslar"
              title="Yangi va mashhur kurslar"
              description="O'zingizga mos kursni toping va ustoz tasdig'idan keyin qo'shiling."
              ctaHref={`/${locale}/courses`}
              ctaLabel="Barcha kurslar"
            />
            <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <li key={course.id}>
                  <CourseCard course={course} locale={locale} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function FeaturedHeader({
  eyebrow,
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
      <div className="max-w-2xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
          <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
          {eyebrow}
        </span>
        <h2
          className="mt-4 text-balance font-extrabold tracking-tight text-cream"
          style={{
            fontSize: 'clamp(2rem, 3.5vw, 2.75rem)',
            letterSpacing: '-0.04em',
          }}
        >
          {title}
        </h2>
        <p className="mt-3 text-base text-cream-dim">{description}</p>
      </div>
      <Link
        href={ctaHref}
        className="group inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
      >
        {ctaLabel}
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
    </div>
  );
}
