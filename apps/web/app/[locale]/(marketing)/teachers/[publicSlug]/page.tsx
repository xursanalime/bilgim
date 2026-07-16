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
import { cefrLabel, examTrackLabel } from '../../../../../components/discovery/facets';

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
      title: 'Ustoz topilmadi | Bilgim',
      description:
        "Bu ustoz mavjud emas yoki ochiq profili yo'q. Boshqa ustozlarni qidiring.",
    };
  }
  const fullName = teacher.fullName ?? 'Ustoz';
  const headline =
    teacher.headline ??
    `Ingliz tili ustozi${
      teacher.taughtCefrLevels.length > 0
        ? ` · ${teacher.taughtCefrLevels.join(', ')}`
        : ''
    }`;
  const title = `${fullName} | Bilgim`;
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
      siteName: 'Bilgim',
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
 * Public instructor profile (Req 15.3).
 *
 * Server Component — looks the instructor up by `publicSlug`, fetches
 * their published+discoverable courses, and renders avatar, headline,
 * the **CEFR levels they teach**, their **Exam_Track focus**, rating
 * (padded to 3 decimals), studentsCount, and a list of their courses.
 * Each course links into the detail page where the existing enrollment /
 * Payme flow lives (Req 15.5).
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
  const cefr = teacher.taughtCefrLevels ?? [];
  const tracks = teacher.examTrackFocus ?? [];

  return (
    <section>
      {/* Header */}
      <div className="border-b border-rim bg-canvas">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
          <Link
            href={`/${locale}/teachers`}
            className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft transition-colors hover:text-blue"
          >
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
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            Ustozlar
          </Link>

          <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-blue-tint ring-1 ring-inset ring-blue/20">
              {teacher.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={teacher.avatarUrl}
                  alt={fullName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl font-extrabold tracking-tight text-blue">
                  {getInitials(fullName)}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-balance text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                {fullName}
              </h1>
              {teacher.headline && (
                <p className="mt-3 max-w-2xl text-base text-ink-soft sm:text-lg">
                  {teacher.headline}
                </p>
              )}

              {/* CEFR levels taught + Exam_Track focus (Req 15.3) */}
              {(cefr.length > 0 || tracks.length > 0) && (
                <div className="mt-5 space-y-3">
                  {cefr.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                        O&apos;qitadigan darajalar
                      </span>
                      {cefr.map((level) => (
                        <span
                          key={`cefr-${level}`}
                          className="inline-flex items-center rounded-full border border-blue/20 bg-blue-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue"
                        >
                          {cefrLabel(level)}
                        </span>
                      ))}
                    </div>
                  )}
                  {tracks.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                        Imtihon yo&apos;nalishlari
                      </span>
                      {tracks.map((slug) => (
                        <span
                          key={`track-${slug}`}
                          className="inline-flex items-center rounded-full border border-orange/20 bg-orange-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-orange-600"
                        >
                          {examTrackLabel(slug)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 text-[11px] font-semibold text-ink-soft">
                  Reyting {formatRating(teacher.rating)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 text-[11px] font-semibold text-ink-soft">
                  {teacher.studentsCount} talaba
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rim bg-tint px-3 py-1 text-[11px] font-semibold text-ink-soft">
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
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-strong">
          Kurslar
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Ushbu ustozning ochiq va aktiv kurslari. Yozilish uchun kursni
          tanlang.
        </p>

        {courses.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-rim bg-canvas p-8 text-center text-sm text-ink-soft shadow-sm">
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
