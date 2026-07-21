import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
  type DiscoveryTeacherSummary,
} from '../../../../lib/discovery-api';
import {
  EmptyState,
  ErrorBanner,
  TeacherCard,
} from '../../../../components/marketing/discovery-cards';

interface TeachersPageProps {
  params: { locale: string };
  searchParams: { cursor?: string };
}

const PAGE_SIZE = 20;

export function generateMetadata({
  params: { locale },
}: TeachersPageProps): Metadata {
  const title = "Ochiq ustozlar ro'yxati | EduBridge";
  const description =
    "EduBridge platformasidagi barcha ochiq ustozlar. Profilini ko'ring, kurslariga yoziling.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/teachers` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/teachers`,
      siteName: 'EduBridge',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public teacher catalog (Task 25.5, Req 14.1, 14.4).
 *
 * Server Component — paginates the `/discovery/teachers` endpoint with
 * a cursor. Filtering lives on `/search`; this page is the simple
 * "browse all" entry point.
 */
export default async function TeachersListPage({
  params: { locale },
  searchParams,
}: TeachersPageProps) {
  unstable_setRequestLocale(locale);

  const cursor = searchParams.cursor?.trim() || undefined;

  let teachers: DiscoveryTeacherSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    const page = await serverDiscovery.listTeachers({
      ...(cursor && { cursor }),
      pageSize: PAGE_SIZE,
    });
    teachers = page.items;
    nextCursor = page.nextCursor;
  } catch (err) {
    if (err instanceof ServerDiscoveryError && err.statusCode < 500) {
      loadError = err.message;
    } else {
      loadError =
        "Ustozlar ro'yxatini yuklashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
    }
  }

  const buildCursorHref = (next: string) =>
    `/${locale}/teachers?cursor=${encodeURIComponent(next)}`;

  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="pointer-events-none absolute -left-40 top-10 h-[400px] w-[400px] rounded-full bg-accent2-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Ustozlar
          </span>
          <h1
            className="mt-4 text-balance font-extrabold tracking-tight text-cream"
            style={{
              fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
              letterSpacing: '-0.04em',
            }}
          >
            EduBridge ustozlari
          </h1>
          <p className="mt-3 max-w-xl text-base text-cream-dim sm:text-lg">
            Platformadagi barcha ochiq ustozlar. Profil ochib, ularning
            ochiq kurslariga ko&apos;z tashlang.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              <svg
                className="h-4 w-4"
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
              Qidirish
            </Link>
            <Link
              href={`/${locale}/courses`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              Kurslar
            </Link>
          </div>
        </header>

        <div className="mt-10">
          {loadError ? (
            <ErrorBanner
              message={loadError}
              retryHref={`/${locale}/teachers`}
            />
          ) : teachers.length === 0 ? (
            <EmptyState
              resetHref={`/${locale}/teachers`}
              hasFilters={false}
              message="Hozircha ochiq profilga ega ustozlar mavjud emas."
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
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-cream transition-all hover:border-accent2-500/40 hover:bg-accent2-500/10 hover:text-accent2-500"
            >
              Keyingi sahifa
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
