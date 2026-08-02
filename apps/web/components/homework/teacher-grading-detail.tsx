'use client';

import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  FileText,
  Headphones,
  Layers,
  ListChecks,
  Mic,
  PenLine,
  RotateCcw,
  SpellCheck,
  User,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { ApiClientError } from '../../lib/api-client';
import {
  homeworkFetchers,
  homeworkMutations,
  type AssignmentModule,
  type FeedbackEntry,
  type HomeworkModuleType,
} from '../../lib/homework-api';
import { ModuleRenderer } from './module-runtimes';
import { MODULE_TYPE_LABELS, MODULE_TYPE_TONE } from './module-type-labels';
import { SubmissionStatusBadge } from './submission-status-badge';
import { AiGradingPanel } from '../ai/ai-grading-panel';
import { AI_ENABLED } from '../../lib/features';

interface TeacherGradingDetailProps {
  locale: string;
  submissionId: string;
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

  const assignmentSwr = useSWR(
    ['homework:assignment', assignmentId],
    () => homeworkFetchers.assignment(assignmentId),
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
      submission.status === 'SUBMITTED' ||
      submission.status === 'IN_REVIEW' ||
      submission.status === 'GRADED'
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
  const backHref = `/${locale}/homework/${assignmentId}`;
  const backLabel = 'Topshiriqqa qaytish';

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />

        <div className="relative z-10 space-y-6">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue transition-colors hover:text-blue-600"
          >
            <ArrowLeft className="h-3 w-3" />
            {backLabel}
          </Link>

          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rim bg-tint">
                {submission.student?.user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={submission.student.user.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-7 w-7 text-ink-faint" />
                )}
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                  {submission.student?.user.fullName ||
                    `Talaba: ${submission.studentId.slice(0, 8)}`}
                </h1>
                <p className="mt-1 truncate text-sm font-semibold text-ink-soft">
                  {assignment.title}
                </p>
                {submission.submittedAt ? (
                  <p className="mt-0.5 text-xs font-medium text-ink-faint">
                    Yuborildi: {formatDateTime(submission.submittedAt)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {submission.aiFlagged ? (
                <AiFlagPill likelihood={submission.aiLikelihood} />
              ) : null}
              <SubmissionStatusBadge status={submission.status} />
              {submission.status === 'GRADED' && submission.score !== null ? (
                <span className="rounded-xl border border-teal/20 bg-teal-tint px-3 py-1 text-sm font-black text-teal">
                  {submission.score}/{assignment.totalPoints}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
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

            // AI is out of the MVP; the grading panel goes with it.
            if (!AI_ENABLED) return null;
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
            isRegrade={submission.status === 'GRADED'}
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
  const Icon = MODULE_TYPE_ICON[module.type] ?? FileText;
  return (
    <section className="rounded-[2rem] border border-rim bg-white p-6 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            MODULE_TYPE_TONE[module.type] ?? 'bg-soft text-ink-soft',
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-extrabold text-ink-strong">
            {MODULE_TYPE_LABELS[module.type] ?? module.type}
          </p>
        </div>
        <span className="font-mono text-[10px] text-ink-faint">
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
  isRegrade,
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
  isRegrade: boolean;
  isGradeValid: boolean;
  isPending: boolean;
  error: string | null;
  onGrade: () => void;
}) {
  return (
    <section className="rounded-[2rem] border border-rim bg-white p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-ink-strong">Baholash</h2>
          <p className="text-xs text-ink-soft">Maksimal: {totalPoints} ball</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
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
            className="w-full rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/60 focus:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="space-y-1">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Izoh
          </label>
          <textarea
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={!canGrade}
            placeholder="Talabaga qisqa fikr-mulohaza..."
            className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/60 focus:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red/20 bg-red-tint p-3 text-xs text-red-600">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onGrade}
          disabled={!canGrade || !isGradeValid || isPending}
          className="w-full rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,113,227,0.6)] transition-colors hover:bg-blue-400 disabled:opacity-60"
        >
          {isPending
            ? 'Saqlanyapti...'
            : isRegrade
              ? 'Bahoni yangilash'
              : 'Baho qo‘yish'}
        </button>
        {!canGrade ? (
          <p className="text-xs text-ink-soft">
            Bu holatda baho qo&apos;yib bo&apos;lmaydi. (Faqat YUBORILDI,
            TEKSHIRILMOQDA yoki BAHOLANGAN holatida ruxsat etilgan.)
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
    <section className="rounded-[2rem] border border-rim bg-white p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange/10 text-orange">
          <RotateCcw className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-sm font-extrabold tracking-tight text-ink-strong">
            Talabaga qaytarish
          </h2>
          <p className="text-xs text-ink-soft">Talabadan qayta ishlashni so&apos;rang.</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Izoh
          </label>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={!canReturn}
            placeholder="Nimani tuzatish kerakligini yozing..."
            className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/60 focus:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red/20 bg-red-tint p-3 text-xs text-red-600">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onReturn}
          disabled={!canReturn || isPending}
          className="w-full rounded-2xl border border-rim bg-tint px-5 py-2.5 text-sm font-semibold text-ink-strong transition-colors hover:border-blue/40 hover:text-blue disabled:opacity-60"
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
    <span className="rounded-full border border-orange/20 bg-orange-tint px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600">
      AI {pct !== null ? `${pct}%` : 'flag'}
    </span>
  );
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

function ReviewSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="h-40 animate-pulse rounded-[2.5rem] border border-rim bg-white shadow-soft" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-96 animate-pulse rounded-[2rem] border border-rim bg-white shadow-soft lg:col-span-2" />
        <div className="h-96 animate-pulse rounded-[2rem] border border-rim bg-white shadow-soft" />
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
