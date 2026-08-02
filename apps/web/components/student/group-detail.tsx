'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { 
  BookOpen, 
  Clock, 
  Layers, 
  Calendar, 
  ArrowLeft, 
  ChevronRight, 
  CheckCircle2, 
  Info,
  ShieldCheck,
  AlertCircle,
  PlayCircle,
  Users
} from 'lucide-react';

import { studentApi, type LessonSummary } from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface GroupDetailProps {
  locale: string;
  groupId: string;
}

export function GroupDetail({ locale, groupId }: GroupDetailProps) {
  const groupQuery = useQuery({
    queryKey: ['catalog', 'group', groupId],
    queryFn: () => studentApi.getGroup(groupId),
  });

  const lessonsQuery = useQuery({
    queryKey: ['catalog', 'lessons', groupId],
    queryFn: () => studentApi.listLessons(groupId),
  });

  const scheduleQuery = useQuery({
    queryKey: ['schedule', groupId],
    queryFn: () => studentApi.groupSchedule(groupId),
  });

  const enrollmentsQuery = useQuery({
    queryKey: ['student', 'enrollments'],
    queryFn: () => studentApi.myEnrollments(),
  });

  const myEnrollment = useMemo(
    () => enrollmentsQuery.data?.find((e) => e.groupId === groupId) ?? null,
    [enrollmentsQuery.data, groupId],
  );

  if (groupQuery.isLoading) return <DetailSkeleton />;
  if (groupQuery.isError) {
    return (
      <ErrorBanner
        message={
          groupQuery.error instanceof ApiClientError
            ? groupQuery.error.message
            : 'Guruhni yuklashda xato yuz berdi.'
        }
      />
    );
  }
  if (!groupQuery.data) return null;

  const group = groupQuery.data;
  const lessons = lessonsQuery.data ?? [];
  const schedule = scheduleQuery.data;

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      {/* Navigation & Header */}
      <div className="space-y-6">
        <Link
          href={`/${locale}/dashboard`}
          className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </div>
          Boshqaruvga qaytish
        </Link>

        <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
          
          <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
                <Layers className="h-3.5 w-3.5" />
                Guruh tafsilotlari
              </div>

              <div className="space-y-2">
                <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
                  {group.name}
                </h1>
                <p className="flex items-center gap-2 text-sm font-medium text-ink-soft opacity-80">
                  <span className="rounded-full bg-blue/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue">
                    {group.status}
                  </span>
                  <span className="h-1 w-1 rounded-full bg-rim" />
                  <span>{lessons.length} ta dars eʼlon qilingan</span>
                </p>
              </div>
            </div>

            {myEnrollment && (
              <div className="flex items-center gap-3 rounded-2xl bg-teal/5 border border-teal/10 p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal text-white shadow-teal-soft">
                  <CheckCircle2 className="h-5.5 w-5.5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-teal/60">Aʼzolik holati</p>
                  <p className="text-sm font-black text-ink-strong">
                    {myEnrollment.status === 'APPROVED' ? 'Tasdiqlangan' : myEnrollment.status}
                  </p>
                </div>
              </div>
            )}
          </div>
        </header>
      </div>

      <div className="grid gap-10 lg:grid-cols-3">
        {/* Lessons List */}
        <section className="space-y-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-extrabold text-ink-strong">Darslar roʻyxati</h2>
            <div className="h-px flex-1 bg-rim" />
          </div>

          {lessonsQuery.isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-3xl bg-white border border-rim" />
              ))}
            </div>
          ) : lessons.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-tint text-ink-faint">
                <BookOpen className="h-8 w-8 opacity-20" />
              </div>
              <p className="text-sm font-medium text-ink-faint">
                Hali oʻqituvchi tomonidan darslar eʼlon qilinmagan.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {lessons
                .slice()
                .sort(byPositionThenScheduled)
                .map((lesson) => (
                  <Link
                    key={lesson.id}
                    href={`/${locale}/lessons/${lesson.id}`}
                    className="group relative flex items-center justify-between gap-6 rounded-[2rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                        <PlayCircle className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-base font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                          {lesson.title}
                        </h3>
                        <div className="mt-1 flex items-center gap-3 text-xs font-medium text-ink-faint">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {lesson.scheduledAt ? formatDateTime(lesson.scheduledAt) : 'Belgilanmagan'}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-rim" />
                          <span className="font-bold text-blue uppercase tracking-widest text-[9px]">{lesson.type}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
                  </Link>
                ))}
            </div>
          )}
        </section>

        {/* Schedule Sidebar */}
        <aside className="space-y-10">
          <section className="space-y-6">
            <h2 className="font-display text-xl font-extrabold text-ink-strong">Dars jadvali</h2>
            
            <div className="overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-soft p-6 space-y-6">
              {scheduleQuery.isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-12 animate-pulse rounded-2xl bg-tint" />
                  ))}
                </div>
              ) : !schedule || !schedule.schedule ? (
                <div className="py-6 text-center space-y-2">
                  <Calendar className="mx-auto h-8 w-8 text-ink-faint opacity-20" />
                  <p className="text-sm font-medium text-ink-faint">Jadval oʻrnatilmagan.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 rounded-2xl bg-blue/5 p-4 border border-blue/10">
                    <Clock className="h-5 w-5 text-blue" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-blue/60">Davomiyligi</p>
                      <p className="text-sm font-black text-ink-strong">{schedule.schedule.durationMin} daqiqa</p>
                    </div>
                  </div>

                  {schedule.upcoming?.length ? (
                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-faint px-1">Yaqindagi darslar</p>
                      <ul className="space-y-2">
                        {schedule.upcoming.slice(0, 5).map((occ) => (
                          <li
                            key={`${occ.startsAt}-${occ.endsAt}`}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-rim px-4 py-3 text-xs font-bold text-ink-strong bg-tint/20"
                          >
                            <span>{formatDateTime(occ.startsAt)}</span>
                            {occ.isException && (
                              <span className="rounded-full bg-orange-tint px-2 py-0.5 text-[8px] font-black uppercase tracking-tight text-orange border border-orange/10">
                                istisno
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="py-4 text-center text-xs font-medium text-ink-faint italic">Yaqin dars rejasi yoʻq.</p>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="font-display text-xl font-extrabold text-ink-strong">Guruh aʼzolari</h2>
            <div className="rounded-[2.5rem] border border-rim bg-white p-6 shadow-soft">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/5 text-purple">
                  <Users className="h-5.5 w-5.5" />
                </div>
                <p className="text-sm font-bold text-ink-strong">Maxfiylik himoyalangan</p>
              </div>
              <p className="text-xs leading-relaxed text-ink-soft opacity-80">
                Aʼzolar roʻyxati faqat oʻqituvchi tomonidan boshqariladi. Shaxsiy maʼlumotlar xavfsizligi taʼminlangan.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function byPositionThenScheduled(a: LessonSummary, b: LessonSummary): number {
  if (a.position !== b.position) return a.position - b.position;
  const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : 0;
  const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : 0;
  return ta - tb;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
        <AlertCircle className="h-5 w-5 shrink-0" />
        {message}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <div className="h-48 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim shadow-soft" />
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="h-96 animate-pulse rounded-[2rem] bg-white border border-rim shadow-soft lg:col-span-2" />
        <div className="h-96 animate-pulse rounded-[2rem] bg-white border border-rim shadow-soft" />
      </div>
    </div>
  );
}

function formatDateTime(input: string): string {
  try {
    return new Date(input).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return input;
  }
}
