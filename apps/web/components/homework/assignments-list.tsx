'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { 
  ClipboardList, 
  BookOpen, 
  Layers, 
  Clock, 
  ChevronRight, 
  Search,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

import { ApiClientError } from '../../lib/api-client';
import {
  studentApi,
  type LessonSummary,
} from '../../lib/api/student';
import {
  homeworkApi,
  type AssignmentWithModules,
  type Submission,
} from '../../lib/api/homework';
import { SubmissionStatusBadge } from './submission-status-badge';
import { cn } from '../../lib/utils';

interface AssignmentsListProps {
  locale: string;
}

interface AssignmentRow {
  groupId: string;
  groupName: string;
  lesson: LessonSummary;
  assignment: AssignmentWithModules;
  submission: Submission | null;
}

export function AssignmentsList({ locale }: AssignmentsListProps) {
  const enrollmentsQuery = useQuery({
    queryKey: ['student', 'enrollments'],
    queryFn: () => studentApi.myEnrollments(),
  });

  const enrollments = enrollmentsQuery.data ?? [];

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

  const lessonsWithGroup = useMemo(() => {
    const rows: { groupId: string; groupName: string; lesson: LessonSummary }[] =
      [];
    enrollments.forEach((enr, idx) => {
      const groupName = groupQueries[idx]?.data?.name ?? '—';
      const lessons = lessonQueries[idx]?.data ?? [];
      for (const lesson of lessons) {
        rows.push({ groupId: enr.groupId, groupName, lesson });
      }
    });
    return rows;
  }, [enrollments, groupQueries, lessonQueries]);

  const assignmentQueries = useQueries({
    queries: lessonsWithGroup.map(({ lesson }) => ({
      queryKey: ['homework', 'lesson', lesson.id, 'assignments'],
      queryFn: () => homeworkApi.listForLesson(lesson.id),
      enabled: lessonsWithGroup.length > 0,
    })),
  });

  const flatAssignments = useMemo(() => {
    const rows: {
      groupId: string;
      groupName: string;
      lesson: LessonSummary;
      assignment: AssignmentWithModules;
    }[] = [];
    lessonsWithGroup.forEach((row, idx) => {
      const ass = assignmentQueries[idx]?.data ?? [];
      for (const assignment of ass) {
        if (!assignment.isPublished) continue;
        rows.push({ ...row, assignment });
      }
    });
    return rows;
  }, [lessonsWithGroup, assignmentQueries]);

  const submissionQueries = useQueries({
    queries: flatAssignments.map(({ assignment }) => ({
      queryKey: ['homework', 'submission', 'me', assignment.id],
      queryFn: () => homeworkApi.getMyForAssignment(assignment.id),
      enabled: flatAssignments.length > 0,
    })),
  });

  const rows = useMemo<AssignmentRow[]>(() => {
    return flatAssignments.map((row, idx) => ({
      ...row,
      submission: submissionQueries[idx]?.data ?? null,
    }));
  }, [flatAssignments, submissionQueries]);

  const grouped = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    for (const row of rows) {
      const key = row.groupName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ta = a.assignment.dueAt
          ? Date.parse(a.assignment.dueAt)
          : Number.POSITIVE_INFINITY;
        const tb = b.assignment.dueAt
          ? Date.parse(b.assignment.dueAt)
          : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
    }
    return Array.from(map.entries());
  }, [rows]);

  if (enrollmentsQuery.isLoading) {
    return <ListSkeleton />;
  }
  if (enrollmentsQuery.isError) {
    return (
      <ErrorBanner
        message={
          enrollmentsQuery.error instanceof ApiClientError
            ? enrollmentsQuery.error.message
            : "Ma'lumotlarni yuklashda xato yuz berdi."
        }
      />
    );
  }

  const pendingCount = rows.filter(r => !r.submission || r.submission.status === 'DRAFT' || r.submission.status === 'RETURNED').length;

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      <HeroHeader 
        title="Topshiriqlar" 
        subtitle="Guruhlaringizdagi barcha uy vazifalari va ularning holati." 
        icon={ClipboardList}
        color="blue"
        badge={pendingCount > 0 ? { label: 'Bajarilmagan', value: `${pendingCount} ta` } : undefined}
      />

      {enrollments.length === 0 ? (
        <EmptyState
          title="Topshiriqlar yo'q"
          body="Siz hech qaysi guruhga yozilmagansiz. Kursga yozilgach, topshiriqlar shu yerda paydo bo'ladi."
          ctaHref={`/${locale}/teacher-search`}
          ctaLabel="Kurslarni qidirish"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Hozircha topshiriq yo'q"
          body="O'qituvchingiz topshiriq e'lon qilganda u shu yerda paydo bo'ladi."
        />
      ) : (
        <div className="space-y-12">
          {grouped.map(([groupName, items]) => (
            <section key={groupName} className="space-y-6">
              <div className="flex items-center gap-3 border-b border-rim pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/5 text-purple">
                  <Layers className="h-5 w-5" />
                </div>
                <h2 className="font-display text-lg font-extrabold text-ink-strong">{groupName}</h2>
              </div>
              
              <div className="grid gap-4">
                {items.map((row) => (
                  <Link
                    key={row.assignment.id}
                    href={`/${locale}/assignments/${row.assignment.id}`}
                    className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-4 sm:items-center">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue/5 text-blue transition-colors group-hover:bg-blue group-hover:text-white">
                        <BookOpen className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                          {row.assignment.title}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-faint">
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {row.lesson.title}
                          </span>
                          {row.assignment.dueAt && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Muddat: {formatDate(row.assignment.dueAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-4 border-t border-rim pt-4 sm:mt-0 sm:border-0 sm:pt-0">
                      <div className="flex items-center gap-3">
                        {row.submission ? (
                          <SubmissionStatusBadge status={row.submission.status} />
                        ) : (
                          <span className="rounded-full bg-tint px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft border border-rim">
                            Boshlanmagan
                          </span>
                        )}
                        {row.submission?.status === 'GRADED' && row.submission.score !== null ? (
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-black text-green">
                              {row.submission.score}/{row.assignment.totalPoints}
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-tight text-ink-faint">Ball</span>
                          </div>
                        ) : null}
                      </div>
                      <ChevronRight className="h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
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

function HeroHeader({ 
  title, 
  subtitle, 
  icon: Icon, 
  color = 'blue',
  badge 
}: { 
  title: string; 
  subtitle: string; 
  icon: any; 
  color?: 'blue' | 'purple' | 'green';
  badge?: { label: string; value: string } | undefined;
}) {
  return (
    <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
      <div className={cn(
        "pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full blur-[80px]",
        color === 'blue' ? 'bg-blue/5' : color === 'purple' ? 'bg-purple/5' : 'bg-green/5'
      )} />
      
      <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1 space-y-4">
          <div className={cn("flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em]", color === 'blue' ? 'text-blue' : color === 'purple' ? 'text-purple' : 'text-green')}>
            <Icon className="h-3.5 w-3.5" />
            Taʼlim jarayoni
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
              {title}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
              {subtitle}
            </p>
          </div>
        </div>

        {badge && (
          <div className="flex items-center gap-2.5 pt-2">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", color === 'blue' ? 'bg-blue/5 text-blue' : color === 'purple' ? 'bg-purple/5 text-purple' : 'bg-green/5 text-green')}>
              <Icon className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{badge.label}</p>
              <p className="text-sm font-black text-ink-strong">{badge.value}</p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function EmptyState({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
      <div className="relative mb-6">
        <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue/10 text-blue shadow-sm">
          <ClipboardList className="h-10 w-10" />
        </div>
      </div>
      <h2 className="font-display text-xl font-extrabold text-ink-strong">
        {title}
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        {body}
      </p>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="group mt-8 inline-flex items-center gap-2.5 rounded-2xl bg-blue px-8 py-3.5 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          {ctaLabel}
        </Link>
      )}
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

function ListSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <div className="h-48 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-3xl bg-white border border-rim" />
        ))}
      </div>
    </div>
  );
}

function formatDate(input: string): string {
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
