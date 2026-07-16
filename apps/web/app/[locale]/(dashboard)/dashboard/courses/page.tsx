import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { Plus, BookOpen, Search, Filter } from 'lucide-react';

import { requireRole } from '../../../../../lib/server-auth';
import { serverApi, ServerApiError } from '../../../../../lib/server-api';
import type { Course } from '../../../../../lib/api/catalog';
import type { Subscription } from '../../../../../lib/api/billing';
import { CourseGrid } from '../../../../../components/dashboard/course-grid';
import { SubscriptionRestrictionBanner } from '../../../../../components/billing/subscription-restriction-banner';

interface PageProps {
  params: { locale: string };
}

export default async function CoursesPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let courses: Course[] = [];
  let loadError: string | null = null;
  try {
    courses = await serverApi.get<Course[]>('/catalog/courses');
  } catch (err) {
    if (err instanceof ServerApiError) {
      loadError = err.message;
    } else {
      throw err;
    }
  }

  // Subscription status drives the publishing-restriction banner (Req 8.7).
  // Best-effort: a failed/absent subscription simply renders no banner.
  let subscription: Subscription | null = null;
  try {
    subscription = await serverApi.get<Subscription | null>(
      '/billing/subscription',
    );
  } catch {
    subscription = null;
  }

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <BookOpen className="h-3 w-3" />
            Ta'lim maskani
          </div>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink-strong">
            Kurslaringiz
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {courses.length === 0
              ? 'Hali kurslar yo\u2018q. Birinchi kursni yarating.'
              : `${courses.length} ta ochiq va yopiq kurslar mavjud`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:min-w-[240px]">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input 
              type="text" 
              placeholder="Kurslarni qidirish..." 
              className="w-full rounded-2xl border border-rim bg-white px-11 py-2.5 text-sm outline-none transition-all focus:border-blue/40 focus:ring-4 focus:ring-blue/5"
            />
          </div>
          
          <button className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rim bg-white text-ink-soft transition-all hover:bg-tint">
            <Filter className="h-4 w-4" />
          </button>

          <Link
            href={`/${locale}/dashboard/courses/new`}
            className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-blue px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            <span>Yangi kurs</span>
          </Link>
        </div>
      </header>

      {loadError && (
        <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm text-red animate-in fade-in slide-in-from-top-2 duration-300">
          Kurslarni yuklab bo&apos;lmadi: {loadError}
        </div>
      )}

      <SubscriptionRestrictionBanner
        status={subscription?.status}
        locale={locale}
      />

      <div className="relative">
        {/* Subtle decorative aurora background */}
        <div className="pointer-events-none absolute -left-20 top-0 h-64 w-64 rounded-full bg-blue/5 blur-[100px]" />
        
        <CourseGrid courses={courses} locale={locale} />
      </div>
    </div>
  );
}
