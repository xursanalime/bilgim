import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
  type DiscoveryTeacherSummary,
} from '../../../../../lib/discovery-api';
import { TeacherDmButton } from '../../../../../components/marketing/teacher-dm-button';
import {
  CourseCard,
  formatRating,
  getInitials,
} from '../../../../../components/marketing/discovery-cards';

interface TeacherProfilePageProps {
  params: { locale: string; publicSlug: string };
}

const TEACHER_LOOKUP_PAGE_SIZE = 50;
const COURSE_LOOKUP_PAGE_SIZE = 50;
/** How many list pages we are willing to scan when looking up a teacher
 * by `publicSlug`. The API does not yet expose `/teachers/:slug`, so we
 * page through the discovery list with a hard cap to keep response time
 * bounded. */
const MAX_LOOKUP_PAGES = 6;

export async function generateMetadata({
  params: { locale, publicSlug },
}: TeacherProfilePageProps): Promise<Metadata> {
  const teacher = await findTeacherBySlug(publicSlug);
  if (!teacher) {
    return {
      title: 'Ustoz topilmadi | EduBridge',
      description:
        "Bu ustoz mavjud emas yoki ochiq profili yo'q. Boshqa ustozlarni qidiring.",
    };
  }
  const fullName = teacher.fullName ?? 'Ustoz';
  const headline =
    teacher.headline ??
    `${teacher.specialty?.nameUz ?? 'EduBridge'} mutaxassisi.`;
  const title = `${fullName} | EduBridge`;
  const description = headline;
  const url = `/${locale}/teachers/${publicSlug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      siteName: 'EduBridge',
      ...(teacher.avatarUrl && {
        images: [{ url: teacher.avatarUrl, alt: fullName }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(teacher.avatarUrl && { images: [teacher.avatarUrl] }),
    },
  };
}

/**
 * Public teacher profile (Task 25.5, Req 14.3).
 *
 * Server Component — looks the teacher up by `publicSlug`, fetches their
 * published+discoverable courses, and renders avatar, headline, bio,
 * specialty, rating (padded to 3 decimals), studentsCount, and a list
 * of their courses.
 *
 * The DM button is a client island (auth required, surfaces rate-limit).
 */
export default async function TeacherProfilePage({
  params: { locale, publicSlug },
}: TeacherProfilePageProps) {
  unstable_setRequestLocale(locale);

  const teacher = await findTeacherBySlug(publicSlug);
  if (!teacher) {
    notFound();
  }

  const courses = await fetchTeacherCourses(publicSlug);
  const fullName = teacher.fullName ?? 'Ustoz';

  return (
    <section className="relative overflow-hidden bg-ink">
      {/* Cover */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
        <div className="pointer-events-none absolute -right-32 top-0 h-[400px] w-[400px] rounded-full bg-accent2-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 bottom-0 h-[300px] w-[300px] rounded-full bg-accent2-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
          <Link
            href={`/${locale}/teachers`}
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim transition-colors hover:text-cream"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            Ustozlar
          </Link>

          <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-accent2-500/10 ring-1 ring-inset ring-accent2-500/30">
              {teacher.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={teacher.avatarUrl}
                  alt={fullName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl font-extrabold tracking-tight text-accent2-500">
                  {getInitials(fullName)}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1
                className="text-balance font-extrabold tracking-tight text-cream"
                style={{
                  fontSize: 'clamp(2rem, 4vw, 3rem)',
                  letterSpacing: '-0.04em',
                }}
              >
                {fullName}
              </h1>
              {teacher.headline && (
                <p className="mt-3 max-w-2xl text-base text-cream-dim sm:text-lg">
                  {teacher.headline}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                {teacher.specialty && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent2-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
                    {teacher.specialty.nameUz}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  Reyting {formatRating(teacher.rating)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  {teacher.studentsCount} talaba
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  {teacher.courseCount} kurs
                </span>
              </div>
            </div>

            <div className="sm:flex sm:flex-col sm:items-end sm:gap-2">
              <TeacherDmButton
                locale={locale}
                teacherId={teacher.id}
                teacherName={fullName}
              />
            </div>
          </header>
        </div>
      </div>

      {/* Courses */}
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/[0.07] bg-ink-surface/60 p-6 backdrop-blur-sm sm:p-8">
          <h2
            className="text-2xl font-extrabold tracking-tight text-cream"
            style={{ letterSpacing: '-0.03em' }}
          >
            Kurslar
          </h2>
          <p className="mt-2 text-sm text-cream-dim">
            Ushbu ustozning ochiq va aktiv kurslari.
          </p>

          {courses.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-8 text-center text-sm text-cream-dim">
              Hozircha ochiq kurs mavjud emas.
            </div>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {courses.map((course) => (
                <li key={course.id}>
                  <CourseCard course={course} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Data lookups
// ──────────────────────────────────────────────────────────────────────

/**
 * Page through `/discovery/teachers` until we find one whose `slug`
 * matches `publicSlug`. The API does not yet expose a per-slug lookup,
 * so we walk the cursor with a hard cap on page count.
 */
async function findTeacherBySlug(
  publicSlug: string,
): Promise<DiscoveryTeacherSummary | null> {
  let cursor: string | undefined;
  for (let i = 0; i < MAX_LOOKUP_PAGES; i++) {
    let page;
    try {
      page = await serverDiscovery.listTeachers({
        ...(cursor && { cursor }),
        pageSize: TEACHER_LOOKUP_PAGE_SIZE,
      });
    } catch (err) {
      if (err instanceof ServerDiscoveryError && err.statusCode >= 500) {
        throw err;
      }
      // Network/4xx → render the graceful "not found" shell rather than
      // crashing the route during transient API outages.
      return null;
    }

    const match = page.items.find((t) => t.slug === publicSlug);
    if (match) return match;

    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

/**
 * Fetch a teacher's published+discoverable courses by walking the
 * public courses list and filtering on the client. Bounded by
 * `MAX_LOOKUP_PAGES` for the same reason as the teacher lookup.
 */
async function fetchTeacherCourses(
  publicSlug: string,
): Promise<DiscoveryCourseSummary[]> {
  const collected: DiscoveryCourseSummary[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_LOOKUP_PAGES; i++) {
    let page;
    try {
      page = await serverDiscovery.listCourses({
        ...(cursor && { cursor }),
        pageSize: COURSE_LOOKUP_PAGE_SIZE,
      });
    } catch {
      return collected;
    }
    for (const course of page.items) {
      if (course.teacher.publicSlug === publicSlug) {
        collected.push(course);
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return collected;
}
