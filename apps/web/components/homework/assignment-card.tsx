'use client';

import Link from 'next/link';

import type {
  Assignment,
  Submission,
  SubmissionStatus,
} from '../../lib/homework-api';
import { SubmissionStatusBadge } from './submission-status-badge';

/**
 * Compact assignment row used by the student `/assignments` list and
 * other "uy ishlari" surfaces (Task 25.4).
 *
 * Renders the title, owning lesson + due date, the current submission
 * status (or "Boshlanmagan") and a score chip when graded. The whole
 * row is a link to the assignment detail page so it can be tabbed into
 * with the keyboard.
 */
interface AssignmentCardProps {
  locale: string;
  assignment: Pick<
    Assignment,
    'id' | 'title' | 'dueAt' | 'totalPoints'
  >;
  /** Lesson title to show below the assignment title (optional). */
  lessonTitle?: string;
  submission: Pick<Submission, 'status' | 'score'> | null;
  /** Override the destination href; defaults to the student detail page. */
  href?: string;
}

export function AssignmentCard({
  locale,
  assignment,
  lessonTitle,
  submission,
  href,
}: AssignmentCardProps) {
  const target = href ?? `/${locale}/assignments/${assignment.id}`;
  const status: SubmissionStatus | null = submission?.status ?? null;

  return (
    <Link
      href={target}
      className="flex items-center justify-between gap-4 px-5 py-4 text-sm transition-colors hover:bg-white/[0.04]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-cream">
          {assignment.title}
        </p>
        <p className="mt-0.5 text-xs text-cream-dim">
          {lessonTitle ? `${lessonTitle} • ` : ''}
          {assignment.dueAt
            ? `Muddat: ${formatDate(assignment.dueAt)}`
            : "Muddat yo'q"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {status ? (
          <SubmissionStatusBadge status={status} />
        ) : (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            Boshlanmagan
          </span>
        )}
        {status === 'GRADED' && submission?.score !== null && submission?.score !== undefined ? (
          <span className="rounded-xl bg-accent2-500/15 px-2 py-0.5 text-xs font-bold text-accent2-500">
            {submission.score}/{assignment.totalPoints}
          </span>
        ) : null}
      </div>
    </Link>
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
