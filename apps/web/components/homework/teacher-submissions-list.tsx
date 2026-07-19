'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type Submission,
  type SubmissionStatus,
} from '../../lib/api/homework';
import { SubmissionStatusBadge } from './submission-status-badge';

interface TeacherSubmissionsListProps {
  locale: string;
  assignmentId: string;
}

/**
 * Teacher submissions list (`/[locale]/teacher/assignments/[id]/submissions`).
 *
 * Lists every student submission for the assignment along with their
 * status, score (when graded), and AI flag indicator. Clicking a row
 * navigates to the detailed review page.
 */
export function TeacherSubmissionsList({
  locale,
  assignmentId,
}: TeacherSubmissionsListProps) {
  const assignmentQuery = useQuery({
    queryKey: ['homework', 'assignment', assignmentId],
    queryFn: () => homeworkApi.getAssignment(assignmentId),
  });

  const submissionsQuery = useQuery({
    queryKey: ['homework', 'assignment', assignmentId, 'submissions'],
    queryFn: () => homeworkApi.listForAssignment(assignmentId),
  });

  const assignment = assignmentQuery.data;
  const submissions = submissionsQuery.data ?? [];

  if (assignmentQuery.isLoading || submissionsQuery.isLoading) {
    return <ListSkeleton />;
  }

  if (assignmentQuery.isError || !assignment) {
    return (
      <ErrorBanner
        message={
          assignmentQuery.error instanceof ApiClientError
            ? assignmentQuery.error.message
            : "Topshiriqni yuklab bo'lmadi."
        }
      />
    );
  }
  if (submissionsQuery.isError) {
    return (
      <ErrorBanner
        message={
          submissionsQuery.error instanceof ApiClientError
            ? submissionsQuery.error.message
            : "Topshirilgan ishlarni yuklab bo'lmadi."
        }
      />
    );
  }

  const counts = countByStatus(submissions);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link
          href={`/${locale}/dashboard`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          ← Boshqaruv
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
          {assignment.title}
        </h1>
        <p className="mt-1 text-sm text-cream-dim">
          {submissions.length} ta talaba ishi
          {counts.SUBMITTED > 0
            ? ` • ${counts.SUBMITTED} ta tekshirish kutmoqda`
            : ''}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Qoralama" value={counts.DRAFT} />
        <StatCard label="Yuborilgan" value={counts.SUBMITTED} highlight />
        <StatCard label="Tekshirilmoqda" value={counts.IN_REVIEW} />
        <StatCard label="Baholangan" value={counts.GRADED} />
        <StatCard label="Qaytarilgan" value={counts.RETURNED} />
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-ink-surface p-8 text-center text-sm text-cream-dim">
          Hozircha hech kim topshirmagan.
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-ink-surface">
          {submissions.map((sub) => (
            <li key={sub.id}>
              <Link
                href={`/${locale}/teacher/assignments/${assignmentId}/submissions/${sub.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 text-sm transition-colors hover:bg-white/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-cream">
                    Talaba: <span className="font-mono">{sub.studentId.slice(0, 8)}</span>
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
                  {sub.aiFlagged ? <AiFlagPill likelihood={sub.aiLikelihood} /> : null}
                  <SubmissionStatusBadge status={sub.status} />
                  {sub.status === 'GRADED' && sub.score !== null ? (
                    <span className="rounded-xl bg-accent2-500/15 px-2 py-0.5 text-xs font-bold text-accent2-500">
                      {sub.score}/{assignment.totalPoints}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function countByStatus(submissions: Submission[]): Record<SubmissionStatus, number> {
  const acc: Record<SubmissionStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    IN_REVIEW: 0,
    GRADED: 0,
    RETURNED: 0,
  };
  for (const s of submissions) acc[s.status] += 1;
  return acc;
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight
          ? 'border-accent2-500/30 bg-accent2-500/10'
          : 'border-white/[0.07] bg-ink-surface'
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-extrabold ${
          highlight ? 'text-accent2-500' : 'text-cream'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function AiFlagPill({ likelihood }: { likelihood: number | null }) {
  const pct = likelihood !== null ? Math.round(likelihood * 100) : null;
  return (
    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
      AI {pct !== null ? `${pct}%` : 'flag'}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        {message}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="h-8 w-1/3 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="h-32 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
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
