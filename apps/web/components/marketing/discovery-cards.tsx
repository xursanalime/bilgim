import Link from 'next/link';

import type {
  DiscoveryCourseSummary,
  DiscoveryTeacherSummary,
} from '../../lib/api/discovery';
import { cefrLabel, examTrackLabel } from '../discovery/facets';

/**
 * Shared discovery cards for the public catalog (Req 15.2, 15.3).
 *
 * Each card is a Server Component — they take typed payloads from the
 * discovery API and render the unified light design system (semantic
 * tokens: `bg-canvas`, `text-ink-*`, `text-blue`, `border-rim`). Kept in
 * one module so `/search`, `/teachers`, `/courses`, `/discover`, and
 * `/teachers/[slug]` stay visually consistent without duplicating markup.
 *
 * English-only refocus: cards surface the **CEFR level** + **Exam_Track**
 * facets (replacing the retired specialty pill). Courses link into the
 * detail page, where the existing enrollment / Payme flow lives (Req 15.5).
 */

const arrowIcon = (
  <svg
    className="h-4 w-4 transition-transform group-hover:translate-x-1"
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
);

/** CEFR level pill (brand-tinted). */
function CefrPill({ level }: { level: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-blue/20 bg-blue-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue">
      {cefrLabel(level)}
    </span>
  );
}

/** Exam-track pill (premium/orange-tinted to stand apart from CEFR). */
function ExamTrackPill({ slug }: { slug: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-orange/20 bg-orange-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-orange-600">
      {examTrackLabel(slug)}
    </span>
  );
}

export function TeacherCard({
  teacher,
  locale,
}: {
  teacher: DiscoveryTeacherSummary;
  locale: string;
}) {
  const fullName = teacher.fullName ?? 'Ustoz';
  const slug = teacher.slug;
  const profileHref = slug ? `/${locale}/teachers/${slug}` : null;
  const initials = getInitials(fullName);
  const cefr = teacher.taughtCefrLevels ?? [];
  const tracks = teacher.examTrackFocus ?? [];

  const card = (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-blue/30 hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blue-tint ring-1 ring-inset ring-blue/20">
          {teacher.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.avatarUrl}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-base font-extrabold tracking-tight text-blue">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold tracking-tight text-ink-strong">
            {fullName}
          </h3>
          {teacher.headline && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
              {teacher.headline}
            </p>
          )}
        </div>
      </div>

      {(cefr.length > 0 || tracks.length > 0) && (
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {cefr.map((level) => (
            <CefrPill key={`cefr-${level}`} level={level} />
          ))}
          {tracks.map((slug) => (
            <ExamTrackPill key={`track-${slug}`} slug={slug} />
          ))}
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-rim pt-4 text-center">
        <Stat label="Reyting" value={formatRating(teacher.rating)} />
        <Stat label="Talabalar" value={String(teacher.studentsCount)} />
        <Stat label="Kurslar" value={String(teacher.courseCount)} />
      </dl>

      <div className="mt-6">
        {profileHref ? (
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-strong transition-colors group-hover:border-blue/30 group-hover:bg-blue-tint group-hover:text-blue">
            Profilga kirish
            {arrowIcon}
          </span>
        ) : (
          <span className="inline-flex w-full items-center justify-center rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-faint">
            Profil tez orada
          </span>
        )}
      </div>
    </article>
  );

  if (!profileHref) return card;
  return (
    <Link
      href={profileHref}
      className="block rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {card}
    </Link>
  );
}

export function CourseCard({
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
      className="group flex h-full flex-col overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-blue/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {course.cefrLevel && <CefrPill level={course.cefrLevel} />}
        {course.examTrack && <ExamTrackPill slug={course.examTrack} />}
        {!course.cefrLevel && course.level && (
          <span className="inline-flex items-center rounded-full border border-rim bg-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
            {course.level}
          </span>
        )}
        {course.fromPriceUzs !== null && (
          <span className="inline-flex items-center rounded-full border border-green/20 bg-green-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-700">
            {formatUzs(course.fromPriceUzs)} so&apos;m
          </span>
        )}
      </div>

      <h3 className="mt-4 text-lg font-bold tracking-tight text-ink-strong">
        {course.title}
      </h3>
      {course.description && (
        <p className="mt-2 line-clamp-3 text-sm text-ink-soft">
          {course.description}
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-rim pt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-tint text-sm font-extrabold text-blue ring-1 ring-inset ring-blue/20">
          {getInitials(teacherName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-strong">
            {teacherName}
          </p>
          <p className="truncate text-xs text-ink-soft">
            {course.teacher.headline ??
              'Reyting ' + formatRating(course.teacher.rating)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base font-extrabold tracking-tight text-ink-strong">
        {value}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Pad teacher rating to three decimals so the column is visually
 * stable in the cards (e.g. 4.5 → "4.500"). Returns "—" when null.
 */
export function formatRating(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(3);
}

export function formatUzs(value: number): string {
  return value.toLocaleString('uz-UZ');
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return (parts[0]!.charAt(0) || 'U').toUpperCase();
  return (
    (parts[0]!.charAt(0) || '') + (parts[parts.length - 1]!.charAt(0) || '')
  ).toUpperCase();
}
