import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  ServerDiscoveryError,
  serverDiscovery,
} from '../../../../lib/server-discovery';
import type { DiscoveryTeacherSummary } from '../../../../lib/api/discovery';
import { DiscoverFilters } from '../../../../components/marketing/discover-filters';
import { TeacherCard } from '../../../../components/marketing/discovery-cards';
import {
  DiscoveryEmptyState,
  DiscoveryErrorState,
} from '../../../../components/discovery/discovery-states';
import {
  parseCefrParam,
  parseExamTrackParam,
} from '../../../../components/discovery/facets';

interface DiscoverPageProps {
  params: { locale: string };
  searchParams: {
    q?: string;
    cefrLevel?: string | string[];
    examTrack?: string;
    cursor?: string;
  };
}

const PAGE_SIZE = 20;

export function generateMetadata({
  params: { locale },
}: DiscoverPageProps): Metadata {
  const title = "Ustozlarni kashf eting | Bilgim";
  const description =
    "Bilgim platformasidagi ingliz tili ustozlarini CEFR daraja va imtihon yo'nalishi bo'yicha qidiring va o'zingizga mos ustozni toping.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/discover` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/discover`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public instructor catalog (Req 15.2, 15.3).
 *
 * Server Component — fetches from `/api/v1/discovery/teachers` (public)
 * with the active CEFR level + Exam_Track facets, then renders a grid of
 * teacher cards plus filter UI and a cursor-driven "show more" link.
 *
 * The visitor reaches this via the marketing nav and may follow a teacher
 * link to `/teachers/[slug]`.
 */
export default async function DiscoverPage({
  params: { locale },
  searchParams,
}: DiscoverPageProps) {
  unstable_setRequestLocale(locale);

  const q = (searchParams.q ?? '').trim();
  const cursor = searchParams.cursor?.trim() || undefined;
  const cefrLevels = parseCefrParam(searchParams.cefrLevel);
  const examTrack = parseExamTrackParam(searchParams.examTrack);

  let teachers: DiscoveryTeacherSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  // The API rejects q < 2 chars with a 400 — only forward when valid.
  const apiQuery = q.length >= 2 ? q : undefined;
  const hasFilters = !!q || cefrLevels.length > 0 || !!examTrack;

  try {
    const page = await serverDiscovery.listTeachers({
      ...(apiQuery && { q: apiQuery }),
      ...(cefrLevels.length > 0 && { cefrLevel: cefrLevels }),
      ...(examTrack && { examTrack }),
      ...(cursor && { cursor }),
      pageSize: PAGE_SIZE,
    });
    teachers = page.items;
    nextCursor = page.nextCursor;
  } catch (err) {
    if (err instanceof ServerDiscoveryError) {
      loadError = err.message;
    } else {
      loadError =
        "Ustozlar ro'yxatini yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
    }
  }

  const buildCursorHref = (next: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    for (const level of cefrLevels) sp.append('cefrLevel', level);
    if (examTrack) sp.set('examTrack', examTrack);
    sp.set('cursor', next);
    return `/${locale}/discover?${sp.toString()}`;
  };

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Discovery
          </span>
          <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
            Ustozlar
          </h1>
          <p className="mt-3 max-w-xl text-base text-ink-soft sm:text-lg">
            Bilgim platformasidagi ingliz tili ustozlarini toping. CEFR daraja
            yoki imtihon yo&apos;nalishi (masalan IELTS) bo&apos;yicha filtrlang
            yoki ism bilan qidiring.
          </p>
        </header>

        {/* Filters / search */}
        <div className="mt-10">
          <DiscoverFilters
            locale={locale}
            initialQuery={q}
            initialCefr={cefrLevels}
            {...(examTrack && { initialExamTrack: examTrack })}
          />
        </div>

        {/* Results */}
        <div className="mt-10">
          {loadError ? (
            <DiscoveryErrorState
              message={loadError}
              retryHref={`/${locale}/discover`}
            />
          ) : teachers.length === 0 ? (
            <DiscoveryEmptyState
              description={
                hasFilters
                  ? "Filtrlarni o'zgartirib qayta urinib ko'ring."
                  : 'Hozircha ochiq profilga ega ustozlar mavjud emas.'
              }
              {...(hasFilters && { resetHref: `/${locale}/discover` })}
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

        {nextCursor && !loadError && (
          <div className="mt-10 text-center">
            <Link
              href={buildCursorHref(nextCursor)}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-6 py-3 text-sm font-semibold text-ink-strong shadow-sm transition-colors hover:border-blue/30 hover:bg-blue-tint hover:text-blue"
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
                aria-hidden="true"
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
