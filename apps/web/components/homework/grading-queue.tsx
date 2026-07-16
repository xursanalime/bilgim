'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  Sparkles,
  User,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type Submission,
  type SubmissionStatus,
} from '../../lib/api/homework';
import { EmptyState } from '../states/empty-state';
import { ErrorState } from '../states/error-state';
import { LoadingState } from '../states/loading-state';
import { Badge, type BadgeProps } from '../ui/badge';
import { cn } from '../../lib/utils';
import { homeworkQueryKeys } from './grading-query-keys';
import { SubmissionGradingPanel } from './submission-grading-panel';

interface GradingQueueProps {
  locale: string;
  assignmentId: string;
}

type StatusFilter = 'PENDING' | 'ALL' | SubmissionStatus;

interface StatusMeta {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
}

const STATUS_META: Record<SubmissionStatus, StatusMeta> = {
  DRAFT: { label: 'Qoralama', variant: 'neutral' },
  SUBMITTED: { label: 'Yuborildi', variant: 'orange' },
  IN_REVIEW: { label: 'Tekshirilmoqda', variant: 'blue' },
  GRADED: { label: 'Baholandi', variant: 'green' },
  RETURNED: { label: 'Qaytarildi', variant: 'red' },
};

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'PENDING', label: 'Kutilayotgan' },
  { value: 'ALL', label: 'Hammasi' },
  { value: 'SUBMITTED', label: 'Yuborilgan' },
  { value: 'IN_REVIEW', label: 'Tekshirilmoqda' },
  { value: 'GRADED', label: 'Baholangan' },
  { value: 'RETURNED', label: 'Qaytarilgan' },
];

/**
 * GradingQueue — teacher grading queue scoped to a single assignment
 * (frontend-redesign Task 6.4, Req 10.5).
 *
 * Lists every submission for the assignment, filterable by status, with
 * an AI-likelihood badge per row. Expanding a row reveals the inline
 * grading panel (AI-draft → adjust → finalize, plus return-to-student).
 * Grading mutations invalidate the submission list so rows + badges
 * refresh automatically.
 */
export function GradingQueue({ locale: _locale, assignmentId }: GradingQueueProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [aiOnly, setAiOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const assignmentQuery = useQuery({
    queryKey: homeworkQueryKeys.assignment(assignmentId),
    queryFn: () => homeworkApi.getAssignment(assignmentId),
  });

  const submissionsQuery = useQuery({
    queryKey: homeworkQueryKeys.assignmentSubmissions(assignmentId),
    queryFn: () => homeworkApi.listForAssignment(assignmentId),
  });

  const submissions = submissionsQuery.data ?? [];
  const totalPoints = assignmentQuery.data?.totalPoints ?? 0;

  const counts = useMemo(() => countByStatus(submissions), [submissions]);

  const filtered = useMemo(() => {
    let list = submissions;
    if (statusFilter === 'PENDING') {
      list = list.filter(
        (s) => s.status === 'SUBMITTED' || s.status === 'IN_REVIEW',
      );
    } else if (statusFilter !== 'ALL') {
      list = list.filter((s) => s.status === statusFilter);
    }
    if (aiOnly) {
      list = list.filter((s) => s.aiFlagged);
    }
    return [...list].sort(sortByPriority);
  }, [submissions, statusFilter, aiOnly]);

  if (submissionsQuery.isLoading || assignmentQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <LoadingState variant="list" count={4} label="Topshiriqlar yuklanmoqda" />
      </div>
    );
  }

  if (submissionsQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          title="Tekshirish navbatini yuklab boʻlmadi"
          message={
            submissionsQuery.error instanceof ApiClientError
              ? submissionsQuery.error.message
              : 'Kutilmagan xatolik yuz berdi.'
          }
          retryLabel="Qayta urinish"
          onRetry={() => void submissionsQuery.refetch()}
        />
      </div>
    );
  }

  const pendingCount = counts.SUBMITTED + counts.IN_REVIEW;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-blue">
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Tekshirish navbati
          </p>
          <h2 className="truncate text-2xl font-extrabold tracking-tight text-ink-strong">
            {assignmentQuery.data?.title ?? 'Topshiriq'}
          </h2>
          <p className="text-sm text-ink-soft">
            {submissions.length} ta topshiruv • {pendingCount} ta kutilmoqda
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Holat boʻyicha filtr"
          className="flex flex-wrap items-center gap-2"
        >
          {FILTERS.map((f) => {
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  'rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-[0.98]',
                  active
                    ? 'bg-blue text-white shadow-soft'
                    : 'border border-rim bg-canvas text-ink-soft hover:bg-tint hover:text-ink-strong',
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-rim bg-canvas px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft transition-colors hover:bg-tint">
          <input
            type="checkbox"
            checked={aiOnly}
            onChange={(e) => setAiOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-purple"
          />
          <Sparkles className="h-3.5 w-3.5 text-purple" aria-hidden="true" />
          AI belgilangan
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="Topshiriq topilmadi"
          description="Tanlangan filtrlar boʻyicha hech qanday topshiruv yoʻq."
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((submission) => (
            <SubmissionRow
              key={submission.id}
              submission={submission}
              assignmentId={assignmentId}
              totalPoints={totalPoints}
              expanded={expandedId === submission.id}
              onToggle={() =>
                setExpandedId((prev) =>
                  prev === submission.id ? null : submission.id,
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SubmissionRow({
  submission,
  assignmentId,
  totalPoints,
  expanded,
  onToggle,
}: {
  submission: Submission;
  assignmentId: string;
  totalPoints: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[submission.status];
  const studentName = submission.student?.user.fullName ?? 'Nomaʼlum talaba';
  const panelId = `grading-panel-${submission.id}`;

  return (
    <li className="overflow-hidden rounded-2xl border border-rim bg-canvas shadow-soft">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-tint/50"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rim bg-tint">
          {submission.student?.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={submission.student.user.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <User className="h-5 w-5 text-ink-faint" aria-hidden="true" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink-strong">
            {studentName}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {submission.submittedAt
              ? formatDateTime(submission.submittedAt)
              : 'Hali yuborilmagan'}
          </span>
        </span>

        <span className="flex flex-wrap items-center justify-end gap-2">
          {submission.aiFlagged || submission.aiLikelihood !== null ? (
            <Badge
              variant={submission.aiFlagged ? 'red' : 'purple'}
              size="sm"
              title="AI mualliflik ehtimoli"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI{' '}
              {submission.aiLikelihood !== null
                ? `${Math.round(submission.aiLikelihood * 100)}%`
                : 'belgilangan'}
            </Badge>
          ) : null}
          <Badge variant={meta.variant} size="sm">
            {meta.label}
          </Badge>
          {submission.status === 'GRADED' && submission.score !== null ? (
            <Badge variant="green" size="sm">
              {submission.score}/{totalPoints}
            </Badge>
          ) : null}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-ink-faint" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-ink-faint" aria-hidden="true" />
          )}
        </span>
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-rim p-4">
          {submission.status === 'DRAFT' ? (
            <p className="flex items-center gap-2 rounded-2xl border border-rim bg-tint/40 p-4 text-sm text-ink-soft">
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange" aria-hidden="true" />
              Talaba bu ishni hali topshirmagan, shuning uchun baholab boʻlmaydi.
            </p>
          ) : (
            <SubmissionGradingPanel
              submission={submission}
              assignmentId={assignmentId}
              totalPoints={totalPoints}
              onDone={onToggle}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

export function countByStatus(
  submissions: Submission[],
): Record<SubmissionStatus, number> {
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

function isPending(status: SubmissionStatus): boolean {
  return status === 'SUBMITTED' || status === 'IN_REVIEW';
}

/** Pending first, then AI-flagged, then most-recently submitted. */
function sortByPriority(a: Submission, b: Submission): number {
  const aPending = isPending(a.status) ? 0 : 1;
  const bPending = isPending(b.status) ? 0 : 1;
  if (aPending !== bPending) return aPending - bPending;
  if (a.aiFlagged !== b.aiFlagged) return a.aiFlagged ? -1 : 1;
  const at = Date.parse(a.submittedAt ?? a.updatedAt);
  const bt = Date.parse(b.submittedAt ?? b.updatedAt);
  return bt - at;
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
