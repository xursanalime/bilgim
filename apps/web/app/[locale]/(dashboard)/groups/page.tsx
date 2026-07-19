import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import {
  Users,
  LayoutDashboard,
  CreditCard,
  ChevronRight,
  Plus,
  BookOpen,
  Layers,
} from 'lucide-react';

import { requireRole } from '../../../../lib/server-auth';
import { serverApi, ServerApiError } from '../../../../lib/server-api';
import type { Course, Group } from '../../../../lib/api/catalog';

interface PageProps {
  params: { locale: string };
}

interface CourseWithGroups extends Course {
  groups: Group[];
}

function formatPrice(amount: number | null | undefined): string {
  if (amount == null) return 'Narx ko\u2018rsatilmagan';
  if (amount === 0) return 'Bepul';
  return new Intl.NumberFormat('uz-UZ').format(amount) + ' so\u2018m';
}

/**
 * Groups overview — flattens groups across all of a teacher's courses so
 * they can jump to any group without first picking a course.
 */
export default async function GroupsPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let courses: Course[] = [];
  let loadError: string | null = null;
  try {
    courses = await serverApi.get<Course[]>('/catalog/courses');
  } catch (err) {
    if (err instanceof ServerApiError) loadError = err.message;
    else throw err;
  }

  const coursesWithGroups: CourseWithGroups[] = await Promise.all(
    courses.map(async (course) => {
      try {
        const groups = await serverApi.get<Group[]>(
          `/catalog/courses/${course.id}/groups`,
        );
        return { ...course, groups };
      } catch (err) {
        if (err instanceof ServerApiError) return { ...course, groups: [] };
        throw err;
      }
    }),
  );

  const totalGroups = coursesWithGroups.reduce(
    (sum, c) => sum + c.groups.length,
    0,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      {/* Hero Header */}
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        {/* Aurora glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-purple/5 blur-[80px]" />

        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-purple">
              <Layers className="h-3.5 w-3.5" />
              Boshqaruv paneli
            </div>

            <div className="space-y-2">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                Guruhlar
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
                {totalGroups === 0
                  ? 'Hozircha hech qanday guruh mavjud emas. Kurs yarating va oʻquvchilarni guruhlarga jamlang.'
                  : `Jami ${totalGroups} ta faol guruh, ${coursesWithGroups.length} ta kurs doirasida boshqarilmoqda.`}
              </p>
            </div>
          </div>

          {coursesWithGroups.length > 0 && (
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue/5 text-blue">
                  <LayoutDashboard className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    Kurslar
                  </p>
                  <p className="text-sm font-black text-ink-strong">
                    {coursesWithGroups.length}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple/5 text-purple">
                  <Users className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    Guruhlar
                  </p>
                  <p className="text-sm font-black text-ink-strong">
                    {totalGroups}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {loadError && (
        <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
          {loadError}
        </div>
      )}

      {coursesWithGroups.length === 0 ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
          <div className="relative mb-6">
            <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue/10 text-blue shadow-sm">
              <BookOpen className="h-10 w-10" />
            </div>
          </div>
          <h2 className="font-display text-xl font-extrabold text-ink-strong">
            Kurslar topilmadi
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
            Guruhlar yaratishdan oldin, kamida bitta kurs tashkil qilishingiz
            kerak.
          </p>
          <Link
            href={`/${locale}/dashboard/courses/new`}
            className="group mt-8 inline-flex items-center gap-2.5 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Plus className="h-4.5 w-4.5 transition-transform group-hover:rotate-90" />
            Kurs yaratish
          </Link>
        </div>
      ) : (
        <div className="space-y-12">
          {coursesWithGroups.map((course) => (
            <section key={course.id} className="space-y-6">
              <div className="flex items-center justify-between border-b border-rim pb-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tint border border-rim">
                    <BookOpen className="h-5 w-5 text-ink-soft" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-extrabold text-ink-strong">
                      {course.title}
                    </h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                      {course.groups.length} ta faol guruh
                    </p>
                  </div>
                </div>
                <Link
                  href={`/${locale}/dashboard/courses/${course.id}/groups/new`}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-blue hover:text-blue-600"
                >
                  <Plus className="h-4 w-4" />
                  Guruh qoʻshish
                </Link>
              </div>

              {course.groups.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center rounded-[2rem] border border-dashed border-rim bg-tint/30 text-center">
                  <p className="text-sm font-medium text-ink-faint">
                    Bu kursda hali guruhlar yoʻq.
                  </p>
                  <Link
                    href={`/${locale}/dashboard/courses/${course.id}/groups/new`}
                    className="mt-2 text-xs font-bold text-blue hover:underline"
                  >
                    Birinchi guruhni yarating →
                  </Link>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {course.groups.map((group) => (
                    <Link
                      key={group.id}
                      href={`/${locale}/dashboard/courses/${course.id}/groups/${group.id}`}
                      className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] hover:border-blue/20"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                          <Users className="h-5.5 w-5.5" />
                        </div>
                        <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
                      </div>

                      <h3 className="mt-5 font-display text-lg font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                        {group.name}
                      </h3>

                      <div className="mt-6 flex flex-col gap-4 border-t border-rim pt-5">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                              <CreditCard className="h-3 w-3" />
                              Narxi
                            </span>
                            <p className="text-xs font-black text-ink-strong">
                              {formatPrice(group.priceUzs)}
                            </p>
                          </div>
                          {group.capacity != null && (
                            <div className="space-y-1 text-right">
                              <span className="flex items-center justify-end gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                                <Users className="h-3 w-3" />
                                Sigʻim
                              </span>
                              <p className="text-xs font-black text-ink-strong">
                                {group.capacity} talaba
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
