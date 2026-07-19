import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  ServerDiscoveryError,
  serverDiscovery,
} from '../../../../lib/server-discovery';
import type { DiscoveryTeacherSummary } from '../../../../lib/api/discovery';
import { DiscoverFilters } from '../../../../components/marketing/discover-filters';

interface DiscoverPageProps {
  params: { locale: string };
  searchParams: {
    q?: string;
    cursor?: string;
  };
}

const PAGE_SIZE = 20;

/**
 * Public teacher catalog (Task 25.5, Req 14.1–14.7).
 *
 * Server component — fetches from `/api/v1/discovery/teachers` (public)
 * with the active query params, then renders a Tailwind dark-themed
 * grid of teacher cards plus filter UI and a "show more" pagination
 * link driven by the cursor returned from the API.
 *
 * This page never needs authentication; the visitor reaches it via the
 * marketing nav and may follow a teacher link to `/teachers/[slug]`.
 */
export default async function DiscoverPage({
  params: { locale },
  searchParams,
}: DiscoverPageProps) {
  unstable_setRequestLocale(locale);

  const q = (searchParams.q ?? '').trim();
  const cursor = searchParams.cursor?.trim() || undefined;

  let teachers: DiscoveryTeacherSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  // The API rejects q < 2 chars with a 400 — only forward when valid.
  const apiQuery = q.length >= 2 ? q : undefined;

  try {
    const page = await serverDiscovery.listTeachers({
      ...(apiQuery && { q: apiQuery }),
      ...(cursor && { cursor }),
      pageSize: PAGE_SIZE,
    });
    teachers = page.items;
    nextCursor = page.nextCursor;
  } catch (err) {
    if (err instanceof ServerDiscoveryError) {
      // 4xx from a public endpoint usually means a bad filter; render
      // an empty state with the friendly message rather than crashing
      // the whole route.
      loadError = err.message;
    } else {
      loadError =
        "Ustozlar ro'yxatini yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
    }
  }

  // Build a stable href for the "Ko'proq ko'rish" pagination link that
  // preserves the current filters.
  const buildCursorHref = (next: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    sp.set('cursor', next);
    return `/${locale}/discover?${sp.toString()}`;
  };

  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-20">
      {/* Soft glow backdrop matching the auth/marketing palette */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="pointer-events-none absolute -left-40 top-10 h-[400px] w-[400px] rounded-full bg-accent2-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Discovery
          </span>
          <h1
            className="mt-4 text-balance font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
              letterSpacing: '-0.04em',
            }}
          >
            Ustozlar
          </h1>
          <p className="mt-3 max-w-xl text-base text-cream-dim sm:text-lg">
            EduBridge platformasidagi faol ustozlarni toping. Mutaxassislik
            bo&apos;yicha filtrlang yoki ism bilan qidiring.
          </p>
        </header>

        {/* Filters / search */}
        <div className="mt-10">
          <DiscoverFilters
            locale={locale}
            initialQuery={q}
          />
        </div>

        {/* Results */}
        <div className="mt-10">
          {loadError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300"
            >
              {loadError}
            </div>
          ) : teachers.length === 0 ? (
            <EmptyState locale={locale} hasFilters={!!q} />
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {teachers.map((teacher) => (
                <li key={teacher.id}>
                  <TeacherCard teacher={teacher} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {nextCursor && (
          <div className="mt-10 text-center">
            <Link
              href={buildCursorHref(nextCursor)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-cream transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              Ko&apos;proq ko&apos;rish
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
          </div>
        )}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function TeacherCard({
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
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-surface p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent2-500/30 hover:shadow-[0_0_0_1px_rgba(0,232,122,0.18),0_18px_36px_-18px_rgba(0,232,122,0.4)]">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent2-500/10 ring-1 ring-inset ring-accent2-500/30">
          {teacher.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.avatarUrl}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-base font-extrabold tracking-tight text-accent2-500">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-base font-extrabold tracking-tight text-cream"
            style={{ letterSpacing: '-0.02em' }}
          >
            {fullName}
          </h3>
          {teacher.headline && (
            <p className="mt-1 line-clamp-2 text-sm text-cream-dim">
              {teacher.headline}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
        {specialtyLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            {specialtyLabel}
          </span>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4 text-center">
        <Stat
          label="Reyting"
          value={teacher.rating !== null ? teacher.rating.toFixed(1) : '—'}
        />
        <Stat label="Talabalar" value={String(teacher.studentsCount)} />
        <Stat label="Kurslar" value={String(teacher.courseCount)} />
      </dl>

      <div className="mt-6">
        {profileHref ? (
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-cream transition-colors group-hover:border-accent2-500/40 group-hover:bg-accent2-500/10 group-hover:text-accent2-500">
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
          <span className="inline-flex w-full items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-cream-dim/70">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="text-base font-extrabold tracking-tight text-cream"
        style={{ letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim/80">
        {label}
      </div>
    </div>
  );
}

function EmptyState({
  locale,
  hasFilters,
}: {
  locale: string;
  hasFilters: boolean;
}) {
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-ink-surface p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent2-500/10 text-accent2-500 ring-1 ring-inset ring-accent2-500/30">
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
      <h3
        className="mt-4 text-lg font-extrabold tracking-tight text-cream"
        style={{ letterSpacing: '-0.02em' }}
      >
        Hech narsa topilmadi
      </h3>
      <p className="mt-2 text-sm text-cream-dim">
        {hasFilters
          ? "Filtrlarni o'zgartirib qayta urinib ko'ring."
          : 'Hozircha ochiq profilga ega ustozlar mavjud emas.'}
      </p>
      {hasFilters && (
        <Link
          href={`/${locale}/discover`}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
        >
          Filtrlarni tozalash
        </Link>
      )}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return (parts[0]!.charAt(0) || 'U').toUpperCase();
  return (
    (parts[0]!.charAt(0) || '') + (parts[parts.length - 1]!.charAt(0) || '')
  ).toUpperCase();
}
