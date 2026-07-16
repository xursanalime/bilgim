'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AssignmentModule,
} from '../../lib/api/homework';
import { ModuleRenderer, MODULE_TYPE_LABELS } from './module-runtimes';
import { SubmissionStatusBadge } from './submission-status-badge';

interface TeacherSubmissionReviewProps {
  locale: string;
  assignmentId: string;
  submissionId: string;
}

/**
 * Teacher review page (`/[locale]/teacher/assignments/[id]/submissions/[submissionId]`).
 *
 * Lifecycle (Req 12.5, 12.7):
 *  - Renders every AssignmentModule in read-only mode populated with
 *    the student's answers.
 *  - Provides a grade form (score 0..totalPoints + feedback comment) →
 *    POST `/submissions/:id/grade`.
 *  - Provides a "Talabaga qaytarish" button → POST
 *    `/submissions/:id/return`.
 */
export function TeacherSubmissionReview({
  locale,
  assignmentId,
  submissionId,
}: TeacherSubmissionReviewProps) {
  const queryClient = useQueryClient();

  const assignmentQuery = useQuery({
    queryKey: ['homework', 'assignment', assignmentId],
    queryFn: () => homeworkApi.getAssignment(assignmentId),
  });

  const submissionQuery = useQuery({
    queryKey: ['homework', 'submission', submissionId],
    queryFn: () => homeworkApi.getSubmission(submissionId),
  });

  const assignment = assignmentQuery.data;
  const submission = submissionQuery.data;

  const [score, setScore] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [returnComment, setReturnComment] = useState('');

  // Hydrate the score field with the existing grade (if any) once the
  // submission row arrives.
  useEffect(() => {
    if (submission?.score !== null && submission?.score !== undefined) {
      setScore(String(submission.score));
    }
  }, [submission?.score]);

  const gradeMutation = useMutation({
    mutationFn: () => {
      const numericScore = Number(score);
      return homeworkApi.grade(submissionId, {
        score: numericScore,
        feedback: feedback.trim()
          ? [{ comment: feedback.trim() }]
          : undefined,
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['homework', 'submission', submissionId],
        updated,
      );
      queryClient.invalidateQueries({
        queryKey: ['homework', 'assignment', assignmentId, 'submissions'],
      });
    },
  });

  const returnMutation = useMutation({
    mutationFn: () =>
      homeworkApi.returnToStudent(submissionId, {
        ...(returnComment.trim() ? { comment: returnComment.trim() } : {}),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['homework', 'submission', submissionId],
        updated,
      );
      queryClient.invalidateQueries({
        queryKey: ['homework', 'assignment', assignmentId, 'submissions'],
      });
    },
  });

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

  if (assignmentQuery.isLoading || submissionQuery.isLoading) {
    return <ReviewSkeleton />;
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
  if (submissionQuery.isError || !submission) {
    return (
      <ErrorBanner
        message={
          submissionQuery.error instanceof ApiClientError
            ? submissionQuery.error.message
            : "Topshirilgan ishni yuklab bo'lmadi."
        }
      />
    );
  }

  const answers = (submission.answersJson ?? {}) as Record<string, unknown>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          href={`/${locale}/teacher/assignments/${assignmentId}/submissions`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          ← Topshirilgan ishlar
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
            {assignment.title}
          </h1>
          <p className="mt-1 text-sm text-cream-dim">
            Talaba: <span className="font-mono">{submission.studentId}</span>
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
          {assignment.modules.map((module) => (
            <ReadOnlyModuleSection
              key={module.id}
              module={module}
              answer={answers[module.id]}
            />
          ))}
        </div>

        <aside className="space-y-4">
          <GradeForm
            score={score}
            setScore={setScore}
            feedback={feedback}
            setFeedback={setFeedback}
            totalPoints={assignment.totalPoints}
            canGrade={canGrade}
            isGradeValid={isGradeValid}
            isPending={gradeMutation.isPending}
            error={gradeMutation.error}
            onGrade={() => gradeMutation.mutate()}
          />

          <ReturnForm
            comment={returnComment}
            setComment={setReturnComment}
            canReturn={canReturn}
            isPending={returnMutation.isPending}
            error={returnMutation.error}
            onReturn={() => returnMutation.mutate()}
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
  error: unknown;
  onGrade: () => void;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5">
      <h2 className="text-sm font-bold tracking-tight text-cream">
        Baholash
      </h2>
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
            {error instanceof ApiClientError
              ? error.message
              : "Bahoni saqlab bo'lmadi."}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onGrade}
          disabled={!canGrade || !isGradeValid || isPending}
          className="w-full rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-colors hover:bg-accent2-400 disabled:opacity-60"
        >
          {isPending ? 'Saqlanyapti...' : 'Saqlash'}
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
  error: unknown;
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
            {error instanceof ApiClientError
              ? error.message
              : "Qaytarib bo'lmadi."}
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
