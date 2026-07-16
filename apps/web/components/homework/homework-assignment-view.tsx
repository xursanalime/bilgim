'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { useContentProtection } from '../../hooks/use-content-protection';
import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AssignmentModule,
  type AssignmentWithModules,
  type Submission,
} from '../../lib/api/homework';
import { homeworkQueryKeys } from './grading-query-keys';
import { MODULE_TYPE_LABELS } from './module-runtimes';
import { SubmissionResult } from './submission-result';
import { SubmissionStatusBadge } from './submission-status-badge';

interface HomeworkAssignmentViewProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  assignmentId: string;
}

/**
 * `/[locale]/homework/[assignmentId]` (Task 25.4).
 *
 * Read-only assignment view that lists every module in order and links
 * to the submission form. Teachers also get a shortcut into the per-
 * assignment grading queue.
 */
export function HomeworkAssignmentView({
  locale,
  role,
  assignmentId,
}: HomeworkAssignmentViewProps) {
  useContentProtection();
  const assignmentSwr = useQuery({
    queryKey: homeworkQueryKeys.assignment(assignmentId),
    queryFn: () => homeworkApi.getAssignment(assignmentId),
  });

  const studentSubmissionSwr = useQuery({
    queryKey: homeworkQueryKeys.mySubmission(assignmentId),
    queryFn: () => homeworkApi.getMyForAssignment(assignmentId),
    enabled: role === 'STUDENT',
  });

  const teacherSubmissionsSwr = useQuery({
    queryKey: homeworkQueryKeys.assignmentSubmissions(assignmentId),
    queryFn: () => homeworkApi.listForAssignment(assignmentId),
    enabled: role !== 'STUDENT',
  });

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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/${locale}/homework`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          ← Topshiriqlar
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
            {assignment.title}
          </h1>
          <p className="mt-1 text-sm text-cream-dim">
            {assignment.dueAt
              ? `Muddat: ${formatDateTime(assignment.dueAt)}`
              : "Muddat yo'q"}
            {assignment.totalPoints
              ? ` • Maksimal ball: ${assignment.totalPoints}`
              : ''}
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
                <span className="rounded-xl bg-accent2-500/15 px-3 py-1 text-sm font-bold text-accent2-500">
                  {studentSubmission.score}/{assignment.totalPoints}
                </span>
              ) : null}
            </>
          ) : null}

          {role !== 'STUDENT' ? (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
              {teacherSubmissions.length} ta topshiruv
            </span>
          ) : null}

          {role !== 'STUDENT' && assignment.isPublished ? (
            <span className="rounded-full bg-accent2-500/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent2-500">
              E&apos;lon qilingan
            </span>
          ) : null}
        </div>
      </header>

      {role === 'STUDENT' &&
      studentSubmission &&
      studentSubmission.status === 'GRADED' ? (
        <SubmissionResult
          submission={studentSubmission}
          totalPoints={assignment.totalPoints}
          assignmentTitle={assignment.title}
        />
      ) : null}

      {assignment.description ? (
        <article className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5 text-sm leading-relaxed text-cream/90">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            Topshiriq tavsifi
          </p>
          <p className="mt-2 whitespace-pre-wrap">{assignment.description}</p>
        </article>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-bold tracking-tight text-cream">
          Modullar
        </h2>
        <ol className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-ink-surface">
          {orderedModules.map((module, idx) => (
            <ModuleRow key={module.id} module={module} index={idx + 1} />
          ))}
        </ol>
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

function ModuleRow({
  module,
  index,
}: {
  module: AssignmentModule;
  index: number;
}) {
  return (
    <li className="flex items-start gap-4 px-5 py-4 text-sm text-cream/90">
      <span className="font-mono text-[11px] text-cream-dim">#{index}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-cream">
          {MODULE_TYPE_LABELS[module.type] ?? module.type}
        </p>
        <p className="mt-0.5 text-xs text-cream-dim">
          Vazn: {module.weight} • Tartib: {module.order + 1}
        </p>
      </div>
      <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
        {module.type}
      </span>
    </li>
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
  const counts = countByStatus(submissions);
  const pending = counts.SUBMITTED + counts.IN_REVIEW;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold tracking-tight text-cream">
          Talabalar topshirgan ishlar
        </h2>
        <Link
          href={`/${locale}/homework/${assignmentId}/grading`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          Hammasi →
        </Link>
      </div>

      {loading ? (
        <div className="h-32 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          Topshirilgan ishlarni yuklab bo&apos;lmadi.
        </div>
      ) : submissions.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-ink-surface p-6 text-center text-sm text-cream-dim">
          Hozircha topshirilgan ish yo&apos;q.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <CountChip label="Yuborilgan" value={pending} highlight />
            <CountChip label="Baholangan" value={counts.GRADED} />
            <CountChip label="Qaytarilgan" value={counts.RETURNED} />
            <CountChip label="Qoralama" value={counts.DRAFT} />
          </div>
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-ink-surface">
            {submissions.map((sub) => (
              <li key={sub.id}>
                <Link
                  href={`/${locale}/homework/${assignmentId}/submissions/${sub.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-sm transition-colors hover:bg-white/[0.04]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-cream">
                      Talaba:{' '}
                      <span className="font-mono">
                        {sub.studentId.slice(0, 8)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-cream-dim">
                      {sub.submittedAt
                        ? `Yuborildi: ${formatDateTime(sub.submittedAt)}`
                        : sub.status === 'DRAFT'
                          ? 'Hali yuborilmagan'
                          : `So'ngi o'zgarish: ${formatDateTime(sub.updatedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {sub.aiFlagged ? (
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
                        AI{' '}
                        {sub.aiLikelihood !== null
                          ? `${Math.round(sub.aiLikelihood * 100)}%`
                          : 'flag'}
                      </span>
                    ) : null}
                    <SubmissionStatusBadge status={sub.status} />
                    {sub.status === 'GRADED' && sub.score !== null ? (
                      <span className="rounded-xl bg-accent2-500/15 px-2 py-0.5 text-xs font-bold text-accent2-500">
                        {sub.score}/{totalPoints}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function countByStatus(submissions: Submission[]) {
  const acc = { DRAFT: 0, SUBMITTED: 0, IN_REVIEW: 0, GRADED: 0, RETURNED: 0 };
  for (const s of submissions) acc[s.status] += 1;
  return acc;
}

function CountChip({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <span
      className={`rounded-xl border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
        highlight
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-white/[0.06] bg-white/[0.04] text-cream-dim'
      }`}
    >
      {label}: {value}
    </span>
  );
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
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-white/[0.07] bg-ink-surface px-5 py-4">
        {editable ? (
          <Link
            href={`/${locale}/homework/${assignmentId}/submit`}
            className="rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-colors hover:bg-accent2-400"
          >
            {studentSubmission ? 'Davom ettirish' : 'Boshlash'}
          </Link>
        ) : (
          <Link
            href={`/${locale}/homework/${assignmentId}/submit`}
            className="rounded-2xl border border-white/[0.07] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:text-accent2-500"
          >
            Topshirilgan ishni ko&apos;rish
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-white/[0.07] bg-ink-surface px-5 py-4">
      <Link
        href={`/${locale}/homework/${assignmentId}/grading`}
        className="rounded-2xl border border-white/[0.07] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:text-accent2-500"
      >
        Tekshirish navbatida ko&apos;rish
      </Link>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        {message}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="h-40 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
      <div className="h-64 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
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
