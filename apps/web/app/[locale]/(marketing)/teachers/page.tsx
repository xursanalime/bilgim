import Link from 'next/link';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  serverDiscovery,
  ServerDiscoveryError,
} from '../../../../lib/server-discovery';
import type { DiscoveryTeacherSummary } from '../../../../lib/api/discovery';
import { TeacherCard } from '../../../../components/marketing/discovery-cards';
import {
  DiscoveryEmptyState,
  DiscoveryErrorState,
} from '../../../../components/discovery/discovery-states';
import { parseExamTrackParam } from '../../../../components/discovery/facets';

interface TeachersPageProps {
  params: { locale: string };
  searchParams: { cursor?: string; examTrack?: string };
}

const PAGE_SIZE = 20;

export function generateMetadata({
  params: { locale },
}: TeachersPageProps): Metadata {
  const title = "Ochiq ustozlar ro'yxati | Bilgim";
  const description =
    "Bilgim platformasidagi barcha ochiq ingliz tili ustozlari. Profilini ko'ring, kurslariga yoziling.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/teachers` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/teachers`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Public teacher catalog (Req 15.2, 15.3).
 *
 * Server Component — paginates the `/discovery/teachers` endpoint with a
 * cursor. Rich CEFR/Exam_Track filtering lives on `/search`; this page is
 * the simple "browse all" entry point with an optional Exam_Track
 * shortcut from the URL.
 */
export default async function TeachersListPage({
  params: { locale },
  searchParams,
}: TeachersPageProps) {
  unstable_setRequestLocale(locale);

  const cursor = searchParams.cursor?.trim() || undefined;
  const examTrack = parseExamTrackParam(searchParams.examTrack);

  let teachers: DiscoveryTeacherSummary[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;

  try {
    const page = await serverDiscovery.listTeachers({
      ...(examTrack && { examTrack }),
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

  const buildCursorHref = (next: string) => {
    const sp = new URLSearchParams();
    if (examTrack) sp.set('examTrack', examTrack);
    sp.set('cursor', next);
    return `/${locale}/teachers?${sp.toString()}`;
  };

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue/20 bg-blue-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-blue" />
            Ustozlar
          </span>
          <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-ink-strong sm:text-5xl">
            Bilgim ustozlari
          </h1>
          <p className="mt-3 max-w-xl text-base text-ink-soft sm:text-lg">
            Platformadagi barcha ochiq ustozlar. Profil ochib, ularning o&apos;qitadigan
            CEFR darajalari va ochiq kurslariga ko&apos;z tashlang.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/${locale}/search`}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              CEFR / Exam Track bo&apos;yicha qidirish
            </Link>
            <Link
              href={`/${locale}/courses`}
              className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2 font-semibold text-ink-strong transition-colors hover:border-blue/30 hover:bg-blue-tint hover:text-blue"
            >
              Kurslar
            </Link>
          </div>
        </header>

        <div className="mt-10">
          {loadError ? (
            <DiscoveryErrorState
              message={loadError}
              retryHref={`/${locale}/teachers`}
            />
          ) : teachers.length === 0 ? (
            <DiscoveryEmptyState description="Hozircha ochiq profilga ega ustozlar mavjud emas." />
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
              Keyingi sahifa
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
