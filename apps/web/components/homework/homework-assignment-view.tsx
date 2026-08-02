'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Headphones,
  Layers,
  ListChecks,
  Mic,
  PenLine,
  Rocket,
  SpellCheck,
  User,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { ApiClientError } from '../../lib/api-client';
import {
  homeworkFetchers,
  homeworkMutations,
  type AssignmentModule,
  type AssignmentWithModules,
  type HomeworkModuleType,
  type Submission,
} from '../../lib/homework-api';
import { MODULE_TYPE_LABELS, MODULE_TYPE_TONE } from './module-type-labels';
import { SubmissionStatusBadge } from './submission-status-badge';
import { AssignmentMaterials } from './assignment-materials';

interface HomeworkAssignmentViewProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  assignmentId: string;
}

const MODULE_TYPE_ICON: Partial<Record<HomeworkModuleType, LucideIcon>> = {
  WRITING: PenLine,
  READING: BookOpen,
  LISTENING: Headphones,
  SPEAKING: Mic,
  PRONUNCIATION: Mic,
  GRAMMAR: SpellCheck,
  SPELLING: SpellCheck,
  VOCABULARY: Layers,
  MULTIPLE_CHOICE: ListChecks,
  GAP_FILL: ListChecks,
  MATCHING: ListChecks,
  DRAG_DROP: ListChecks,
};

/**
 * `/[locale]/homework/[assignmentId]` (Task 25.4).
 *
 * Read-only assignment view that lists every module in order and links
 * to the submission form. Teachers see every submission for this
 * assignment inline, each linking straight into the grading view.
 */
export function HomeworkAssignmentView({
  locale,
  role,
  assignmentId,
}: HomeworkAssignmentViewProps) {
  const searchParams = useSearchParams();
  // Set by the lesson page when it links into one of its own assignments (or
  // into the "new assignment" builder pre-filled for that lesson) — without
  // it, "back" fell through to the global list and stranded the teacher
  // outside the course/group/lesson they started from.
  const returnTo = searchParams.get('returnTo');

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const assignmentSwr = useSWR(
    ['homework:assignment', assignmentId],
    () => homeworkFetchers.assignment(assignmentId),
  );

  async function handlePublish() {
    setPublishError(null);
    setIsPublishing(true);
    try {
      await homeworkMutations.publishAssignment(assignmentId);
      await assignmentSwr.mutate();
    } catch (err) {
      setPublishError(
        err instanceof ApiClientError
          ? err.message
          : "Nashr qilib bo'lmadi.",
      );
    } finally {
      setIsPublishing(false);
    }
  }

  const studentSubmissionSwr = useSWR(
    role === 'STUDENT'
      ? ['homework:my-submission', assignmentId]
      : null,
    () => homeworkFetchers.mySubmission(assignmentId),
  );

  const teacherSubmissionsSwr = useSWR(
    role === 'STUDENT'
      ? null
      : ['homework:assignment-submissions', assignmentId],
    () => homeworkFetchers.assignmentSubmissions(assignmentId),
  );

  if (assignmentSwr.isLoading) return <DetailSkeleton />;
  if (assignmentSwr.error || !assignmentSwr.data) {
    return (
      <ErrorBanner
        message={
          assignmentSwr.error instanceof ApiClientError
            ? assignmentSwr.error.message
            : "Topshiriqni yuklab bo'lmadi."
        }
      />
    );
  }

  const assignment: AssignmentWithModules = assignmentSwr.data;
  const orderedModules = [...assignment.modules].sort(
    (a, b) => a.order - b.order,
  );

  const studentSubmission: Submission | null | undefined =
    studentSubmissionSwr.data;
  const teacherSubmissions: Submission[] = teacherSubmissionsSwr.data ?? [];
  const counts = countByStatus(teacherSubmissions);
  const pendingCount = counts.SUBMITTED + counts.IN_REVIEW;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />

        <div className="relative z-10 space-y-6">
          <Link
            href={returnTo ?? `/${locale}/homework`}
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue transition-colors hover:text-blue-600"
          >
            <ArrowLeft className="h-3 w-3" />
            {returnTo ? 'Darsga qaytish' : 'Topshiriqlar boʻlimiga qaytish'}
          </Link>

          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                {assignment.title}
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
                {assignment.dueAt
                  ? `Muddat: ${formatDateTime(assignment.dueAt)}`
                  : "Muddat belgilanmagan"}
                {' • '}Maksimal ball: {assignment.totalPoints}
                {' • '}
                {orderedModules.length} ta modul
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {role === 'STUDENT' && studentSubmission ? (
                <>
                  <SubmissionStatusBadge status={studentSubmission.status} />
                  {studentSubmission.status === 'GRADED' &&
                  studentSubmission.score !== null ? (
                    <span className="rounded-xl border border-teal/20 bg-teal-tint px-3 py-1 text-sm font-black text-teal">
                      {studentSubmission.score}/{assignment.totalPoints}
                    </span>
                  ) : null}
                </>
              ) : null}

              {role !== 'STUDENT' ? (
                assignment.isPublished ? (
                  <span className="rounded-full border border-blue/20 bg-blue/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-blue">
                    E&apos;lon qilingan
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-orange/20 bg-orange/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-orange">
                        Qoralama — talabalarga ko&apos;rinmaydi
                      </span>
                      <button
                        type="button"
                        onClick={handlePublish}
                        disabled={isPublishing}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue px-4 py-2 text-xs font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        {isPublishing ? 'Nashr qilinmoqda…' : 'Nashr qilish'}
                      </button>
                    </div>
                    {publishError ? (
                      <span className="text-xs font-medium text-red">{publishError}</span>
                    ) : null}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {role !== 'STUDENT' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Yuborilgan" value={pendingCount} icon={Clock} color="orange" highlight />
          <StatCard label="Baholangan" value={counts.GRADED} icon={CheckCircle2} color="teal" />
          <StatCard label="Qaytarilgan" value={counts.RETURNED} icon={XCircle} color="red" />
          <StatCard label="Jami topshiruv" value={teacherSubmissions.length} icon={Users} color="blue" />
        </div>
      ) : null}

      {assignment.description ? (
        <article className="rounded-[2rem] border border-rim bg-white p-6 text-sm leading-relaxed text-ink-strong/90 shadow-soft sm:p-7">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            Topshiriq tavsifi
          </p>
          <p className="mt-2 whitespace-pre-wrap">{assignment.description}</p>
        </article>
      ) : null}

      <AssignmentMaterials
        assignmentId={assignment.id}
        editable={role !== 'STUDENT'}
        initialAttachments={assignment.attachments}
        initialDescription={assignment.description}
      />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-extrabold tracking-tight text-ink-strong">
          Modullar
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {orderedModules.map((module, idx) => (
            <ModuleCard key={module.id} module={module} index={idx + 1} />
          ))}
        </div>
      </section>

      {role !== 'STUDENT' ? (
        <TeacherSubmissionsSection
          locale={locale}
          assignmentId={assignment.id}
          submissions={teacherSubmissions}
          totalPoints={assignment.totalPoints}
          loading={teacherSubmissionsSwr.isLoading}
          error={teacherSubmissionsSwr.error}
        />
      ) : null}

      <ActionBar
        locale={locale}
        role={role}
        assignmentId={assignment.id}
        studentSubmission={studentSubmission}
      />
    </div>
  );
}

function ModuleCard({
  module,
  index,
}: {
  module: AssignmentModule;
  index: number;
}) {
  const Icon = MODULE_TYPE_ICON[module.type] ?? FileText;
  return (
    <div className="flex items-center gap-4 rounded-[1.75rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:shadow-medium">
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
          MODULE_TYPE_TONE[module.type] ?? 'bg-soft text-ink-soft',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-extrabold text-ink-strong">
          #{index} {MODULE_TYPE_LABELS[module.type] ?? module.type}
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">
          Vazn: {module.weight} • Tartib: {module.order + 1}
        </p>
      </div>
    </div>
  );
}

function TeacherSubmissionsSection({
  locale,
  assignmentId,
  submissions,
  totalPoints,
  loading,
  error,
}: {
  locale: string;
  assignmentId: string;
  submissions: Submission[];
  totalPoints: number;
  loading: boolean;
  error: unknown;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-extrabold tracking-tight text-ink-strong">
        Talabalar topshirgan ishlar
      </h2>

      {loading ? (
        <div className="h-32 animate-pulse rounded-[2rem] border border-rim bg-white shadow-soft" />
      ) : error ? (
        <div className="rounded-[2rem] border border-red/20 bg-red-tint p-4 text-sm text-red-600 shadow-soft">
          Topshirilgan ishlarni yuklab bo&apos;lmadi.
        </div>
      ) : submissions.length === 0 ? (
        <div className="rounded-[2rem] border border-rim bg-white p-6 text-center text-sm text-ink-soft shadow-soft">
          Hozircha topshirilgan ish yo&apos;q.
        </div>
      ) : (
        <div className="grid gap-3">
          {submissions.map((sub) => (
            <Link
              key={sub.id}
              href={`/${locale}/homework/${assignmentId}/submissions/${sub.id}`}
              className="group flex items-center justify-between gap-4 rounded-[1.75rem] border border-rim bg-white p-5 shadow-soft transition-all duration-300 hover:border-blue/20 hover:shadow-medium"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rim bg-tint transition-colors group-hover:border-blue/20">
                  {sub.student?.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sub.student.user.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-6 w-6 text-ink-faint" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-extrabold text-ink-strong transition-colors group-hover:text-blue">
                    {sub.student?.user.fullName || `Talaba: ${sub.studentId.slice(0, 8)}`}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-ink-faint">
                    {sub.submittedAt
                      ? `Yuborildi: ${formatDateTime(sub.submittedAt)}`
                      : sub.status === 'DRAFT'
                        ? 'Hali yuborilmagan'
                        : `So'ngi o'zgarish: ${formatDateTime(sub.updatedAt)}`}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {sub.aiFlagged ? (
                  <span className="rounded-full border border-orange/20 bg-orange-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-600">
                    AI{' '}
                    {sub.aiLikelihood !== null
                      ? `${Math.round(sub.aiLikelihood * 100)}%`
                      : 'flag'}
                  </span>
                ) : null}
                <SubmissionStatusBadge status={sub.status} />
                {sub.status === 'GRADED' && sub.score !== null ? (
                  <span className="rounded-xl border border-teal/20 bg-teal-tint px-2 py-0.5 text-xs font-black text-teal">
                    {sub.score}/{totalPoints}
                  </span>
                ) : null}
                <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-1 group-hover:text-blue" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function countByStatus(submissions: Submission[]) {
  const acc = { DRAFT: 0, SUBMITTED: 0, IN_REVIEW: 0, GRADED: 0, RETURNED: 0 };
  for (const s of submissions) acc[s.status] += 1;
  return acc;
}

function ActionBar({
  locale,
  role,
  assignmentId,
  studentSubmission,
}: {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  assignmentId: string;
  studentSubmission: Submission | null | undefined;
}) {
  if (role === 'STUDENT') {
    const editable =
      !studentSubmission ||
      studentSubmission.status === 'DRAFT' ||
      studentSubmission.status === 'RETURNED';
    return (
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-[2rem] border border-rim bg-white px-5 py-4 shadow-soft">
        {editable ? (
          <Link
            href={`/${locale}/homework/${assignmentId}/submit`}
            className="rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,113,227,0.6)] transition-colors hover:bg-blue-400"
          >
            {studentSubmission ? 'Davom ettirish' : 'Boshlash'}
          </Link>
        ) : (
          <Link
            href={`/${locale}/homework/${assignmentId}/submit`}
            className="rounded-2xl border border-rim bg-tint px-5 py-2.5 text-sm font-semibold text-ink-strong transition-colors hover:border-blue/40 hover:text-blue"
          >
            Topshirilgan ishni ko&apos;rish
          </Link>
        )}
      </div>
    );
  }

  // Teachers grade directly from the submission rows above — there is
  // no separate action needed here.
  return null;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm text-red-600">
        {message}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="h-48 animate-pulse rounded-[2.5rem] border border-rim bg-white shadow-soft" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-[2rem] border border-rim bg-white shadow-soft" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-[2rem] border border-rim bg-white shadow-soft" />
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

const STAT_CARD_COLORS = {
  orange: { bg: 'bg-orange/10', text: 'text-orange', border: 'border-orange/30' },
  teal: { bg: 'bg-teal/10', text: 'text-teal', border: 'border-teal/30' },
  red: { bg: 'bg-red/10', text: 'text-red', border: 'border-red/30' },
  blue: { bg: 'bg-blue/10', text: 'text-blue', border: 'border-blue/30' },
} satisfies Record<string, { bg: string; text: string; border: string }>;

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  highlight,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: keyof typeof STAT_CARD_COLORS;
  highlight?: boolean;
}) {
  const palette = STAT_CARD_COLORS[color];
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-soft',
        highlight ? palette.border : 'border-rim',
      )}
    >
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', palette.bg, palette.text)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</p>
        <p className="text-lg font-black text-ink-strong tabular-nums">{value}</p>
      </div>
    </div>
  );
}
