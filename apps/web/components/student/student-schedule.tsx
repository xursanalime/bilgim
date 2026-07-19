'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { 
  Calendar, 
  Clock, 
  ArrowRight, 
  AlertCircle, 
  LayoutDashboard, 
  BookOpen, 
  ArrowUpRight,
  TrendingUp,
  History,
  Layers,
  Search
} from 'lucide-react';

import {
  studentApi,
  type ScheduleOccurrence,
  type StudentEnrollment,
} from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface StudentScheduleProps {
  locale: string;
}

interface CalendarEntry {
  groupId: string;
  groupName: string;
  occurrence: ScheduleOccurrence;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function StudentSchedule({ locale }: StudentScheduleProps) {
  const enrollmentsQuery = useQuery({
    queryKey: ['student', 'enrollments'],
    queryFn: () => studentApi.myEnrollments(),
  });

  const enrollments: StudentEnrollment[] = enrollmentsQuery.data ?? [];

  const groupQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['catalog', 'group', enr.groupId],
      queryFn: () => studentApi.getGroup(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  const scheduleQueries = useQueries({
    queries: enrollments.map((enr) => ({
      queryKey: ['schedule', enr.groupId],
      queryFn: () => studentApi.groupSchedule(enr.groupId),
      enabled: enrollments.length > 0,
    })),
  });

  const calendar = useMemo<CalendarEntry[]>(() => {
    const cutoff = Date.now() + FOURTEEN_DAYS_MS;
    const rows: CalendarEntry[] = [];
    enrollments.forEach((enr, idx) => {
      const groupName = groupQueries[idx]?.data?.name ?? '—';
      const upcoming = scheduleQueries[idx]?.data?.upcoming ?? [];
      for (const occ of upcoming) {
        const when = Date.parse(occ.startsAt);
        if (Number.isNaN(when)) continue;
        if (when > cutoff) continue;
        rows.push({ groupId: enr.groupId, groupName, occurrence: occ });
      }
    });
    rows.sort(
      (a, b) =>
        Date.parse(a.occurrence.startsAt) - Date.parse(b.occurrence.startsAt),
    );
    return rows;
  }, [enrollments, groupQueries, scheduleQueries]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, CalendarEntry[]>();
    for (const entry of calendar) {
      const dayKey = formatDayKey(entry.occurrence.startsAt);
      const list = buckets.get(dayKey) ?? [];
      list.push(entry);
      buckets.set(dayKey, list);
    }
    return Array.from(buckets.entries());
  }, [calendar]);

  if (enrollmentsQuery.isLoading) return <ScheduleSkeleton />;
  
  if (enrollmentsQuery.isError) {
    return (
      <ErrorBanner
        message={
          enrollmentsQuery.error instanceof ApiClientError
            ? enrollmentsQuery.error.message
            : "Jadvalni yuklab bo'lmadi."
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <Calendar className="h-3.5 w-3.5" />
              Oʻquv rejasi
            </div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl lg:text-5xl">
              Mening jadvalim
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
              Yaqin 14 kun ichidagi barcha guruhlar uchun belgilangan darslar va tadbirlar.
            </p>
          </div>

          {calendar.length > 0 && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/5 text-blue">
                <Clock className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Darslar soni</p>
                <p className="text-sm font-black text-ink-strong">{calendar.length} ta</p>
              </div>
            </div>
          )}
        </div>
      </header>

      {enrollments.length === 0 ? (
        <EmptyState
          title="Guruhlar mavjud emas"
          message="Siz hech qaysi guruhga yozilmagansiz. Kursga yozilgach, darslar jadvali shu yerda paydo bo'ladi."
          ctaHref={`/${locale}/search`}
          ctaLabel="Kurslarni qidirish"
          icon={BookOpen}
        />
      ) : grouped.length === 0 ? (
        <EmptyState
          title="Darslar topilmadi"
          message="Yaqin 14 kun ichida belgilangan dars yo'q. Dam oling yoki o'tilgan darslarni takrorlang!"
          ctaHref={`/${locale}/dashboard`}
          ctaLabel="Boshqaruvga qaytish"
          icon={History}
        />
      ) : (
        <div className="space-y-12">
          {grouped.map(([dayKey, entries]) => (
            <section key={dayKey} className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tint border border-rim">
                  <Calendar className="h-5 w-5 text-ink-soft" />
                </div>
                <h2 className="font-display text-lg font-extrabold text-ink-strong capitalize">
                  {formatDayHeader(dayKey)}
                </h2>
                <div className="h-px flex-1 bg-rim" />
              </div>

              <div className="grid gap-4">
                {entries.map((entry, idx) => (
                  <Link
                    key={`${entry.groupId}-${entry.occurrence.startsAt}-${idx}`}
                    href={`/${locale}/groups/${entry.groupId}`}
                    className="group relative flex items-center justify-between gap-6 rounded-[1.5rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                        <Layers className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-display text-base font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                          {entry.groupName}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs font-medium text-ink-faint">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{formatTimeRange(entry.occurrence.startsAt, entry.occurrence.endsAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {entry.occurrence.isException && (
                        <span className="rounded-full bg-orange-tint px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-orange border border-orange/10">
                          Istisno
                        </span>
                      )}
                      <ArrowUpRight className="h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-blue" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  message,
  ctaHref,
  ctaLabel,
  icon: Icon
}: {
  title: string;
  message: string;
  ctaHref: string;
  ctaLabel: string;
  icon: any;
}) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
      <div className="relative mb-6">
        <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue/10 text-blue shadow-sm">
          <Icon className="h-10 w-10" />
        </div>
      </div>
      <h2 className="font-display text-xl font-extrabold text-ink-strong">{title}</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{message}</p>
      <Link
        href={ctaHref}
        className="group mt-8 inline-flex items-center gap-2.5 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
      >
        <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1" />
        {ctaLabel}
      </Link>
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

function ScheduleSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="h-48 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim shadow-soft" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-3xl bg-white border border-rim shadow-soft" />
        ))}
      </div>
    </div>
  );
}

function formatDayKey(input: string): string {
  const d = new Date(input);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayHeader(key: string): string {
  const [y, m, d] = key.split('-').map((s) => Number(s));
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('uz-UZ', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const fmt = (d: Date) =>
    d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s)} – ${fmt(e)}`;
}

