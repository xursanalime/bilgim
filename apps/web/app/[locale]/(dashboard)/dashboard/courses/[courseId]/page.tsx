import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft, Pencil, Plus, Users, Signal, LayoutDashboard, CreditCard, ChevronRight, BookOpen } from 'lucide-react';

import { requireRole } from '../../../../../../lib/server-auth';
import { serverApi, ServerApiError } from '../../../../../../lib/server-api';
import type { Course, Group } from '../../../../../../lib/api/catalog';
import { CoursePublishButton } from '../../../../../../components/dashboard/course-publish-button';

interface PageProps {
  params: { locale: string; courseId: string };
}

export default async function CourseDetailPage({
  params: { locale, courseId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let course: Course;
  let groups: Group[] = [];
  let groupsLoadError: string | null = null;
  try {
    course = await serverApi.get<Course>(`/catalog/courses/${courseId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  try {
    groups = await serverApi.get<Group[]>(`/catalog/courses/${courseId}/groups`);
  } catch (err) {
    if (!(err instanceof ServerApiError)) throw err;
    groupsLoadError = err.message;
  }

  const formatPriceLocal = (amount: number | null): string => {
    if (amount == null) return 'Narx ko\u2018rsatilmagan';
    if (amount === 0) return 'Bepul';
    return new Intl.NumberFormat('uz-UZ').format(amount) + ' so\u2018m';
  };

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      {/* Navigation */}
      <nav>
        <Link
          href={`/${locale}/dashboard/courses`}
          className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </div>
          Barcha kurslar
        </Link>
      </nav>

      {/* Hero Header */}
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        {/* Aurora glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-5">
            <div className="flex flex-wrap items-center gap-2.5">
              {course.isPublished ? (
                <span className="flex h-6 items-center rounded-full bg-green/5 px-3 text-[10px] font-bold uppercase tracking-wider text-green border border-green/10">
                  <Signal className="mr-1.5 h-3 w-3 animate-pulse" />
                  Nashrda
                </span>
              ) : (
                <span className="flex h-6 items-center rounded-full bg-tint px-3 text-[10px] font-bold uppercase tracking-wider text-ink-faint border border-rim">
                  Qoralama
                </span>
              )}
              {course.level && (
                <span className="flex h-6 items-center rounded-full bg-blue/5 px-3 text-[10px] font-bold uppercase tracking-wider text-blue border border-blue/10">
                  {course.level}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                {course.title}
              </h1>
              {course.description && (
                <p className="max-w-3xl text-base leading-relaxed text-ink-soft opacity-90">
                  {course.description}
                </p>
              )}
            </div>
            
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-2 text-sm font-bold text-ink-strong">
                <Users className="h-4 w-4 text-blue" />
                <span>0 talaba</span>
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-ink-strong">
                <LayoutDashboard className="h-4 w-4 text-purple" />
                <span>{groups.length} guruh</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/${locale}/dashboard/courses/${course.id}/edit`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rim bg-white px-5 text-sm font-bold text-ink-strong shadow-sm transition-all hover:bg-tint hover:border-blue/20 active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4" />
              Tahrirlash
            </Link>
            <CoursePublishButton
              courseId={course.id}
              isPublished={course.isPublished}
            />
          </div>
        </div>
      </header>

      {/* Groups Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">Guruhlar</h2>
            <p className="text-xs text-ink-faint font-medium uppercase tracking-wider">O'quv guruhlarini boshqarish</p>
          </div>
          <Link
            href={`/${locale}/dashboard/courses/${course.id}/groups/new`}
            className="group inline-flex items-center gap-2 rounded-2xl bg-blue px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            Yangi guruh
          </Link>
        </div>

        {groupsLoadError && (
          <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
            Guruhlarni yuklab bo'lmadi: {groupsLoadError}
          </div>
        )}

        {groups.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-rim bg-tint/30 p-12 text-center transition-colors hover:bg-tint/50">
            <div className="relative mb-6">
              <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-blue/10 text-blue shadow-sm">
                <Users className="h-8 w-8" />
              </div>
            </div>
            <h3 className="font-display text-lg font-extrabold text-ink-strong">
              {groupsLoadError ? 'Guruhlarni ko‘rsatib bo‘lmadi' : 'Guruhlar hali mavjud emas'}
            </h3>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
              {groupsLoadError
                ? 'Sahifani qayta yuklab ko‘ring yoki tizimga qayta kiring.'
                : 'Ushbu kurs uchun birinchi o\'quv guruhini yarating va talabalarni qabul qilishni boshlang.'}
            </p>
            <Link
              href={`/${locale}/dashboard/courses/${course.id}/groups/new`}
              className="mt-6 text-sm font-bold text-blue hover:underline"
            >
              Guruh yaratish →
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/${locale}/dashboard/courses/${course.id}/groups/${group.id}`}
                className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] hover:border-blue/20"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                    <Users className="h-5 w-5" />
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
                </div>
                
                <h3 className="mt-5 font-display text-lg font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                  {group.name}
                </h3>
                
                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-rim pt-5">
                  <div className="space-y-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                      <CreditCard className="h-3 w-3" />
                      Narxi
                    </span>
                    <p className="text-xs font-black text-ink-strong">
                      {formatPriceLocal(group.priceUzs)}
                    </p>
                  </div>
                  {group.capacity != null && (
                    <div className="space-y-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                        <Users className="h-3 w-3" />
                        Sig'im
                      </span>
                      <p className="text-xs font-black text-ink-strong">
                        {group.capacity} talaba
                      </p>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
