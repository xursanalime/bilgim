import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft, Layers, Star, Users } from 'lucide-react';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
  type DiscoveryTeacherSummary,
} from '../../../../../lib/discovery-api';
import { TeacherDmButton } from '../../../../../components/marketing/teacher-dm-button';
import { formatRating, getInitials } from '../../../../../components/marketing/discovery-cards';

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
 *
 * Styled with the platform's light Apple-style tokens (canvas/rim/ink,
 * blue accent) to match the rest of the `/teachers` listing.
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
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[400px] w-[400px] rounded-full bg-blue/5 blur-[100px]" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-[300px] w-[300px] rounded-full bg-purple/5 blur-[100px]" />

      <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <Link
          href={`/${locale}/teachers`}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-blue"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Ustozlar
        </Link>

        <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-blue-tint text-blue">
            {teacher.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={teacher.avatarUrl}
                alt={fullName}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-2xl font-extrabold tracking-tight">
                {getInitials(fullName)}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
              {fullName}
            </h1>
            {teacher.headline && (
              <p className="mt-3 max-w-2xl text-base text-ink-soft sm:text-lg">
                {teacher.headline}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
              {teacher.specialty && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-bold uppercase tracking-[0.08em] text-blue">
                  {teacher.specialty.nameUz}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 font-bold text-ink-soft">
                <Star className="h-3 w-3" /> {formatRating(teacher.rating)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 font-bold text-ink-soft">
                <Users className="h-3 w-3" /> {teacher.studentsCount} talaba
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 font-bold text-ink-soft">
                <Layers className="h-3 w-3" /> {teacher.courseCount} kurs
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

      {/* Courses */}
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong">
            Kurslar
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Ushbu ustozning ochiq va aktiv kurslari.
          </p>

          {courses.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-rim bg-tint p-8 text-center text-sm text-ink-soft">
              Hozircha ochiq kurs mavjud emas.
            </div>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {courses.map((course) => (
                <li key={course.id}>
                  <LightCourseCard course={course} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function LightCourseCard({
  course,
  locale,
}: {
  course: DiscoveryCourseSummary;
  locale: string;
}) {
  const teacherName = course.teacher.fullName ?? 'Ustoz';
  return (
    <Link
      href={`/${locale}/courses/${course.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-rim bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:border-blue/20 hover:shadow-medium"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {course.level && (
          <span className="inline-flex items-center rounded-full border border-rim bg-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft">
            {course.level}
          </span>
        )}
        {course.fromPriceUzs !== null && (
          <span className="inline-flex items-center rounded-full border border-blue/15 bg-blue-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-blue">
            {course.fromPriceUzs.toLocaleString('uz-UZ')} so'm
          </span>
        )}
      </div>

      <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink-strong">
        {course.title}
      </h3>
      {course.description && (
        <p className="mt-2 line-clamp-3 text-sm text-ink-soft">{course.description}</p>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-rim pt-4 mt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-tint text-sm font-extrabold text-blue">
          {getInitials(teacherName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink-strong">{teacherName}</p>
          <p className="truncate text-xs text-ink-faint">
            {course.teacher.headline ?? 'Reyting ' + formatRating(course.teacher.rating)}
          </p>
        </div>
      </div>
    </Link>
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
