import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import {
  ServerDiscoveryError,
  serverDiscovery,
} from '../../../../lib/server-discovery';
import type { DiscoveryTeacherSummary } from '../../../../lib/api/discovery';
import { DiscoverFilters } from '../../../../components/marketing/discover-filters';
import { EmptyState, TeacherCard } from '../../../../components/marketing/discovery-cards';

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
 * with the active query params, then renders the platform's light
 * Apple-style grid of teacher cards plus filter UI and a "show more"
 * pagination link driven by the cursor returned from the API.
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

  const resetHref = `/${locale}/discover`;

  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[400px] w-[400px] rounded-full bg-blue/5 blur-[100px]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/15 bg-blue-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Discovery
          </span>
          <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
            Ustozlar
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">
            Bilgim platformasidagi faol ustozlarni toping. Mutaxassislik
            bo&apos;yicha filtrlang yoki ism bilan qidiring.
          </p>
        </header>

        {/* Filters / search */}
        <div className="mt-10">
          <DiscoverFilters locale={locale} initialQuery={q} />
        </div>

        {/* Results */}
        <div className="mt-10">
          {loadError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red/15 bg-red-tint p-6 text-sm font-semibold text-red"
            >
              {loadError}
            </div>
          ) : teachers.length === 0 ? (
            <EmptyState
              resetHref={resetHref}
              hasFilters={!!q}
              {...(!q && {
                message: 'Hozircha ochiq profilga ega ustozlar mavjud emas.',
              })}
            />
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
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-6 py-3 text-sm font-bold text-ink-soft shadow-soft transition-all hover:border-blue/20 hover:text-blue"
            >
              Ko&apos;proq ko&apos;rish
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
