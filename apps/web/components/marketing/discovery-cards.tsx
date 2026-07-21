import Link from 'next/link';

import type {
  DiscoveryCourseSummary,
  DiscoveryTeacherSummary,
} from '../../lib/discovery-api';

/**
 * Shared marketing cards for the public discovery surface (Task 25.5).
 *
 * Each card is a Server Component — they take typed payloads from the
 * API and render the platform's light Apple-style tokens (canvas/rim/ink,
 * blue accent) so `/search`, `/teachers`, `/courses`, and `/teachers/[slug]`
 * stay visually consistent with the rest of the product, not with an
 * invented dark marketing theme.
 */

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
  const specialtyLabel = teacher.specialty?.nameUz ?? null;
  const initials = getInitials(fullName);

  const card = (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-blue/20 hover:shadow-medium">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blue-tint text-blue">
          {teacher.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.avatarUrl}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-base font-extrabold tracking-tight">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-extrabold tracking-tight text-ink-strong">
            {fullName}
          </h3>
          {teacher.headline && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
              {teacher.headline}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
        {specialtyLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-bold uppercase tracking-[0.08em] text-blue">
            {specialtyLabel}
          </span>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-rim pt-4 text-center">
        <Stat label="Reyting" value={formatRating(teacher.rating)} />
        <Stat label="Talabalar" value={String(teacher.studentsCount)} />
        <Stat label="Kurslar" value={String(teacher.courseCount)} />
      </dl>

      <div className="mt-6">
        {profileHref ? (
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-tint px-4 py-2.5 text-sm font-bold text-blue transition-colors group-hover:bg-blue group-hover:text-white">
            Profilga kirish
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
    <Link href={profileHref} className="block focus:outline-none">
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
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-rim bg-canvas p-6 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-blue/20 hover:shadow-medium"
    >
      <div className="flex items-start gap-2 text-xs">
        {course.level && (
          <span className="inline-flex items-center rounded-full border border-rim bg-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft">
            {course.level}
          </span>
        )}
        {course.fromPriceUzs !== null && (
          <span className="inline-flex items-center rounded-full border border-blue/15 bg-blue-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-blue">
            {formatUzs(course.fromPriceUzs)} so&apos;m
          </span>
        )}
        {course.teacher.specialty && (
          <span className="inline-flex items-center rounded-full border border-rim bg-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft">
            {course.teacher.specialty.nameUz}
          </span>
        )}
      </div>

      <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink-strong">
        {course.title}
      </h3>
      {course.description && (
        <p className="mt-2 line-clamp-3 text-sm text-ink-soft">
          {course.description}
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 border-t border-rim pt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-tint text-sm font-extrabold text-blue">
          {getInitials(teacherName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink-strong">
            {teacherName}
          </p>
          <p className="truncate text-xs text-ink-faint">
            {course.teacher.headline ?? 'Reyting ' + formatRating(course.teacher.rating)}
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
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </div>
    </div>
  );
}

export function EmptyState({
  resetHref,
  hasFilters,
  message,
}: {
  resetHref: string;
  hasFilters: boolean;
  message?: string;
}) {
  return (
    <div className="rounded-3xl border border-rim bg-canvas p-10 text-center shadow-soft">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-tint text-blue">
        <svg
          className="h-6 w-6"
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
      </div>
      <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink-strong">
        Hech narsa topilmadi
      </h3>
      <p className="mt-2 text-sm text-ink-soft">
        {message ??
          (hasFilters
            ? "Filtrlarni o'zgartirib qayta urinib ko'ring."
            : 'Hozircha ochiq natijalar mavjud emas.')}
      </p>
      {hasFilters && (
        <Link
          href={resetHref}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-rim bg-tint px-5 py-2.5 text-sm font-bold text-ink-soft transition-colors hover:border-blue/20 hover:text-blue"
        >
          Filtrlarni tozalash
        </Link>
      )}
    </div>
  );
}

export function ErrorBanner({
  message,
  retryHref,
}: {
  message: string;
  retryHref: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-red/15 bg-red-tint p-5 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-red/10 text-red">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <p className="font-semibold text-red">{message}</p>
      </div>
      <Link
        href={retryHref}
        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-red/20 bg-canvas px-4 py-2 text-xs font-bold text-red transition-colors hover:bg-red/5"
      >
        Qayta urinib ko&apos;rish
      </Link>
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
