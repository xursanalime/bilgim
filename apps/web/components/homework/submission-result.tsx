'use client';

import { Award, CheckCircle2, MessageSquare, Sparkles } from 'lucide-react';

import type { FeedbackEntry, Submission } from '../../lib/api/homework';
import { cn } from '../../lib/utils';

/**
 * SubmissionResult — learner-facing score + structured feedback view
 * (frontend-redesign Task 6.4, Req 10.6).
 *
 * Shown once an Instructor has graded the learner's submission. Renders
 * the final score against the assignment total plus any teacher-authored
 * feedback comments.
 *
 * Backend assumption: `GET /submissions/:id` returns the finalized
 * `score` and `gradedAt`, but does NOT currently include the teacher's
 * `Feedback` rows in the payload (they are written as separate
 * `Feedback(authorType=TEACHER, isFinal=true)` records by
 * `POST /submissions/:id/grade`). This component therefore renders the
 * score immediately and renders structured comments only when the
 * submission carries an optional `feedback` array — so it lights up
 * automatically once the API includes feedback (or a dedicated
 * `GET /submissions/:id/feedback` endpoint) in the submission payload.
 */
export interface SubmissionResultProps {
  submission: Submission;
  totalPoints: number;
  /** Optional assignment title rendered above the score. */
  assignmentTitle?: string | undefined;
  className?: string | undefined;
}

export function SubmissionResult({
  submission,
  totalPoints,
  assignmentTitle,
  className,
}: SubmissionResultProps) {
  if (submission.status !== 'GRADED') {
    return null;
  }

  const score = submission.score ?? 0;
  const safeTotal = totalPoints > 0 ? totalPoints : 0;
  const percentage =
    safeTotal > 0 ? Math.round((score / safeTotal) * 100) : null;
  const comments = collectComments(submission.feedback);

  const tone = scoreTone(percentage);

  return (
    <section
      aria-label="Baholash natijasi"
      className={cn(
        'overflow-hidden rounded-3xl border border-rim bg-canvas shadow-soft',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-rim bg-tint/60 px-6 py-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-2xl',
              tone.iconWrap,
            )}
            aria-hidden="true"
          >
            <Award className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-faint">
              Topshiriq baholandi
            </p>
            <h3 className="truncate text-base font-bold text-ink-strong">
              {assignmentTitle ?? 'Sizning natijangiz'}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full bg-green-tint px-3 py-1 text-xs font-semibold text-green">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Baholandi
        </div>
      </header>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-[auto,1fr] sm:items-center">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-rim bg-tint/40 px-8 py-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-faint">
            Ball
          </p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className={cn('text-4xl font-black', tone.text)}>{score}</span>
            <span className="text-lg font-semibold text-ink-faint">
              /{safeTotal}
            </span>
          </p>
          {percentage !== null ? (
            <span
              className={cn(
                'mt-2 rounded-full px-2.5 py-0.5 text-xs font-bold',
                tone.badge,
              )}
            >
              {percentage}%
            </span>
          ) : null}
        </div>

        <div className="space-y-4">
          {safeTotal > 0 ? (
            <div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-soft"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={safeTotal}
                aria-valuenow={score}
              >
                <div
                  className={cn('h-full rounded-full transition-all', tone.bar)}
                  style={{
                    width: `${Math.min(100, Math.max(0, (score / safeTotal) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          {submission.gradedAt ? (
            <p className="text-xs text-ink-soft">
              Baholangan sana: {formatDateTime(submission.gradedAt)}
            </p>
          ) : null}

          {submission.aiFlagged ? (
            <div className="flex items-start gap-2 rounded-2xl border border-orange/20 bg-orange-tint px-3 py-2.5 text-xs text-orange">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Ushbu ish AI yordamida yozilgan boʻlishi mumkinligi belgilangan.
                Oʻqituvchingiz bilan bogʻlaning.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-rim px-6 py-5">
        <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-faint">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Oʻqituvchi izohi
        </p>
        {comments.length > 0 ? (
          <ul className="space-y-3">
            {comments.map((comment, index) => (
              <li
                key={index}
                className="rounded-2xl border border-rim bg-tint/40 p-4 text-sm leading-relaxed text-ink-strong"
              >
                {comment}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-rim bg-tint/30 p-4 text-sm text-ink-soft">
            Oʻqituvchi yozma izoh qoldirmagan.
          </p>
        )}
      </div>
    </section>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Pull the human-readable comment strings out of feedback entries. */
function collectComments(feedback: FeedbackEntry[] | undefined): string[] {
  if (!feedback || feedback.length === 0) return [];
  return feedback
    .map((entry) => entry.comment?.trim())
    .filter((comment): comment is string => Boolean(comment));
}

interface Tone {
  text: string;
  badge: string;
  bar: string;
  iconWrap: string;
}

function scoreTone(percentage: number | null): Tone {
  if (percentage === null) {
    return {
      text: 'text-ink-strong',
      badge: 'bg-soft text-ink-soft',
      bar: 'bg-blue',
      iconWrap: 'bg-blue-tint text-blue',
    };
  }
  if (percentage >= 70) {
    return {
      text: 'text-green',
      badge: 'bg-green-tint text-green',
      bar: 'bg-green',
      iconWrap: 'bg-green-tint text-green',
    };
  }
  if (percentage >= 40) {
    return {
      text: 'text-orange',
      badge: 'bg-orange-tint text-orange',
      bar: 'bg-orange',
      iconWrap: 'bg-orange-tint text-orange',
    };
  }
  return {
    text: 'text-red',
    badge: 'bg-red-tint text-red',
    bar: 'bg-red',
    iconWrap: 'bg-red-tint text-red',
  };
}

function formatDateTime(input: string): string {
  try {
    return new Date(input).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return input;
  }
}
