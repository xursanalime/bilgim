import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
} from '../../../../../lib/server-discovery';
import type { DiscoveryCourseSummary } from '../../../../../lib/api/discovery';
import {
  formatRating,
  formatUzs,
  getInitials,
} from '../../../../../components/marketing/discovery-cards';
import { JoinCourseGroups } from '../../../../../components/marketing/join-course-groups';
import { cefrLabel, examTrackLabel } from '../../../../../components/discovery/facets';

interface CourseDetailPageProps {
  params: { locale: string; id: string };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params: { locale, id },
}: CourseDetailPageProps): Promise<Metadata> {
  const course = await safeFetchCourse(id);
  if (!course) {
    return {
      title: 'Kurs topilmadi | Bilgim',
      description:
        "Bu kurs mavjud emas yoki ochiq emas. Boshqa kurslarni ko'rib chiqing.",
    };
  }
  const teacherName = course.teacher.fullName ?? 'Ustoz';
  const title = `${course.title} | Bilgim`;
  const description =
    course.description?.slice(0, 200) ??
    `${teacherName} tomonidan o'qitiladigan ingliz tili kursi. Bilgim platformasida.`;
  const url = `/${locale}/courses/${id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title,
      description,
      url,
      siteName: 'Bilgim',
      ...(course.coverUrl && {
        images: [{ url: course.coverUrl, alt: course.title }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(course.coverUrl && { images: [course.coverUrl] }),
    },
  };
}

/**
 * Public course detail (Req 15.2, 15.3, 15.5).
 *
 * Server Component — calls `/discovery/courses/:id` which already
 * enforces `isPublished=true AND isDiscoverable=true` (404 otherwise,
 * mapped here to Next.js `notFound`).
 *
 * Layout:
 *   - Header: cover image, title, CEFR level / Exam_Track / price pills.
 *   - Teacher card: avatar, name, headline, rating (3-decimal pad).
 *   - Description body.
 *   - `JoinCourseGroups` — the existing enrollment client island that
 *     routes the visitor through login + the Payme/enrollment-request
 *     flow (Req 15.5). Not reimplemented here, only embedded.
 */
export default async function CourseDetailPage({
  params: { locale, id },
}: CourseDetailPageProps) {
  unstable_setRequestLocale(locale);

  if (!UUID_RE.test(id)) {
    notFound();
  }

  const course = await safeFetchCourse(id);
  if (!course) {
    notFound();
  }

  const teacherName = course.teacher.fullName ?? 'Ustoz';
  const teacherSlug = course.teacher.publicSlug;
  const teacherHref = teacherSlug
    ? `/${locale}/teachers/${teacherSlug}`
    : null;

  return (
    <section>
      {/* Hero */}
      <div className="border-b border-rim bg-canvas">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
          <Link
            href={`/${locale}/courses`}
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
            Kurslar
          </Link>

          <header className="mt-8">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {course.cefrLevel && (
                <span className="inline-flex items-center rounded-full border border-blue/20 bg-blue-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue">
                  {cefrLabel(course.cefrLevel)}
                </span>
              )}
              {course.examTrack && (
                <span className="inline-flex items-center rounded-full border border-orange/20 bg-orange-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-orange-600">
                  {examTrackLabel(course.examTrack)}
                </span>
              )}
              {!course.cefrLevel && course.level && (
                <span className="inline-flex items-center rounded-full border border-rim bg-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                  {course.level}
                </span>
              )}
              {course.fromPriceUzs !== null && (
                <span className="inline-flex items-center rounded-full border border-green/20 bg-green-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-700">
                  {formatUzs(course.fromPriceUzs)} so&apos;m dan
                </span>
              )}
            </div>
            <h1 className="mt-5 text-balance text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
              {course.title}
            </h1>
          </header>

          {course.coverUrl && (
            <div className="mt-8 overflow-hidden rounded-3xl border border-rim">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={course.coverUrl}
                alt={course.title}
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <article className="rounded-3xl border border-rim bg-canvas p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">
                Kurs haqida
              </h2>
              {course.description ? (
                <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-soft">
                  {course.description}
                </p>
              ) : (
                <p className="mt-4 text-base leading-relaxed text-ink-faint">
                  Kursning batafsil tavsifi tez orada qo&apos;shiladi.
                </p>
              )}
            </article>

            <article className="rounded-3xl border border-rim bg-canvas p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">
                Guruhlar
              </h2>
              <p className="mt-4 text-sm text-ink-soft">
                Quyidagi guruhlardan birini tanlang va qo&apos;shilish
                so&apos;rovini yuboring. Ustoz so&apos;rovingizni tasdiqlagach,
                darslar va jadval ochiladi.
              </p>
            </article>
          </div>

          <aside className="space-y-6">
            {/* Teacher card */}
            <div className="rounded-3xl border border-rim bg-canvas p-6 shadow-sm">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                Ustoz
              </h2>
              <div className="mt-4 flex items-start gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blue-tint ring-1 ring-inset ring-blue/20">
                  {course.teacher.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={course.teacher.avatarUrl}
                      alt={teacherName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-base font-extrabold tracking-tight text-blue">
                      {getInitials(teacherName)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-bold tracking-tight text-ink-strong">
                    {teacherName}
                  </p>
                  {course.teacher.headline && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-soft">
                      {course.teacher.headline}
                    </p>
                  )}
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-rim pt-4 text-center">
                <div>
                  <div className="text-base font-extrabold tracking-tight text-ink-strong">
                    {formatRating(course.teacher.rating)}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    Reyting
                  </div>
                </div>
                <div>
                  <div className="text-base font-extrabold tracking-tight text-ink-strong">
                    {course.teacher.studentsCount}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    Talabalar
                  </div>
                </div>
              </dl>

              {teacherHref && (
                <Link
                  href={teacherHref}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-strong transition-colors hover:border-blue/30 hover:bg-blue-tint hover:text-blue"
                >
                  Ustoz profili
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
              )}
            </div>

            {/* Join CTA — client island: lists groups + submits join request
                through the existing enrollment / Payme flow (Req 15.5). */}
            <JoinCourseGroups locale={locale} courseId={id} />
          </aside>
        </div>
      </div>
    </section>
  );
}

/**
 * Wraps `serverDiscovery.getCourse` to translate the API's 404 into a
 * `null` result so the page can call Next.js `notFound()`.
 *
 * Network errors (API unreachable, fetch failed) are also surfaced as
 * `null` so the page renders the "topilmadi" shell rather than a 500.
 */
async function safeFetchCourse(
  id: string,
): Promise<DiscoveryCourseSummary | null> {
  try {
    return await serverDiscovery.getCourse(id);
  } catch (err) {
    if (err instanceof ServerDiscoveryError) {
      if (err.statusCode === 404) return null;
      if (err.statusCode < 500) return null;
      throw err;
    }
    return null;
  }
}
