'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useContentProtection } from '../../hooks/use-content-protection';
import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AssignmentModule,
  type Submission,
} from '../../lib/api/homework';
import { ModuleRenderer, MODULE_TYPE_LABELS } from './module-runtimes';
import { SubmissionStatusBadge } from './submission-status-badge';

interface StudentAssignmentDetailProps {
  locale: string;
  assignmentId: string;
}

/**
 * Student assignment detail (`/[locale]/assignments/[id]`).
 *
 * Lifecycle (Req 12.1, 12.2, 12.7):
 *   1. Load assignment + my submission. If no submission exists, lazily
 *      create a DRAFT row on first interaction.
 *   2. Render every AssignmentModule through its runtime. Writing
 *      modules trigger autosave every 10s; Reading modules just bubble
 *      the latest snapshot to this parent.
 *   3. "Yuborish" (submit) sends the latest answers to
 *      `/submissions/:id/submit` and the page flips into the read-only
 *      view (status badge, AI flags, score, feedback).
 */
export function StudentAssignmentDetail({
  locale,
  assignmentId,
}: StudentAssignmentDetailProps) {
  useContentProtection();
  const queryClient = useQueryClient();

  const assignmentQuery = useQuery({
    queryKey: ['homework', 'assignment', assignmentId],
    queryFn: () => homeworkApi.getAssignment(assignmentId),
  });

  const submissionQuery = useQuery({
    queryKey: ['homework', 'submission', 'me', assignmentId],
    queryFn: () => homeworkApi.getMyForAssignment(assignmentId),
  });

  const submission = submissionQuery.data ?? null;
  const assignment = assignmentQuery.data;

  // Per-module answer snapshot. Keyed by AssignmentModule.id; the
  // backend persists the same shape under `Submission.answersJson`.
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  // Hydrate from the existing submission once it lands.
  useEffect(() => {
    if (submission?.answersJson) {
      setAnswers((prev) => ({
        ...(submission.answersJson as Record<string, unknown>),
        ...prev,
      }));
    }
  }, [submission?.answersJson]);

  // Latest answers ref so the autosave / submit handlers don't form a
  // closure around a stale snapshot.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const ensureDraftMutation = useMutation({
    mutationFn: () => homeworkApi.createDraft(assignmentId),
    onSuccess: (created) => {
      queryClient.setQueryData(
        ['homework', 'submission', 'me', assignmentId],
        created,
      );
    },
  });

  const updateAnswersMutation = useMutation({
    mutationFn: async (snapshot: Record<string, unknown>) => {
      let id = submission?.id;
      if (!id) {
        const created = await ensureDraftMutation.mutateAsync();
        id = created.id;
      }
      return homeworkApi.updateAnswers(id, snapshot);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['homework', 'submission', 'me', assignmentId],
        updated,
      );
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const snapshot = answersRef.current;
      let id = submission?.id;
      if (!id) {
        const created = await ensureDraftMutation.mutateAsync();
        id = created.id;
      }
      return homeworkApi.submit(id, snapshot);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['homework', 'submission', 'me', assignmentId],
        updated,
      );
      queryClient.invalidateQueries({
        queryKey: ['homework', 'lesson', updated.assignmentId],
      });
    },
  });

  const editable = useMemo(() => {
    if (!submission) return true; // first-time student
    return submission.status === 'DRAFT' || submission.status === 'RETURNED';
  }, [submission]);

  // Per-module change handler — merges into the parent answer map.
  const handleModuleChange = useCallback(
    (moduleId: string, answer: unknown) => {
      setAnswers((prev) => {
        const previous = prev[moduleId];
        if (previous === answer) return prev;
        return { ...prev, [moduleId]: answer };
      });
    },
    [],
  );

  // Per-module autosave handler — only the writing runtime calls this.
  const handleModuleAutosave = useCallback(
    async (moduleId: string, answer: unknown) => {
      const snapshot = { ...answersRef.current, [moduleId]: answer };
      await updateAnswersMutation.mutateAsync(snapshot);
    },
    [updateAnswersMutation],
  );

  if (assignmentQuery.isLoading) {
    return <DetailSkeleton />;
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

  const submitError = submitMutation.error;
  const isDeadlinePassed = assignment.dueAt
    ? new Date(assignment.dueAt).getTime() < Date.now()
    : false;
  const canSubmit = !isDeadlinePassed &&
    (submission?.status === 'DRAFT' || submission?.status === 'RETURNED' || !submission);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/${locale}/assignments`}
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
          <p className="mt-1 text-sm flex items-center gap-2 flex-wrap">
            {assignment.dueAt ? (
              <span className={isDeadlinePassed ? 'text-red-400 font-bold' : 'text-cream-dim'}>
                {isDeadlinePassed ? '⚠ Muddat tugadi:' : 'Muddat:'}{' '}
                {formatDateTime(assignment.dueAt)}
              </span>
            ) : (
              <span className="text-cream-dim">Muddat yo&apos;q</span>
            )}
            {assignment.totalPoints
              ? <span className="text-cream-dim">• Maksimal ball: {assignment.totalPoints}</span>
              : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {submission ? (
            <SubmissionStatusBadge status={submission.status} />
          ) : null}
          {submission?.status === 'GRADED' && submission.score !== null ? (
            <span className="rounded-xl bg-accent2-500/15 px-3 py-1 text-sm font-bold text-accent2-500">
              {submission.score}/{assignment.totalPoints}
            </span>
          ) : null}
        </div>
      </header>

      {assignment.description ? (
        <article className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5 text-sm leading-relaxed text-cream/90">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            Topshiriq tavsifi
          </p>
          <p className="mt-2 whitespace-pre-wrap">{assignment.description}</p>
        </article>
      ) : null}

      {submission && submission.aiFlagged ? (
        <AiFlagNotice likelihood={submission.aiLikelihood} />
      ) : null}

      <div className="space-y-6">
        {assignment.modules.map((module) => (
          <ModuleSection
            key={module.id}
            module={module}
            initialAnswer={answers[module.id] ?? null}
            editable={editable}
            onChange={handleModuleChange}
            onAutosave={editable ? handleModuleAutosave : undefined}
          />
        ))}
      </div>

      {submitError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {submitError instanceof ApiClientError
            ? submitError.message
            : "Yuborib bo'lmadi. Qayta urinib ko'ring."}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {isDeadlinePassed && (
          <p className="text-sm font-bold text-red-400">
            ⚠ Muddat tugagani uchun topshirish mumkin emas
          </p>
        )}
        {editable && canSubmit ? (
          <>
            <button
              type="button"
              onClick={() =>
                updateAnswersMutation.mutate(answersRef.current)
              }
              disabled={updateAnswersMutation.isPending}
              className="rounded-2xl border border-white/[0.07] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-accent2-500/40 hover:text-accent2-500 disabled:opacity-60"
            >
              {updateAnswersMutation.isPending ? 'Saqlanyapti...' : 'Saqlash'}
            </button>
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-colors hover:bg-accent2-400 disabled:opacity-60"
            >
              {submitMutation.isPending ? 'Yuborilmoqda...' : 'Yuborish'}
            </button>
          </>
        ) : (
          <span className="text-sm text-cream-dim">
            Bu topshiriq yopilgan — tahrirlab bo&apos;lmaydi.
          </span>
        )}
      </div>
    </div>
  );
}

interface ModuleSectionProps {
  module: AssignmentModule;
  initialAnswer: unknown;
  editable: boolean;
  onChange: (moduleId: string, answer: unknown) => void;
  onAutosave?: ((moduleId: string, answer: unknown) => Promise<void>) | undefined;
}

function ModuleSection({
  module,
  initialAnswer,
  editable,
  onChange,
  onAutosave,
}: ModuleSectionProps) {
  // Stabilise the per-module callbacks so the runtime doesn't trigger
  // setState loops when the parent re-renders (the runtime already
  // depends on `onChange` / `onAutosave` being stable references).
  const onChangeStable = useCallback(
    (answer: unknown) => onChange(module.id, answer),
    [module.id, onChange],
  );
  const onAutosaveStable = useMemo(() => {
    if (!onAutosave) return undefined;
    return async (answer: unknown) => onAutosave(module.id, answer);
  }, [module.id, onAutosave]);

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
        initialAnswer={initialAnswer}
        editable={editable}
        onChange={onChangeStable}
        onAutosave={onAutosaveStable}
      />
    </section>
  );
}

function AiFlagNotice({ likelihood }: { likelihood: number | null }) {
  const pct =
    likelihood !== null ? Math.round(likelihood * 100) : null;
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <p className="font-semibold">AI tahlili</p>
      <p className="mt-1">
        Sizning javobingiz AI yordamida yozilgan bo&apos;lishi mumkin
        {pct !== null ? ` (~${pct}% ehtimol)` : ''}. O&apos;qituvchi qo&apos;shimcha
        tekshiruvi natijasida yakuniy bahoni qo&apos;yadi.
      </p>
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
