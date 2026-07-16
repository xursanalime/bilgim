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
import { InviteManager } from '../../../../../../../../components/teacher/invite-manager';
import { ScheduleEditor } from '../../../../../../../../components/teacher/schedule-editor';

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
      <header className="group relative rounded-[2.5rem] border border-rim/50 bg-white/60 p-8 shadow-xl backdrop-blur-xl sm:p-10 lg:p-12">
        {/* Isolated background layer for clipped auroras */}
        <div className="absolute inset-0 overflow-hidden rounded-[2.5rem] pointer-events-none">
          <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-gradient-to-br from-purple/20 to-blue/20 blur-[80px]" />
          <div className="absolute -left-20 -bottom-20 h-96 w-96 rounded-full bg-gradient-to-tr from-pink/10 to-orange/10 blur-[80px]" />
        </div>
        
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
            
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-4">
              <div className="flex flex-col gap-3 rounded-2xl bg-white/60 p-4 border border-white shadow-sm backdrop-blur-md transition-all hover:bg-white/80 hover:scale-[1.02]">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/10 text-blue shadow-inner">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Narxi</p>
                  <p className="text-sm font-black text-ink-strong">{formatPriceLocal(group.priceUzs)}</p>
                </div>
              </div>

              {group.capacity != null && (
                <div className="flex flex-col gap-3 rounded-2xl bg-white/60 p-4 border border-white shadow-sm backdrop-blur-md transition-all hover:bg-white/80 hover:scale-[1.02]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10 text-teal shadow-inner">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Sig'im</p>
                    <p className="text-sm font-black text-ink-strong">{group.capacity} talaba</p>
                  </div>
                </div>
              )}

              {group.startsOn && (
                <div className="flex flex-col gap-3 rounded-2xl bg-white/60 p-4 border border-white shadow-sm backdrop-blur-md transition-all hover:bg-white/80 hover:scale-[1.02]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange/10 text-orange shadow-inner">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Boshlanish</p>
                    <p className="text-sm font-black text-ink-strong">{new Date(group.startsOn).toLocaleDateString('uz-UZ')}</p>
                  </div>
                </div>
              )}

              {group.joinCode && (
                <div className="flex flex-col gap-3 rounded-2xl bg-white/60 p-4 border border-white shadow-sm backdrop-blur-md transition-all hover:bg-white/80 hover:scale-[1.02]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/10 text-purple shadow-inner">
                    <LinkIcon className="h-5 w-5" />
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
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/settings/modules`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/60 bg-white/80 px-5 text-sm font-bold text-ink-strong shadow-sm backdrop-blur-md transition-all hover:bg-white hover:scale-[1.02] active:scale-[0.98]"
            >
              <Layers className="h-4 w-4 text-purple" />
              Modullar
            </Link>
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/edit`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/60 bg-white/80 px-5 text-sm font-bold text-ink-strong shadow-sm backdrop-blur-md transition-all hover:bg-white hover:scale-[1.02] active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4 text-blue" />
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
            className="group inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue to-purple px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:shadow-[0_8px_25px_-6px_rgba(0,113,227,0.7)] hover:-translate-y-0.5 active:scale-[0.98]"
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
                  <li key={lesson.id} className="transition-all duration-300 hover:bg-gradient-to-r hover:from-blue/5 hover:to-transparent">
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

      {/* Recurring schedule (RRULE) */}
      <section className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">
            Dars jadvali
          </h2>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Takroriy jadval, vaqt mintaqasi va bekor qilingan darslar
          </p>
        </div>
        <ScheduleEditor groupId={groupId} groupStartsOn={group.startsOn} />
      </section>

      {/* Invitations & join code */}
      <section className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">
            Takliflar va qoʻshilish
          </h2>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Havola va kod orqali oʻquvchilarni guruhga taklif qiling
          </p>
        </div>
        <InviteManager groupId={groupId} joinCode={group.joinCode ?? null} />
      </section>
    </div>
  );
}
