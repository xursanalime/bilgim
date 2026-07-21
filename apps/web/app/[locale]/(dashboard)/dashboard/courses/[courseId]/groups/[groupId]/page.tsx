import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { 
  ArrowLeft, 
  Pencil, 
  Plus, 
  Calendar, 
  Users, 
  CreditCard, 
  Layers, 
  ChevronRight, 
  PlayCircle,
  Link as LinkIcon
} from 'lucide-react';

import { requireRole } from '../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../lib/server-api';
import type { Course, Group, Lesson } from '../../../../../../../../lib/api/catalog';
import { LessonRow } from '../../../../../../../../components/dashboard/lesson-row';
import { InviteLinkButton } from '../../../../../../../../components/dashboard/invite-link-button';

interface PageProps {
  params: { locale: string; courseId: string; groupId: string };
}

export default async function GroupDetailPage({
  params: { locale, courseId, groupId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let course: Course;
  let group: Group;
  let lessons: Lesson[] = [];

  try {
    [course, group] = await Promise.all([
      serverApi.get<Course>(`/catalog/courses/${courseId}`),
      serverApi.get<Group>(`/catalog/groups/${groupId}`),
    ]);
  } catch (err) {
    if (err instanceof ServerApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  try {
    lessons = await serverApi.get<Lesson[]>(
      `/catalog/groups/${groupId}/lessons`,
    );
  } catch (err) {
    if (!(err instanceof ServerApiError)) throw err;
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
          href={`/${locale}/dashboard/courses/${courseId}`}
          className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </div>
          {course.title}
        </Link>
      </nav>

      {/* Hero Header */}
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        {/* Aurora glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-purple/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-5">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-purple">
              <Layers className="h-3" />
              Guruh tafsilotlari
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                {group.name}
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80 italic">
                Ushbu guruhdagi barcha darslar va talabalar faoliyatini boshqaring.
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-y-4 gap-x-8 pt-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue/5 text-blue">
                  <CreditCard className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Narxi</p>
                  <p className="text-sm font-black text-ink-strong">{formatPriceLocal(group.priceUzs)}</p>
                </div>
              </div>

              {group.capacity != null && (
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green/5 text-green">
                    <Users className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Sig'im</p>
                    <p className="text-sm font-black text-ink-strong">{group.capacity} talaba</p>
                  </div>
                </div>
              )}

              {group.startsOn && (
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange/5 text-orange">
                    <Calendar className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Boshlanish</p>
                    <p className="text-sm font-black text-ink-strong">{new Date(group.startsOn).toLocaleDateString('uz-UZ')}</p>
                  </div>
                </div>
              )}

              {group.joinCode && (
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue/5 text-blue">
                    <LinkIcon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Guruh kodi</p>
                    <p className="text-sm font-black text-ink-strong tracking-widest uppercase">{group.joinCode}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <InviteLinkButton groupId={groupId} />
            
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/settings/modules`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rim bg-white px-5 text-sm font-bold text-ink-strong shadow-sm transition-all hover:bg-tint hover:border-blue/20 active:scale-[0.98]"
            >
              <Layers className="h-4 w-4 text-purple" />
              Modullar
            </Link>
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/edit`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rim bg-white px-5 text-sm font-bold text-ink-strong shadow-sm transition-all hover:bg-tint hover:border-blue/20 active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4" />
              Tahrirlash
            </Link>
          </div>
        </div>
      </header>

      {/* Lessons Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">Darslar</h2>
            <p className="text-xs text-ink-faint font-medium uppercase tracking-wider">{lessons.length} ta dars mavjud</p>
          </div>
          <Link
            href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/new`}
            className="group inline-flex items-center gap-2 rounded-2xl bg-blue px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            Yangi dars
          </Link>
        </div>

        {lessons.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-rim bg-tint/30 p-12 text-center transition-colors hover:bg-tint/50">
            <div className="relative mb-6">
              <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-blue/10 text-blue shadow-sm">
                <PlayCircle className="h-8 w-8" />
              </div>
            </div>
            <h3 className="font-display text-lg font-extrabold text-ink-strong">
              Darslar hali yuklanmagan
            </h3>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
              Ushbu guruh uchun birinchi darsni qo'shing va o'quv jarayonini boshlang.
            </p>
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/new`}
              className="mt-6 text-sm font-bold text-blue hover:underline"
            >
              Dars yaratish →
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[2rem] border border-rim bg-white shadow-soft">
            <ul className="divide-y divide-rim">
              {lessons
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((lesson) => (
                  <li key={lesson.id} className="transition-colors hover:bg-tint/30">
                    <LessonRow
                      lesson={lesson}
                      locale={locale}
                      courseId={courseId}
                      groupId={groupId}
                    />
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
