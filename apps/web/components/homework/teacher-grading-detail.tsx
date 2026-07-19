'use client';

import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkFetchers,
  homeworkMutations,
  type AssignmentModule,
  type FeedbackEntry,
} from '../../lib/homework-api';
import { ModuleRenderer, MODULE_TYPE_LABELS } from './module-runtimes';
import { SubmissionStatusBadge } from './submission-status-badge';
import { AiGradingPanel } from '../ai/ai-grading-panel';

interface TeacherGradingDetailProps {
  locale: string;
  submissionId: string;
  /** Optional — when present, the back-link routes to the assignment detail. */
  assignmentId?: string | undefined;
}

/**
 * `/[locale]/homework/grading/[submissionId]` and
 * `/[locale]/homework/[assignmentId]/submissions/[submissionId]` —
 * teacher grading view (Task 25.4, Req 12.5).
 *
 * Renders the assignment modules in read-only mode populated with the
 * student's answers and exposes the grading + return controls. The
 * student sees the same component in `editable=false` mode whenever
 * they navigate to a graded / returned submission directly.
 *
 * Network layer: SWR keys mirror `homeworkFetchers` so `homework-api`
 * remains the single source of truth for cache identity.
 */
export function TeacherGradingDetail({
  locale,
  submissionId,
  assignmentId,
}: TeacherGradingDetailProps) {
  const { mutate } = useSWRConfig();

  const submissionSwr = useSWR(
    ['homework:submission', submissionId],
    () => homeworkFetchers.submission(submissionId),
  );

  const submission = submissionSwr.data;
  const effectiveAssignmentId = assignmentId ?? submission?.assignmentId;

  const assignmentSwr = useSWR(
    effectiveAssignmentId ? ['homework:assignment', effectiveAssignmentId] : null,
    () => homeworkFetchers.assignment(effectiveAssignmentId as string),
  );
  const assignment = assignmentSwr.data;

  const [score, setScore] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [returnComment, setReturnComment] = useState('');
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [isReturning, setIsReturning] = useState(false);

  // Hydrate the score field with the existing grade (if any) once the
  // submission row arrives.
  useEffect(() => {
    if (
      submission &&
      submission.score !== null &&
      submission.score !== undefined
    ) {
      setScore(String(submission.score));
    }
  }, [submission?.score, submission]);

  const canGrade = useMemo(() => {
    if (!submission) return false;
    return (
      submission.status === 'SUBMITTED' || submission.status === 'IN_REVIEW'
    );
  }, [submission]);

  const canReturn = useMemo(() => {
    if (!submission) return false;
    return (
      submission.status === 'IN_REVIEW' || submission.status === 'GRADED'
    );
  }, [submission]);

  const isGradeValid = useMemo(() => {
    if (!assignment) return false;
    const n = Number(score);
    if (!Number.isFinite(n)) return false;
    if (!Number.isInteger(n)) return false;
    return n >= 0 && n <= assignment.totalPoints;
  }, [assignment, score]);

  async function handleGrade() {
    if (!canGrade || !isGradeValid) return;
    setGradeError(null);
    setIsGrading(true);
    try {
      const numericScore = Number(score);
      const payload: { score: number; feedback?: FeedbackEntry[] } = {
        score: numericScore,
      };
      if (feedback.trim()) {
        payload.feedback = [{ comment: feedback.trim() }];
      }
      const updated = await homeworkMutations.grade(submissionId, payload);
      submissionSwr.mutate(updated, false);
      // Invalidate any list-level caches that reference this submission.
      void mutate(['homework:assignment-submissions', updated.assignmentId]);
      void mutate('homework:grading-queue');
    } catch (err) {
      setGradeError(
        err instanceof ApiClientError
          ? err.message
          : "Bahoni saqlab bo'lmadi.",
      );
    } finally {
      setIsGrading(false);
    }
  }

  async function handleReturn() {
    if (!canReturn) return;
    setReturnError(null);
    setIsReturning(true);
    try {
      const updated = await homeworkMutations.returnToStudent(
        submissionId,
        returnComment.trim()
          ? { comment: returnComment.trim() }
          : {},
      );
      submissionSwr.mutate(updated, false);
      void mutate(['homework:assignment-submissions', updated.assignmentId]);
      void mutate('homework:grading-queue');
    } catch (err) {
      setReturnError(
        err instanceof ApiClientError
          ? err.message
          : "Talabaga qaytarib bo'lmadi.",
      );
    } finally {
      setIsReturning(false);
    }
  }

  if (submissionSwr.isLoading || assignmentSwr.isLoading) {
    return <ReviewSkeleton />;
  }
  if (submissionSwr.error || !submission) {
    return (
      <ErrorBanner
        message={
          submissionSwr.error instanceof ApiClientError
            ? submissionSwr.error.message
            : "Topshirilgan ishni yuklab bo'lmadi."
        }
      />
    );
  }
  if (assignmentSwr.error || !assignment) {
    return (
      <ErrorBanner
        message={
          assignmentSwr.error instanceof ApiClientError
            ? assignmentSwr.error.message
            : "Bu topshiriq topilmadi."
        }
      />
    );
  }

  const answers = (submission.answersJson ?? {}) as Record<string, unknown>;
  const orderedModules = [...assignment.modules].sort(
    (a, b) => a.order - b.order,
  );
  const backHref = assignmentId
    ? `/${locale}/homework/${assignmentId}`
    : `/${locale}/homework/grading`;
  const backLabel = assignmentId
    ? '← Topshiriqqa qaytish'
    : '← Tekshirish navbati';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          href={backHref}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          {backLabel}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
            {assignment.title}
          </h1>
          <p className="mt-1 text-sm text-cream-dim">
            Talaba:{' '}
            <span className="font-mono">{submission.studentId}</span>
            {submission.submittedAt
              ? ` • Yuborildi: ${formatDateTime(submission.submittedAt)}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {submission.aiFlagged ? (
            <AiFlagPill likelihood={submission.aiLikelihood} />
          ) : null}
          <SubmissionStatusBadge status={submission.status} />
          {submission.status === 'GRADED' && submission.score !== null ? (
            <span className="rounded-xl bg-accent2-500/15 px-3 py-1 text-sm font-bold text-accent2-500">
              {submission.score}/{assignment.totalPoints}
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {orderedModules.map((module) => (
            <ReadOnlyModuleSection
              key={module.id}
              module={module}
              answer={answers[module.id]}
            />
          ))}
        </div>

        <aside className="space-y-4">
          {/* AI Grading Panel */}
          {canGrade && (() => {
            const submissionText = orderedModules
              .map((mod) => {
                const ans = answers[mod.id];
                if (!ans) return '';
                if (typeof ans === 'string') return ans;
                if (typeof ans === 'object' && ans !== null) {
                  const writing = (ans as any).text ?? (ans as any).content ?? '';
                  const responses = (ans as any).responses;
                  if (responses && typeof responses === 'object') {
                    return Object.values(responses)
                      .map((r: any) => r?.value ?? '')
                      .join('\n');
                  }
                  return writing;
                }
                return '';
              })
              .filter(Boolean)
              .join('\n\n');

            if (!submissionText.trim()) return null;

            return (
              <AiGradingPanel
                submissionId={submissionId}
                submissionText={submissionText}
                totalPoints={assignment.totalPoints}
                onApplyScore={(aiScore, aiFeedback) => {
                  setScore(String(aiScore));
                  if (aiFeedback && !feedback.trim()) setFeedback(aiFeedback);
                }}
              />
            );
          })()}

          <GradeForm
            score={score}
            setScore={setScore}
            feedback={feedback}
            setFeedback={setFeedback}
            totalPoints={assignment.totalPoints}
            canGrade={canGrade}
            isGradeValid={isGradeValid}
            isPending={isGrading}
            error={gradeError}
            onGrade={handleGrade}
          />

          <ReturnForm
            comment={returnComment}
            setComment={setReturnComment}
            canReturn={canReturn}
            isPending={isReturning}
            error={returnError}
            onReturn={handleReturn}
          />
        </aside>
      </div>
    </div>
  );
}

function ReadOnlyModuleSection({
  module,
  answer,
}: {
  module: AssignmentModule;
  answer: unknown;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
          {MODULE_TYPE_LABELS[module.type] ?? module.type}
        </span>
        <span className="font-mono text-[10px] text-cream-dim">
          #{module.order + 1}
        </span>
      </div>
      <ModuleRenderer
        module={module}
        initialAnswer={answer ?? null}
        editable={false}
        onChange={() => undefined}
      />
    </section>
  );
}

function GradeForm({
  score,
  setScore,
  feedback,
  setFeedback,
  totalPoints,
  canGrade,
  isGradeValid,
  isPending,
  error,
  onGrade,
}: {
  score: string;
  setScore: (v: string) => void;
  feedback: string;
  setFeedback: (v: string) => void;
  totalPoints: number;
  canGrade: boolean;
  isGradeValid: boolean;
  isPending: boolean;
  error: string | null;
  onGrade: () => void;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5">
      <h2 className="text-sm font-bold tracking-tight text-cream">Baholash</h2>
      <p className="mt-1 text-xs text-cream-dim">
        Maksimal: {totalPoints} ball
      </p>

      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream-dim">
            Baho
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={totalPoints}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            disabled={!canGrade}
            placeholder={`0-${totalPoints}`}
            className="w-full rounded-2xl border border-ink-line bg-white/[0.04] px-4 py-2.5 text-sm text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="space-y-1">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream-dim">
            Izoh
          </label>
          <textarea
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={!canGrade}
            placeholder="Talabaga qisqa fikr-mulohaza..."
            className="w-full rounded-2xl border border-ink-line bg-white/[0.04] px-4 py-3 text-sm text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onGrade}
          disabled={!canGrade || !isGradeValid || isPending}
          className="w-full rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-colors hover:bg-accent2-400 disabled:opacity-60"
        >
          {isPending ? 'Saqlanyapti...' : 'Baho qo\u2018yish'}
        </button>
        {!canGrade ? (
          <p className="text-xs text-cream-dim">
            Bu holatda baho qo&apos;yib bo&apos;lmaydi. (Faqat YUBORILDI yoki
            TEKSHIRILMOQDA holatida ruxsat etilgan.)
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ReturnForm({
  comment,
  setComment,
  canReturn,
  isPending,
  error,
  onReturn,
}: {
  comment: string;
  setComment: (v: string) => void;
  canReturn: boolean;
  isPending: boolean;
  error: string | null;
  onReturn: () => void;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5">
      <h2 className="text-sm font-bold tracking-tight text-cream">
        Talabaga qaytarish
      </h2>
      <p className="mt-1 text-xs text-cream-dim">
        Talabadan qayta ishlashni so&apos;rang.
      </p>

      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream-dim">
            Izoh
          </label>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={!canReturn}
            placeholder="Nimani tuzatish kerakligini yozing..."
            className="w-full rounded-2xl border border-ink-line bg-white/[0.04] px-4 py-3 text-sm text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onReturn}
          disabled={!canReturn || isPending}
          className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:text-accent2-500 disabled:opacity-60"
        >
          {isPending ? 'Yuborilmoqda...' : 'Talabaga qaytarish'}
        </button>
      </div>
    </section>
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
    <div className="mx-auto max-w-6xl">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        {message}
      </div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-96 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface lg:col-span-2" />
        <div className="h-96 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
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
