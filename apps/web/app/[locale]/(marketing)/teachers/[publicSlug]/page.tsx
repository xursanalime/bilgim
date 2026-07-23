import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft, ArrowRight, GraduationCap, Layers, Sparkles, Star, Users } from 'lucide-react';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryCourseSummary,
  type DiscoveryTeacherSummary,
} from '../../../../../lib/discovery-api';
import { TeacherDmButton } from '../../../../../components/marketing/teacher-dm-button';
import { formatRating, formatUzs, getInitials } from '../../../../../components/marketing/discovery-cards';
import { FadeIn, Stagger, StaggerItem, AnimatedCounter } from '../../../../../components/marketing/animated';

interface TeacherProfilePageProps {
  params: { locale: string; publicSlug: string };
  searchParams: { preview?: string };
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
  searchParams,
}: TeacherProfilePageProps): Promise<Metadata> {
  const previewToken = searchParams?.preview;
  if (previewToken) {
    // Draft preview — never index, and skip the discovery lookup below
    // entirely (the slug may not be claimed yet).
    return { title: "Ko'rib chiqish | Bilgim", robots: { index: false, follow: false } };
  }

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
    `${teacher.specialty?.nameUz ?? 'Bilgim'} mutaxassisi.`;
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
  searchParams,
}: TeacherProfilePageProps) {
  unstable_setRequestLocale(locale);

  const previewToken = searchParams?.preview;
  const resolved = previewToken
    ? await loadPreviewData(previewToken)
    : { teacher: await findTeacherBySlug(publicSlug), courses: await fetchTeacherCourses(publicSlug) };

  const { teacher } = resolved;
  if (!teacher) {
    notFound();
  }
  const courses = resolved.courses;

  const fullName = teacher.fullName ?? 'Ustoz';
  // Rendered as a teacher's dedicated "{slug}.bilgim.uz" home page (via the
  // middleware rewrite in middleware.ts) rather than the /teachers/[slug]
  // path on the main domain — hide the link back to the shared discovery
  // list since it doesn't fit a standalone school subdomain.
  const isSubdomain = Boolean(headers().get('x-teacher-slug'));
  // "Mening maktabim" brand color (Task 5/6) — used sparingly as an accent
  // (avatar ring, CTA icon chip) so a teacher's page feels personalized
  // without departing from the platform's light Apple-style token system.
  const accent = teacher.themeColor || '#2563eb';

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[400px] w-[400px] animate-[pulse_8s_ease-in-out_infinite] rounded-full bg-blue/5 blur-[100px]" />
      <div className="pointer-events-none absolute -left-32 bottom-0 h-[300px] w-[300px] animate-[pulse_10s_ease-in-out_infinite] rounded-full bg-purple/5 blur-[100px]" />

      {previewToken && (
        <div className="sticky top-0 z-20 border-b border-orange/20 bg-orange-tint px-4 py-2.5 text-center text-xs font-bold text-orange">
          Ko'rib chiqish rejimi — bu hali saqlanmagan qoralama, faqat sizga ko'rinadi.
        </div>
      )}

      <div className="relative mx-auto max-w-5xl px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pt-12">
        {!isSubdomain && !previewToken && (
          <Link
            href={`/${locale}/teachers`}
            className="relative z-10 mb-6 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-blue"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Ustozlar
          </Link>
        )}

        <FadeIn>
          {/* Banner */}
          <div className="relative h-36 overflow-hidden rounded-[2rem] sm:h-52">
            {teacher.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={teacher.avatarUrl}
                alt=""
                aria-hidden
                className="h-full w-full scale-110 object-cover blur-md"
              />
            ) : (
              <div className="relative h-full w-full bg-gradient-to-br from-blue-tint via-canvas to-purple/10">
                <Sparkles className="absolute right-8 top-6 h-8 w-8 text-blue/20" />
                <GraduationCap className="absolute bottom-6 left-10 h-10 w-10 text-purple/15" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/5 to-transparent" />
          </div>

          {/* Avatar + identity */}
          <div className="relative -mt-12 flex flex-col gap-6 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
              <div
                className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-[1.75rem] border-4 border-canvas bg-blue-tint text-blue sm:h-28 sm:w-28"
                style={{
                  boxShadow: `0 0 0 4px ${accent}26, 0 1px 2px rgb(0 0 0 / 0.04), 0 12px 32px -8px rgb(0 0 0 / 0.08)`,
                }}
              >
                {teacher.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={teacher.avatarUrl} alt={fullName} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xl font-extrabold tracking-tight">{getInitials(fullName)}</span>
                )}
              </div>

              <div className="min-w-0 pb-1">
                <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                  {fullName}
                </h1>
                {teacher.headline && (
                  <p className="mt-1.5 max-w-xl text-sm text-ink-soft sm:text-base">{teacher.headline}</p>
                )}
                {teacher.specialty && (
                  <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-blue">
                    {teacher.specialty.nameUz}
                  </span>
                )}
              </div>
            </div>

            <TeacherDmButton locale={locale} teacherId={teacher.id} teacherName={fullName} />
          </div>
        </FadeIn>

        {/* Stat cards */}
        <Stagger className="mt-8 grid grid-cols-3 gap-3 sm:gap-4" staggerDelay={0.08}>
          <StaggerItem>
            <StatCard icon={Star} label="Reyting" value={formatRating(teacher.rating)} accent={accent} />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={Users}
              label="Talabalar"
              value={<AnimatedCounter to={teacher.studentsCount} duration={1.2} />}
              accent={accent}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={Layers}
              label="Kurslar"
              value={<AnimatedCounter to={teacher.courseCount} duration={1.2} />}
              accent={accent}
            />
          </StaggerItem>
        </Stagger>
      </div>

      {/* Courses */}
      <div className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <FadeIn delay={0.1}>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong">
                Kurslar
              </h2>
              <p className="mt-1.5 text-sm text-ink-soft">Ushbu ustozning ochiq va aktiv kurslari.</p>
            </div>
          </div>

          {courses.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-3 rounded-[1.75rem] border border-dashed border-rim bg-tint/50 p-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint text-blue">
                <Layers className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-ink-soft">Hozircha ochiq kurs mavjud emas.</p>
            </div>
          ) : (
            <Stagger className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2" staggerDelay={0.08}>
              {courses.map((course) => (
                <StaggerItem key={course.id}>
                  <LightCourseCard course={course} locale={locale} accent={accent} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </FadeIn>
      </div>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Star;
  label: string;
  value: ReactNode;
  accent: string;
}) {
  return (
    <div className="group flex flex-col items-center gap-2 rounded-2xl border border-rim bg-canvas px-3 py-5 text-center shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:shadow-medium sm:flex-row sm:items-center sm:gap-3 sm:px-5 sm:text-left">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="font-display text-lg font-extrabold tracking-tight text-ink-strong sm:text-xl">
          {value}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint sm:text-[11px]">
          {label}
        </div>
      </div>
    </div>
  );
}

function LightCourseCard({
  course,
  locale,
  accent,
}: {
  course: DiscoveryCourseSummary;
  locale: string;
  accent: string;
}) {
  const teacherName = course.teacher.fullName ?? 'Ustoz';
  return (
    <Link
      href={`/${locale}/courses/${course.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-rim bg-white shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-blue/20 hover:shadow-medium"
    >
      <div className="relative h-32 w-full overflow-hidden">
        {course.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.coverUrl}
            alt=""
            aria-hidden
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${accent}1f, transparent 70%)` }}
          >
            <GraduationCap className="h-9 w-9" style={{ color: `${accent}55` }} />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
          {course.level && (
            <span className="inline-flex items-center rounded-full border border-rim bg-canvas/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft backdrop-blur">
              {course.level}
            </span>
          )}
          {course.fromPriceUzs !== null && (
            <span className="inline-flex items-center rounded-full border border-blue/15 bg-blue-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-blue">
              {formatUzs(course.fromPriceUzs)} so'm
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-lg font-extrabold tracking-tight text-ink-strong transition-colors group-hover:text-blue">
          {course.title}
        </h3>
        {course.description && (
          <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{course.description}</p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-rim pt-4 mt-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-tint text-sm font-extrabold text-blue">
              {getInitials(teacherName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-strong">{teacherName}</p>
              <p className="truncate text-xs text-ink-faint">
                {course.teacher.headline ?? 'Reyting ' + formatRating(course.teacher.rating)}
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition-all group-hover:translate-x-1 group-hover:text-blue" />
        </div>
      </div>
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Data lookups
// ──────────────────────────────────────────────────────────────────────

/**
 * Resolves a "Ko'rib chiqish" preview token (Task 6) into the same
 * `{teacher, courses}` shape the real lookup below produces, so the render
 * body doesn't need to branch on preview vs. live. Bypasses the discovery
 * publish/slug-uniqueness gates entirely — the signed token already proved
 * the caller owns this draft (see `getPreviewProfile` on the API).
 */
async function loadPreviewData(
  token: string,
): Promise<{ teacher: DiscoveryTeacherSummary | null; courses: DiscoveryCourseSummary[] }> {
  let preview;
  try {
    preview = await serverDiscovery.getTeacherPreview(token);
  } catch {
    return { teacher: null, courses: [] };
  }

  const teacher: DiscoveryTeacherSummary = {
    id: preview.teacher.id,
    slug: preview.teacher.slug,
    fullName: preview.teacher.fullName,
    headline: preview.teacher.headline,
    avatarUrl: preview.teacher.avatarUrl,
    themeColor: preview.teacher.themeColor,
    rating: preview.teacher.rating,
    studentsCount: preview.teacher.studentsCount,
    courseCount: preview.courses.length,
    specialty: null,
  };

  const courses: DiscoveryCourseSummary[] = preview.courses.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    level: c.level,
    coverUrl: c.coverUrl,
    fromPriceUzs: c.fromPriceUzs,
    teacher: {
      userId: teacher.id,
      publicSlug: teacher.slug,
      fullName: teacher.fullName,
      headline: teacher.headline,
      avatarUrl: teacher.avatarUrl,
      rating: teacher.rating,
      studentsCount: teacher.studentsCount,
      specialty: null,
    },
  }));

  return { teacher, courses };
}

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
