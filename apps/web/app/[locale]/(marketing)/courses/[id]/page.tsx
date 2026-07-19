import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
} from '../../../../../lib/discovery-api';
import {
  formatRating,
  formatUzs,
  getInitials,
} from '../../../../../components/marketing/discovery-cards';
import { JoinCourseGroups } from '../../../../../components/marketing/join-course-groups';

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
      title: 'Kurs topilmadi | EduBridge',
      description: "Bu kurs mavjud emas yoki ochiq emas. Boshqa kurslarni ko'rib chiqing.",
    };
  }
  const teacherName = course.teacher.fullName ?? 'Ustoz';
  const title = `${course.title} | EduBridge`;
  const description =
    course.description?.slice(0, 200) ??
    `${teacherName} tomonidan o'qitiladigan kurs. EduBridge platformasida.`;
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
      siteName: 'EduBridge',
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
 * Public course detail (Task 25.5, Req 14.2, 14.3, 14.6).
 *
 * Server Component — calls `/discovery/courses/:id` which already
 * enforces `isPublished=true AND isDiscoverable=true` (404 otherwise,
 * mapped here to Next.js `notFound`).
 *
 * Layout:
 *   - Header: cover image, title, level/price/specialty pills.
 *   - Teacher card: avatar, name, headline, rating (3-decimal pad).
 *   - Description body.
 *   - "Yozilish" CTA — visitor goes through the existing Payme +
 *     enrollment-request flow (Req 14.6) routed through the login page
 *     (no public enrollment until auth).
 *
 * Group list is intentionally not rendered: the public discovery API
 * does not yet expose groups (the visibility surface is course-level).
 * A note explains that groups appear after enrollment.
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
    <section className="relative overflow-hidden bg-ink">
      {/* Hero */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
        <div className="pointer-events-none absolute -right-32 top-0 h-[400px] w-[400px] rounded-full bg-accent2-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 lg:px-8 lg:pt-20">
          <Link
            href={`/${locale}/courses`}
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
            Kurslar
          </Link>

          <header className="mt-8">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {course.level && (
                <span className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  {course.level}
                </span>
              )}
              {course.fromPriceUzs !== null && (
                <span className="inline-flex items-center rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent2-500">
                  {formatUzs(course.fromPriceUzs)} so&apos;m dan
                </span>
              )}
              {course.teacher.specialty && (
                <span className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  {course.teacher.specialty.nameUz}
                </span>
              )}
            </div>
            <h1
              className="mt-5 text-balance font-extrabold tracking-tight text-cream"
              style={{
                fontSize: 'clamp(2rem, 4.5vw, 3.25rem)',
                letterSpacing: '-0.04em',
              }}
            >
              {course.title}
            </h1>
          </header>

          {course.coverUrl && (
            <div className="mt-8 overflow-hidden rounded-3xl border border-white/[0.07] bg-ink-surface">
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
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <article className="rounded-3xl border border-white/[0.07] bg-ink-surface/60 p-6 backdrop-blur-sm sm:p-8">
              <h2
                className="text-xl font-extrabold tracking-tight text-cream"
                style={{ letterSpacing: '-0.03em' }}
              >
                Kurs haqida
              </h2>
              {course.description ? (
                <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-cream-dim">
                  {course.description}
                </p>
              ) : (
                <p className="mt-4 text-base leading-relaxed text-cream-dim/80">
                  Kursning batafsil tavsifi tez orada qo&apos;shiladi.
                </p>
              )}
            </article>

            <article className="rounded-3xl border border-white/[0.07] bg-ink-surface/60 p-6 backdrop-blur-sm sm:p-8">
              <h2
                className="text-xl font-extrabold tracking-tight text-cream"
                style={{ letterSpacing: '-0.03em' }}
              >
                Guruhlar
              </h2>
              <p className="mt-4 text-sm text-cream-dim">
                Quyidagi guruhlardan birini tanlang va qo&apos;shilish
                so&apos;rovini yuboring. Ustoz so&apos;rovingizni
                tasdiqlagach, darslar va jadval ochiladi.
              </p>
            </article>
          </div>

          <aside className="space-y-6">
            {/* Teacher card */}
            <div className="rounded-3xl border border-white/[0.07] bg-ink-surface/60 p-6 backdrop-blur-sm">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
                Ustoz
              </h2>
              <div className="mt-4 flex items-start gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent2-500/10 ring-1 ring-inset ring-accent2-500/30">
                  {course.teacher.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={course.teacher.avatarUrl}
                      alt={teacherName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-base font-extrabold tracking-tight text-accent2-500">
                      {getInitials(teacherName)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className="truncate text-base font-extrabold tracking-tight text-cream"
                    style={{ letterSpacing: '-0.02em' }}
                  >
                    {teacherName}
                  </p>
                  {course.teacher.headline && (
                    <p className="mt-1 line-clamp-2 text-xs text-cream-dim">
                      {course.teacher.headline}
                    </p>
                  )}
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 text-center">
                <div>
                  <div
                    className="text-base font-extrabold tracking-tight text-cream"
                    style={{ letterSpacing: '-0.02em' }}
                  >
                    {formatRating(course.teacher.rating)}
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim/80">
                    Reyting
                  </div>
                </div>
                <div>
                  <div
                    className="text-base font-extrabold tracking-tight text-cream"
                    style={{ letterSpacing: '-0.02em' }}
                  >
                    {course.teacher.studentsCount}
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim/80">
                    Talabalar
                  </div>
                </div>
              </dl>

              {teacherHref && (
                <Link
                  href={teacherHref}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
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
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </Link>
              )}
            </div>

            {/* Join CTA — client island: lists groups + submits join request */}
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
 * This keeps the public marketing surface resilient — a transient API
 * outage shouldn't crash the route. Genuine 5xx responses from a
 * reachable API still bubble up so they hit the standard error
 * boundary and show the user a real error message.
 */
async function safeFetchCourse(
  id: string,
): Promise<DiscoveryCourseSummary | null> {
  try {
    return await serverDiscovery.getCourse(id);
  } catch (err) {
    if (err instanceof ServerDiscoveryError) {
      if (err.statusCode === 404) return null;
      // 4xx like a malformed UUID should still 404 the page rather than
      // bubble up; the caller filters UUIDs before getting here.
      if (err.statusCode < 500) return null;
      throw err;
    }
    // Network / fetch failures aren't ServerDiscoveryError. Render the
    // graceful "not found" shell instead of a 500 so the marketing
    // page stays usable when the API is briefly unreachable.
    return null;
  }
}
