'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useContentProtection } from '../../hooks/use-content-protection';
import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AssignmentModule,
  type Submission,
} from '../../lib/api/homework';
import { LoadingState } from '../states/loading-state';
import { ErrorState } from '../states/error-state';
import { ProgressBar } from '../ui/progress-bar';
import { Button } from '../ui/button';
import { ModuleRenderer, MODULE_TYPE_LABELS } from './module-runtimes';
import type { AudioSubmissionInfo } from './module-runtimes/audio-task-runtime';
import { SubmissionStatusBadge } from './submission-status-badge';

interface AssignmentRunnerProps {
  locale: string;
  assignmentId: string;
}

/** Debounce window for the autosave PATCH (Req 10.2 — autosave states). */
const AUTOSAVE_DEBOUNCE_MS = 1_500;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Canonical learner assignment-taking UI (frontend-redesign Req 10.2,
 * 10.3 — Task 6.2).
 *
 * Given an assignment's modules + per-skill `configJson`, this renders
 * the right input surface for each of the eight English skills
 * (writing / reading / listening / grammar / vocabulary / spelling /
 * speaking + pronunciation) through the shared `ModuleRenderer`
 * registry. SPEAKING/PRONUNCIATION show an audio-capture placeholder —
 * the recorder + upload lands in Task 6.3.
 *
 * Lifecycle:
 *   1. Load assignment + the caller's submission (lazily create a DRAFT
 *      on first meaningful edit / submit).
 *   2. Track a per-module answer map keyed by `AssignmentModule.id`
 *      (the same shape persisted under `Submission.answersJson`).
 *   3. Debounced autosave → PATCH `/submissions/:id` with clear
 *      saving / saved / error states.
 *   4. "Yuborish" → POST `/submissions/:id/submit`, then navigate to the
 *      read-only assignment view.
 */
export function AssignmentRunner({ locale, assignmentId }: AssignmentRunnerProps) {
  useContentProtection();
  const router = useRouter();
  const queryClient = useQueryClient();

  const assignmentQuery = useQuery({
    queryKey: ['homework', 'assignment', assignmentId],
    queryFn: () => homeworkApi.getAssignment(assignmentId),
  });

  const submissionQuery = useQuery({
    queryKey: ['homework', 'submission', 'me', assignmentId],
    queryFn: () => homeworkApi.getMyForAssignment(assignmentId),
  });

  const assignment = assignmentQuery.data;
  const submission = submissionQuery.data ?? null;

  // ── Answer state ────────────────────────────────────────────────
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Hydrate from persisted answers once, then let local edits win.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (submission?.answersJson) {
      hydratedRef.current = true;
      const persisted = submission.answersJson as Record<string, unknown>;
      setAnswers(persisted);
      lastSavedSerializedRef.current = JSON.stringify(persisted);
    }
  }, [submission?.answersJson]);

  // ── Save state ──────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const lastSavedSerializedRef = useRef('');
  const submissionIdRef = useRef<string | null>(submission?.id ?? null);
  useEffect(() => {
    submissionIdRef.current = submission?.id ?? null;
  }, [submission?.id]);

  const editable = useMemo(() => {
    if (!submission) return true; // first-time learner
    return submission.status === 'DRAFT' || submission.status === 'RETURNED';
  }, [submission]);

  const orderedModules = useMemo(
    () =>
      assignment
        ? [...assignment.modules].sort((a, b) => a.order - b.order)
        : [],
    [assignment],
  );

  const ensureDraftMutation = useMutation({
    mutationFn: () => homeworkApi.createDraft(assignmentId),
    onSuccess: (created) => {
      submissionIdRef.current = created.id;
      queryClient.setQueryData(
        ['homework', 'submission', 'me', assignmentId],
        created,
      );
    },
  });

  const ensureDraftId = useCallback(async (): Promise<string> => {
    if (submissionIdRef.current) return submissionIdRef.current;
    const created = await ensureDraftMutation.mutateAsync();
    return created.id;
  }, [ensureDraftMutation]);

  const persist = useCallback(
    async (snapshot: Record<string, unknown>) => {
      const serialized = JSON.stringify(snapshot);
      setSaveState('saving');
      try {
        const id = await ensureDraftId();
        const updated = await homeworkApi.updateAnswers(id, snapshot);
        queryClient.setQueryData(
          ['homework', 'submission', 'me', assignmentId],
          updated,
        );
        lastSavedSerializedRef.current = serialized;
        setSaveState('saved');
        setSavedAt(new Date());
      } catch {
        setSaveState('error');
      }
    },
    [assignmentId, ensureDraftId, queryClient],
  );

  // ── Debounced autosave ──────────────────────────────────────────
  const answersSerialized = useMemo(() => JSON.stringify(answers), [answers]);
  const hasMeaningfulAnswer = useMemo(
    () =>
      orderedModules.some((m) => isAnswered(m, answers[m.id])),
    [orderedModules, answers],
  );

  useEffect(() => {
    if (!editable) return;
    if (answersSerialized === lastSavedSerializedRef.current) return;
    // Avoid creating an empty draft before any real input.
    if (!submissionIdRef.current && !hasMeaningfulAnswer) return;

    const handle = window.setTimeout(() => {
      void persist(answersRef.current);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [answersSerialized, editable, hasMeaningfulAnswer, persist]);

  // Best-effort flush of unsaved edits on unmount.
  useEffect(() => {
    return () => {
      if (!editable) return;
      if (JSON.stringify(answersRef.current) === lastSavedSerializedRef.current)
        return;
      if (!submissionIdRef.current && !orderedModules.some((m) => isAnswered(m, answersRef.current[m.id]))) {
        return;
      }
      persist(answersRef.current).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  // ── Submit ──────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: async () => {
      const snapshot = answersRef.current;
      const id = await ensureDraftId();
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
      router.push(`/${locale}/homework/${assignmentId}`);
    },
  });

  const handleModuleChange = useCallback((moduleId: string, answer: unknown) => {
    setAnswers((prev) => {
      if (Object.is(prev[moduleId], answer)) return prev;
      return { ...prev, [moduleId]: answer };
    });
  }, []);

  const manualSave = useCallback(() => {
    void persist(answersRef.current);
  }, [persist]);

  // ── Render ──────────────────────────────────────────────────────
  if (assignmentQuery.isLoading || submissionQuery.isLoading) {
    return (
      <div className="mx-auto max-w-5xl">
        <LoadingState variant="page" label="Topshiriq yuklanmoqda…" />
      </div>
    );
  }

  if (assignmentQuery.isError || !assignment) {
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState
          title="Topshiriqni yuklab bo'lmadi"
          message={
            assignmentQuery.error instanceof ApiClientError
              ? assignmentQuery.error.message
              : "Kutilmagan xatolik yuz berdi."
          }
          retryLabel="Qayta urinish"
          onRetry={() => assignmentQuery.refetch()}
        />
      </div>
    );
  }

  const isDeadlinePassed = assignment.dueAt
    ? new Date(assignment.dueAt).getTime() < Date.now()
    : false;
  const canSubmit =
    editable && !isDeadlinePassed && orderedModules.length > 0;
  const completedCount = orderedModules.reduce(
    (acc, m) => (isAnswered(m, answers[m.id]) ? acc + 1 : acc),
    0,
  );

  // AI-relevant submission slice for audio modules (Req 10.4). Omitted while
  // there is no submission yet so audio modules show no scoring status.
  const audioSubmission: AudioSubmissionInfo | undefined = submission
    ? {
        status: submission.status,
        aiFlagged: submission.aiFlagged,
        aiLikelihood: submission.aiLikelihood,
        score: submission.score,
        ...(assignment.totalPoints
          ? { maxPoints: assignment.totalPoints }
          : {}),
      }
    : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/${locale}/homework/${assignmentId}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          ← Topshiriqqa qaytish
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
            {assignment.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {assignment.dueAt ? (
              <span
                className={
                  isDeadlinePassed ? 'font-bold text-red-400' : 'text-cream-dim'
                }
              >
                {isDeadlinePassed ? '⚠ Muddat tugadi:' : 'Muddat:'}{' '}
                {formatDateTime(assignment.dueAt)}
              </span>
            ) : (
              <span className="text-cream-dim">Muddat yo&apos;q</span>
            )}
            {assignment.totalPoints ? (
              <span className="text-cream-dim">
                • Maksimal ball: {assignment.totalPoints}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {submission ? (
            <SubmissionStatusBadge status={submission.status} />
          ) : null}
          <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            {completedCount}/{orderedModules.length} bajarildi
          </span>
        </div>
      </header>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-cream-dim">
          <span className="font-mono uppercase tracking-[0.18em]">
            Bajarilgan modullar
          </span>
          <span>
            {orderedModules.length === 0
              ? 0
              : Math.round((completedCount / orderedModules.length) * 100)}
            %
          </span>
        </div>
        <ProgressBar
          color="green"
          value={
            orderedModules.length === 0
              ? 0
              : Math.round((completedCount / orderedModules.length) * 100)
          }
          label="Bajarilgan modullar"
        />
      </div>

      {assignment.description ? (
        <article className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5 text-sm leading-relaxed text-cream/90">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            Topshiriq tavsifi
          </p>
          <p className="mt-2 whitespace-pre-wrap">{assignment.description}</p>
        </article>
      ) : null}

      {submission?.aiFlagged ? (
        <AiFlagNotice likelihood={submission.aiLikelihood} />
      ) : null}

      <div className="space-y-6">
        {orderedModules.map((module, idx) => (
          <ModuleSection
            key={module.id}
            index={idx + 1}
            module={module}
            initialAnswer={answers[module.id] ?? null}
            editable={editable}
            onChange={handleModuleChange}
            submission={audioSubmission}
          />
        ))}
      </div>

      {submitMutation.isError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {submitMutation.error instanceof ApiClientError
            ? submitMutation.error.message
            : "Yuborib bo'lmadi. Qayta urinib ko'ring."}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-ink-surface px-5 py-4">
        <AutosaveIndicator state={saveState} savedAt={savedAt} editable={editable} />
        <div className="flex items-center gap-3">
          {editable ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={manualSave}
                disabled={saveState === 'saving'}
              >
                {saveState === 'saving' ? 'Saqlanyapti...' : 'Saqlash'}
              </Button>
              <Button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={!canSubmit || submitMutation.isPending}
                loading={submitMutation.isPending}
              >
                Yuborish
              </Button>
            </>
          ) : (
            <span className="text-sm text-cream-dim">
              Bu topshiriq yopilgan — tahrirlab bo&apos;lmaydi.
            </span>
          )}
        </div>
      </div>

      {isDeadlinePassed && editable ? (
        <p className="text-right text-sm font-bold text-red-400">
          ⚠ Muddat tugagani uchun topshirish mumkin emas
        </p>
      ) : null}
    </div>
  );
}

interface ModuleSectionProps {
  index: number;
  module: AssignmentModule;
  initialAnswer: unknown;
  editable: boolean;
  onChange: (moduleId: string, answer: unknown) => void;
  submission?: AudioSubmissionInfo | undefined;
}

function ModuleSection({
  index,
  module,
  initialAnswer,
  editable,
  onChange,
  submission,
}: ModuleSectionProps) {
  // Stable per-module change handler so runtimes don't loop on parent
  // re-renders (they treat `onChange` as a stable dependency).
  const onChangeStable = useCallback(
    (answer: unknown) => onChange(module.id, answer),
    [module.id, onChange],
  );

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-surface p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
          {MODULE_TYPE_LABELS[module.type] ?? module.type}
        </span>
        <span className="font-mono text-[10px] text-cream-dim">#{index}</span>
      </div>
      <ModuleRenderer
        module={module}
        initialAnswer={initialAnswer}
        editable={editable}
        onChange={onChangeStable}
        submission={submission}
      />
    </section>
  );
}

function AutosaveIndicator({
  state,
  savedAt,
  editable,
}: {
  state: SaveState;
  savedAt: Date | null;
  editable: boolean;
}) {
  if (!editable) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
        Faqat o&apos;qish
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
        Saqlanyapti...
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose-300">
        Saqlashda xatolik — qayta urinilmoqda
      </span>
    );
  }
  if (state === 'saved' && savedAt) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent2-500">
        Saqlandi{' '}
        {savedAt.toLocaleTimeString('uz-UZ', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
      Avtomatik saqlanadi
    </span>
  );
}

function AiFlagNotice({ likelihood }: { likelihood: number | null }) {
  const pct = likelihood !== null ? Math.round(likelihood * 100) : null;
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <p className="font-semibold">AI tahlili</p>
      <p className="mt-1">
        Sizning javobingiz AI yordamida yozilgan bo&apos;lishi mumkin
        {pct !== null ? ` (~${pct}% ehtimol)` : ''}. O&apos;qituvchi
        qo&apos;shimcha tekshiruvi natijasida yakuniy bahoni qo&apos;yadi.
      </p>
    </div>
  );
}

/** Whether a module's answer payload counts as "started / answered". */
function isAnswered(module: AssignmentModule, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'object') return false;

  const v = value as Record<string, unknown>;
  switch (module.type) {
    case 'WRITING': {
      const text = v.text;
      return typeof text === 'string' && text.trim().length > 0;
    }
    case 'READING':
    case 'LISTENING':
    case 'SPELLING': {
      const responses = v.responses;
      return (
        !!responses &&
        typeof responses === 'object' &&
        Object.values(responses as Record<string, unknown>).some((r) =>
          hasResponseValue(r),
        )
      );
    }
    case 'GRAMMAR': {
      const responses = v.responses;
      return (
        !!responses &&
        typeof responses === 'object' &&
        Object.keys(responses as Record<string, unknown>).length > 0
      );
    }
    case 'VOCABULARY': {
      const known = v.known;
      const unknown = v.unknown;
      return (
        (Array.isArray(known) && known.length > 0) ||
        (Array.isArray(unknown) && unknown.length > 0)
      );
    }
    case 'SPEAKING':
    case 'PRONUNCIATION': {
      const attempts = v.attempts;
      if (!Array.isArray(attempts)) return false;
      return attempts.some((a) => {
        if (!a || typeof a !== 'object') return false;
        const att = a as Record<string, unknown>;
        return (
          (typeof att.note === 'string' && att.note.trim().length > 0) ||
          typeof att.audioMediaId === 'string'
        );
      });
    }
    default:
      return Object.keys(v).length > 0;
  }
}

function hasResponseValue(response: unknown): boolean {
  if (!response || typeof response !== 'object') {
    return typeof response === 'string' ? response.trim().length > 0 : false;
  }
  const value = (response as { value?: unknown; values?: unknown }).value;
  const values = (response as { values?: unknown }).values;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (Array.isArray(values)) return values.some((x) => `${x}`.trim().length > 0);
  return false;
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
