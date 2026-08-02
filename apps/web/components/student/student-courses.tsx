'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { 
  BookOpen, 
  Layers, 
  ArrowRight, 
  Plus, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  ArrowUpRight,
  AlertCircle,
  Search
} from 'lucide-react';

import { studentApi } from '../../lib/api/student';
import { enrollmentApi } from '../../lib/api/enrollment';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface StudentCoursesProps {
  locale: string;
}

export function StudentCourses({ locale }: StudentCoursesProps) {
  const enrollmentsQuery = useQuery({
    queryKey: ['student', 'enrollments'],
    queryFn: () => studentApi.myEnrollments(),
  });
  const requestsQuery = useQuery({
    queryKey: ['student', 'requests'],
    queryFn: () => enrollmentApi.myRequests(),
  });
  const enrollments = enrollmentsQuery.data ?? [];

  const pendingRequests = (requestsQuery.data ?? []).filter(
    (r) => r.status === 'PENDING_APPROVAL' || r.status === 'REJECTED',
  );

  const groupQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['catalog', 'group', enr.groupId],
      queryFn: () => studentApi.getGroup(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  const lessonQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['catalog', 'lessons', enr.groupId],
      queryFn: () => studentApi.listLessons(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  if (enrollmentsQuery.isLoading) return <Skeleton />;
  
  if (enrollmentsQuery.isError) {
    return (
      <ErrorBanner
        message={
          enrollmentsQuery.error instanceof ApiClientError
            ? enrollmentsQuery.error.message
            : "Kurslar ro'yxatini yuklab bo'lmadi."
        }
      />
    );
  }

  if (enrollments.length === 0 && pendingRequests.length === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-10">
        <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
          <div className="relative z-10 space-y-4">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
              Mening kurslarim
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80 sm:text-base">
              Hozirda siz hech qanday kursga yozilmagansiz. Bilim olishni hoziroq boshlang!
            </p>
          </div>
        </header>

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
            Hech qaysi guruhda ishtirok etmayapsiz. O'zingizga mos kursni qidirib ko'ring.
          </p>
          <Link
            href={`/${locale}/teacher-search`}
            className="group mt-8 inline-flex items-center gap-2.5 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            <Search className="h-4.5 w-4.5" />
            Kurslarni qidirish
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <Layers className="h-3.5 w-3.5" />
              Taʼlim jarayoni
            </div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
              Mening kurslarim
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
              Siz aʼzo boʻlgan barcha oʻquv guruhlari va kurslar roʻyxati.
            </p>
          </div>
          <Link
            href={`/${locale}/teacher-search`}
            className="group inline-flex items-center gap-2.5 rounded-2xl bg-blue/5 border border-blue/10 px-6 py-3 text-sm font-bold text-blue transition-all hover:bg-blue hover:text-white active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            Yangi kurs qoʻshish
          </Link>
        </div>
      </header>

      {enrollments.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {enrollments.map((enr, idx) => {
            const group = groupQueries[idx]?.data;
            const lessons = lessonQueries[idx]?.data ?? [];
            return (
              <Link
                key={enr.groupId}
                href={`/${locale}/groups/${enr.groupId}`}
                className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                
                <h3 className="mt-5 font-display text-lg font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                  {group?.name ?? '—'}
                </h3>
                
                <div className="mt-2 flex items-center gap-3">
                  <span className="flex items-center gap-1 text-xs font-bold text-ink-soft">
                    <Layers className="h-3.5 w-3.5 text-purple" />
                    {lessons.length} ta dars
                  </span>
                  <span className="h-1 w-1 rounded-full bg-rim" />
                  <span className="flex items-center gap-1 text-xs font-medium text-ink-faint">
                    <Clock className="h-3.5 w-3.5" />
                    {group?.startsOn ? new Date(group.startsOn).toLocaleDateString('uz-UZ') : 'Yaqinda'}
                  </span>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-rim pt-5">
                  <span className="inline-flex rounded-full bg-teal-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-teal border border-teal/10">
                    Faol
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-blue opacity-0 transition-opacity group-hover:opacity-100">
                    Kirish <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {pendingRequests.length > 0 && (
        <section className="space-y-6 pt-6">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-extrabold text-ink-strong uppercase tracking-wider">
              Suhbat va soʻrovlar
            </h2>
            <div className="h-px flex-1 bg-rim" />
          </div>
          
          <div className="grid gap-4">
            {pendingRequests.map((req) => (
              <PendingRequestRow key={req.id} groupId={req.groupId} status={req.status} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PendingRequestRow({
  groupId,
  status,
}: {
  groupId: string;
  status: string;
}) {
  const groupQuery = useQuery({
    queryKey: ['catalog', 'group', groupId],
    queryFn: () => studentApi.getGroup(groupId),
  });
  const isRejected = status === 'REJECTED';
  
  return (
    <div className="group relative flex items-center justify-between gap-6 rounded-[1.5rem] border border-rim bg-white p-5 shadow-soft transition-all hover:border-blue/10">
      <div className="flex items-center gap-4 min-w-0">
        <div className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
          isRejected ? "bg-red/5 text-red" : "bg-blue/5 text-blue"
        )}>
          {isRejected ? <XCircle className="h-5.5 w-5.5" /> : <Clock className="h-5.5 w-5.5 animate-pulse" />}
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-base font-extrabold text-ink-strong">
            {groupQuery.data?.name ?? '...'}
          </p>
          <p className="text-xs font-medium text-ink-faint">
            {isRejected ? "Afsuski, soʻrovingiz rad etildi." : "Oʻqituvchi tasdiqlashini kutilmoqda."}
          </p>
        </div>
      </div>
      
      <span className={cn(
        "shrink-0 rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-all",
        isRejected 
          ? "bg-red-tint text-red border-red/20 shadow-sm shadow-red/5" 
          : "bg-tint text-ink-soft border-rim shadow-sm"
      )}>
        {isRejected ? 'Rad etildi' : 'Kutilmoqda'}
      </span>
    </div>
  );
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

function Skeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <div className="h-48 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim shadow-soft" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-[2rem] bg-white border border-rim shadow-soft" />
        ))}
      </div>
    </div>
  );
}
