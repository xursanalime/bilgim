'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { 
  BarChart3, 
  ArrowLeft, 
  Filter, 
  Search, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  User,
  Layers,
  ChevronRight,
  ClipboardCheck,
  Zap
} from 'lucide-react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkFetchers,
  type AssignmentWithModules,
  type Submission,
  type SubmissionStatus,
} from '../../lib/homework-api';
import { coursesApi, groupsApi, lessonsApi } from '../../lib/api/catalog';
import { SubmissionStatusBadge } from './submission-status-badge';
import { cn } from '../../lib/utils';

interface TeacherGradingQueueProps {
  locale: string;
}

interface QueueRow {
  assignment: AssignmentWithModules;
  submission: Submission;
  groupName: string;
  courseTitle: string;
  lessonTitle: string;
}

export function TeacherGradingQueue({ locale }: TeacherGradingQueueProps) {
  const searchParams = useSearchParams();
  const assignmentFilter = searchParams.get('assignmentId');

  const [statusFilter, setStatusFilter] = useState<
    'PENDING' | 'ALL' | SubmissionStatus
  >('PENDING');
  const [aiOnly, setAiOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data, error, isLoading } = useSWR(
    'homework:grading-queue',
    fetchTeacherGradingQueue,
  );

  const filteredRows = useMemo(() => {
    let list = data ?? [];
    if (assignmentFilter) {
      list = list.filter((r) => r.assignment.id === assignmentFilter);
    }
    if (statusFilter === 'PENDING') {
      list = list.filter(
        (r) => r.submission.status === 'SUBMITTED' || r.submission.status === 'IN_REVIEW',
      );
    } else if (statusFilter !== 'ALL') {
      list = list.filter((r) => r.submission.status === statusFilter);
    }
    if (aiOnly) {
      list = list.filter((r) => r.submission.aiFlagged);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r => 
        r.submission.student?.user.fullName.toLowerCase().includes(q) ||
        r.assignment.title.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, assignmentFilter, statusFilter, aiOnly, searchQuery]);

  const counts = useMemo(() => countByStatus(data ?? []), [data]);

  if (isLoading) return <ListSkeleton />;
  if (error) {
    return (
      <ErrorBanner
        message={
          error instanceof ApiClientError
            ? error.message
            : "Tekshirish navbatini yuklab bo'lmadi."
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-purple/5 blur-[80px]" />
        
        <div className="relative z-10 space-y-6">
          <Link
            href={`/${locale}/homework`}
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-purple hover:text-purple-600 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Topshiriqlar boʻlimiga qaytish
          </Link>
          
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                Tekshirish navbati
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
                Talabalar tomonidan topshirilgan ishlarni koʻrib chiqing, baholang va qayta aloqa bildiring.
              </p>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/5 text-purple">
                  <ClipboardCheck className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Kutilmoqda</p>
                  <p className="text-sm font-black text-ink-strong">{counts.SUBMITTED + counts.IN_REVIEW} ta</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Yuborilgan" value={counts.SUBMITTED} highlight icon={Clock} color="orange" />
        <StatCard label="Tekshirilmoqda" value={counts.IN_REVIEW} icon={Zap} color="blue" />
        <StatCard label="Baholangan" value={counts.GRADED} icon={CheckCircle2} color="green" />
        <StatCard label="Qaytarilgan" value={counts.RETURNED} icon={XCircle} color="red" />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            label="Kutilayotgan"
            active={statusFilter === 'PENDING'}
            onClick={() => setStatusFilter('PENDING')}
          />
          <FilterChip
            label="Hammasi"
            active={statusFilter === 'ALL'}
            onClick={() => setStatusFilter('ALL')}
          />
          <FilterChip
            label="Baholangan"
            active={statusFilter === 'GRADED'}
            onClick={() => setStatusFilter('GRADED')}
          />
          <FilterChip
            label="Qaytarilgan"
            active={statusFilter === 'RETURNED'}
            onClick={() => setStatusFilter('RETURNED')}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              placeholder="Talaba yoki topshiriq..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-rim bg-white py-2 pl-9 pr-4 text-xs outline-none transition-all focus:border-blue/30 focus:ring-4 focus:ring-blue/5 sm:w-64"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-rim bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-soft shadow-sm transition-colors hover:bg-tint">
            <input
              type="checkbox"
              checked={aiOnly}
              onChange={(e) => setAiOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue"
            />
            AI-flaglar
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState
          title="Hozircha tekshirish uchun ish yo'q"
          body="Tanlangan filtrlar boʻyicha hech qanday topshiriq topilmadi."
        />
      ) : (
        <div className="grid gap-4">
          {filteredRows.map((row) => (
            <Link
              key={row.submission.id}
              href={`/${locale}/homework/grading/${row.submission.id}`}
              className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex items-start gap-4">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-tint border border-rim transition-colors group-hover:border-blue/20">
                  {row.submission.student?.user.avatarUrl ? (
                    <img src={row.submission.student.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-7 w-7 text-ink-faint" />
                  )}
                  <div className="absolute inset-0 bg-blue/5 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>

                <div className="min-w-0 space-y-1">
                  <h3 className="font-display text-base font-extrabold text-ink-strong group-hover:text-blue transition-colors">
                    {row.submission.student?.user.fullName || 'Nomaʼlum talaba'}
                  </h3>
                  <p className="truncate text-sm font-semibold text-ink-soft">
                    {row.assignment.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-faint">
                    <span className="flex items-center gap-1">
                      <Layers className="h-3 w-3" />
                      {row.groupName}
                    </span>
                    {row.submission.submittedAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(row.submission.submittedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-4 border-t border-rim pt-4 lg:mt-0 lg:border-0 lg:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  {row.submission.aiFlagged && (
                    <div className="flex items-center gap-1.5 rounded-full bg-orange-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-orange border border-orange/20">
                      <AlertTriangle className="h-3 w-3" />
                      AI {row.submission.aiLikelihood ? `${Math.round(row.submission.aiLikelihood * 100)}%` : 'Flag'}
                    </div>
                  )}
                  <SubmissionStatusBadge status={row.submission.status} />
                  {row.submission.status === 'GRADED' && row.submission.score !== null && (
                    <span className="rounded-xl bg-green-tint px-3 py-1 text-xs font-black text-green border border-green/20">
                      {row.submission.score}/{row.assignment.totalPoints}
                    </span>
                  )}
                </div>
                <ChevronRight className="h-5 w-5 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Data fetcher ────────────────────────────────────────────────────

async function fetchTeacherGradingQueue(): Promise<QueueRow[]> {
  const courses = await coursesApi.list();
  if (courses.length === 0) return [];

  const courseGroupPairs = await Promise.all(
    courses.map(async (course) => {
      const groups = await groupsApi
        .listForCourse(course.id)
        .catch(() => [] as Awaited<ReturnType<typeof groupsApi.listForCourse>>);
      return { course, groups };
    }),
  );

  const rows: QueueRow[] = [];
  await Promise.all(
    courseGroupPairs.flatMap(({ course, groups }) =>
      groups.map(async (group) => {
        const lessons = await lessonsApi
          .listForGroup(group.id)
          .catch(() => [] as Awaited<ReturnType<typeof lessonsApi.listForGroup>>);

        await Promise.all(
          lessons.map(async (lesson) => {
            const assignments = await homeworkFetchers
              .lessonAssignments(lesson.id)
              .catch(() => [] as AssignmentWithModules[]);

            await Promise.all(
              assignments.map(async (assignment) => {
                const submissions = await homeworkFetchers
                  .assignmentSubmissions(assignment.id)
                  .catch(() => [] as Submission[]);

                for (const submission of submissions) {
                  rows.push({
                    assignment,
                    submission,
                    groupName: group.name,
                    courseTitle: course.title,
                    lessonTitle: lesson.title,
                  });
                }
              }),
            );
          }),
        );
      }),
    ),
  );

  rows.sort((a, b) => {
    const aPending = isPending(a.submission.status) ? 0 : 1;
    const bPending = isPending(b.submission.status) ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    if (a.submission.aiFlagged !== b.submission.aiFlagged) {
      return a.submission.aiFlagged ? -1 : 1;
    }
    const at = Date.parse(a.submission.submittedAt ?? a.submission.updatedAt);
    const bt = Date.parse(b.submission.submittedAt ?? b.submission.updatedAt);
    return bt - at;
  });
  return rows;
}

function isPending(status: SubmissionStatus): boolean {
  return status === 'SUBMITTED' || status === 'IN_REVIEW';
}

function countByStatus(rows: QueueRow[]) {
  const acc: Record<SubmissionStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    IN_REVIEW: 0,
    GRADED: 0,
    RETURNED: 0,
  };
  for (const r of rows) acc[r.submission.status] += 1;
  return acc;
}

// ── Shared Components ───────────────────────────────────────────────

function StatCard({ label, value, highlight, icon: Icon, color }: { 
  label: string; 
  value: number; 
  highlight?: boolean; 
  icon: any; 
  color: 'blue' | 'purple' | 'green' | 'red' | 'orange' 
}) {
  const colorClasses = {
    blue: 'text-blue bg-blue/5 border-blue/20',
    purple: 'text-purple bg-purple/5 border-purple/20',
    green: 'text-green bg-green/5 border-green/20',
    red: 'text-red bg-red/5 border-red/20',
    orange: 'text-orange bg-orange/5 border-orange/20'
  };

  return (
    <div className={cn(
      "relative overflow-hidden rounded-[2rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-medium",
      highlight && "border-blue/20 bg-blue-tint/10"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl shadow-sm", colorClasses[color])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
            {label}
          </p>
          <p className={cn("text-xl font-black text-ink-strong")}>
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-4 py-2 text-xs font-bold transition-all active:scale-[0.98]",
        active
          ? "bg-blue text-white shadow-blue-soft shadow-lg"
          : "bg-white text-ink-soft border border-rim hover:bg-tint hover:text-ink-strong"
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
      <div className="relative mb-6">
        <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-blue/10 text-blue shadow-sm">
          <ClipboardCheck className="h-8 w-8" />
        </div>
      </div>
      <h2 className="font-display text-lg font-extrabold text-ink-strong">
        {title}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
        {body}
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        {message}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-10">
      <div className="h-48 w-full animate-pulse rounded-[2.5rem] bg-white border border-rim" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-[2rem] bg-white border border-rim" />
        ))}
      </div>
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-3xl bg-white border border-rim" />
        ))}
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

