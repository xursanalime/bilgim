'use client';

import Link from 'next/link';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AssignmentModule,
  type AssignmentWithModules,
  type Submission,
} from '../../lib/api/homework';
import {
  ModuleRunnerWriting,
  type ModuleRunnerWritingAnswer,
  type ModuleRunnerWritingConfig,
} from './module-runner-writing';
import {
  ModuleRunnerReading,
  type ModuleRunnerReadingAnswer,
  type ModuleRunnerReadingConfig,
} from './module-runner-reading';
import { MODULE_TYPE_LABELS } from './module-runtimes';
import { SubmissionStatusBadge } from './submission-status-badge';

/**
 * Submission editor (`/[locale]/submissions/[id]`, Task 25.4).
 *
 * Lifecycle (Req 11.2, 12.1, 12.2, 12.7):
 *   1. Load submission by id.
 *   2. Load the parent assignment (with its module list).
 *   3. Render every AssignmentModule via its runtime — WRITING +
 *      READING get the rich runners; everything else falls back to a
 *      generic JSON editor so the student can still finish a draft.
 *   4. Autosave the merged answers every 10s (PATCH /submissions/:id)
 *      while the submission is in DRAFT or RETURNED state.
 *   5. "Yuborish" → POST /submissions/:id/submit. Once SUBMITTED the
 *      page becomes read-only (matches the API guard).
 *
 * The component is route-driven by `submissionId`. The matching Next
 * page wraps it in `requireAuth` so STUDENT/TEACHER/ADMIN can all land
 * here; per-role gating happens server-side in the submission API.
 */
interface SubmissionEditorProps {
  locale: string;
  submissionId: string;
}

const AUTOSAVE_INTERVAL_MS = 10_000;

export function SubmissionEditor({
  locale,
  submissionId,
}: SubmissionEditorProps) {
  const queryClient = useQueryClient();

  // ── Data ───────────────────────────────────────────────────────
  const submissionQuery = useQuery({
    queryKey: ['homework', 'submission', submissionId],
    queryFn: () => homeworkApi.getSubmission(submissionId),
  });

  const submission: Submission | undefined = submissionQuery.data;

  const assignmentQuery = useQuery({
    queryKey: ['homework', 'assignment', submission?.assignmentId],
    queryFn: () => homeworkApi.getAssignment(submission!.assignmentId),
    enabled: Boolean(submission?.assignmentId),
  });

  const assignment: AssignmentWithModules | undefined = assignmentQuery.data;

  // ── Per-module answer snapshot (parent of every runner) ───────
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (submission?.answersJson) {
      // Hydrate from server snapshot but preserve any pending in-memory
      // edits the student may have made while the request was in flight.
      setAnswers((prev) => ({
        ...(submission.answersJson as Record<string, unknown>),
        ...prev,
      }));
    }
  }, [submission?.answersJson]);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // ── Mutations ─────────────────────────────────────────────────
  const updateAnswersMutation = useMutation({
    mutationFn: (snapshot: Record<string, unknown>) =>
      homeworkApi.updateAnswers(submissionId, snapshot),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['homework', 'submission', submissionId],
        updated,
      );
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      homeworkApi.submit(submissionId, answersRef.current),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['homework', 'submission', submissionId],
        updated,
      );
      queryClient.invalidateQueries({
        queryKey: ['homework', 'submission', 'me', updated.assignmentId],
      });
    },
  });

  const editable = useMemo(() => {
    if (!submission) return false;
    return submission.status === 'DRAFT' || submission.status === 'RETURNED';
  }, [submission]);

  // ── Autosave loop (Req 11.2 / 12.1) ─────────────────────────────
  const [savingState, setSavingState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const dirtyRef = useRef(false);
  const lastSnapshotRef = useRef<string>('');

  // Track diff between latest in-memory answers and the last persisted snapshot.
  useEffect(() => {
    const serialised = JSON.stringify(answers);
    if (serialised !== lastSnapshotRef.current) {
      dirtyRef.current = true;
    }
  }, [answers]);

  useEffect(() => {
    if (!editable) return;
    const handle = window.setInterval(async () => {
      if (!dirtyRef.current) return;
      const snapshot = answersRef.current;
      const serialised = JSON.stringify(snapshot);
      try {
        setSavingState('saving');
        await updateAnswersMutation.mutateAsync(snapshot);
        lastSnapshotRef.current = serialised;
        dirtyRef.current = serialised !== JSON.stringify(answersRef.current);
        setSavingState('saved');
        setSavedAt(new Date());
      } catch {
        setSavingState('error');
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [editable, updateAnswersMutation]);

  const handleModuleChange = useCallback(
    (moduleId: string, answer: unknown) => {
      setAnswers((prev) => {
        if (prev[moduleId] === answer) return prev;
        return { ...prev, [moduleId]: answer };
      });
    },
    [],
  );

  const handleManualSave = useCallback(async () => {
    if (!editable) return;
    const snapshot = answersRef.current;
    try {
      setSavingState('saving');
      await updateAnswersMutation.mutateAsync(snapshot);
      lastSnapshotRef.current = JSON.stringify(snapshot);
      dirtyRef.current = false;
      setSavingState('saved');
      setSavedAt(new Date());
    } catch {
      setSavingState('error');
    }
  }, [editable, updateAnswersMutation]);

  // ── Render ─────────────────────────────────────────────────────
  if (submissionQuery.isLoading) {
    return <EditorSkeleton />;
  }
  if (submissionQuery.isError || !submission) {
    return (
      <ErrorBanner
        message={
          submissionQuery.error instanceof ApiClientError
            ? translateError(submissionQuery.error)
            : "Topshirilgan ishni yuklab bo'lmadi."
        }
      />
    );
  }
  if (assignmentQuery.isLoading || !assignment) {
    return <EditorSkeleton />;
  }
  if (assignmentQuery.isError) {
    return (
      <ErrorBanner
        message={
          assignmentQuery.error instanceof ApiClientError
            ? translateError(assignmentQuery.error)
            : "Topshiriqni yuklab bo'lmadi."
        }
      />
    );
  }

  const orderedModules = [...assignment.modules].sort(
    (a, b) => a.order - b.order,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/${locale}/assignments/${assignment.id}`}
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
          <p className="mt-1 text-sm text-cream-dim">
            {assignment.dueAt
              ? `Muddat: ${formatDateTime(assignment.dueAt)}`
              : "Muddat yo'q"}
            {assignment.totalPoints
              ? ` • Maksimal ball: ${assignment.totalPoints}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubmissionStatusBadge status={submission.status} />
          {submission.status === 'GRADED' && submission.score !== null ? (
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

      {submission.aiFlagged ? (
        <AiFlagNotice likelihood={submission.aiLikelihood} />
      ) : null}

      <div className="space-y-6">
        {orderedModules.map((module) => (
          <ModuleSection
            key={module.id}
            module={module}
            initialAnswer={answers[module.id] ?? null}
            editable={editable}
            onChange={handleModuleChange}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-ink-surface px-5 py-4">
        <AutosaveIndicator
          state={savingState}
          savedAt={savedAt}
          editable={editable}
        />
        <div className="flex items-center gap-3">
          {editable ? (
            <>
              <button
                type="button"
                onClick={handleManualSave}
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

      {submitMutation.error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {submitMutation.error instanceof ApiClientError
            ? translateError(submitMutation.error)
            : "Yuborib bo'lmadi. Qayta urinib ko'ring."}
        </div>
      ) : null}
    </div>
  );
}

// ── Per-module section ───────────────────────────────────────────────

interface ModuleSectionProps {
  module: AssignmentModule;
  initialAnswer: unknown;
  editable: boolean;
  onChange: (moduleId: string, answer: unknown) => void;
}

function ModuleSection({
  module,
  initialAnswer,
  editable,
  onChange,
}: ModuleSectionProps) {
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
        <span className="font-mono text-[10px] text-cream-dim">
          #{module.order + 1}
        </span>
      </div>
      <ModuleRunner
        module={module}
        initialAnswer={initialAnswer}
        editable={editable}
        onChange={onChangeStable}
      />
    </section>
  );
}

// ── Module runner registry — writing + reading + generic JSON ───────

interface ModuleRunnerProps {
  module: AssignmentModule;
  initialAnswer: unknown;
  editable: boolean;
  onChange: (answer: unknown) => void;
}

function ModuleRunner({
  module,
  initialAnswer,
  editable,
  onChange,
}: ModuleRunnerProps) {
  if (module.type === 'WRITING') {
    const config = (module.configJson ?? { prompt: '' }) as ModuleRunnerWritingConfig;
    return (
      <ModuleRunnerWriting
        config={config}
        initialAnswer={
          (initialAnswer as ModuleRunnerWritingAnswer | null) ?? null
        }
        editable={editable}
        onChange={(a) => onChange(a)}
      />
    );
  }

  if (module.type === 'READING') {
    const config = (module.configJson ?? {
      passage: '',
      questions: [],
    }) as ModuleRunnerReadingConfig;
    return (
      <ModuleRunnerReading
        config={config}
        initialAnswer={
          (initialAnswer as ModuleRunnerReadingAnswer | null) ?? null
        }
        editable={editable}
        onChange={(a) => onChange(a)}
      />
    );
  }

  return (
    <GenericJsonRunner
      module={module}
      initialAnswer={initialAnswer}
      editable={editable}
      onChange={onChange}
    />
  );
}

/**
 * Generic fallback runtime — exposes the raw JSON structure expected
 * by the API so a student can still finish a submission for module
 * types whose UI runner has not landed yet (LISTENING, GRAMMAR,
 * SPELLING, ...). Renders the module config as a read-only hint so
 * the student knows what the teacher expects.
 */
function GenericJsonRunner({
  module,
  initialAnswer,
  editable,
  onChange,
}: ModuleRunnerProps) {
  const [text, setText] = useState<string>(() => {
    if (initialAnswer === null || initialAnswer === undefined) return '';
    if (typeof initialAnswer === 'string') return initialAnswer;
    try {
      return JSON.stringify(initialAnswer, null, 2);
    } catch {
      return '';
    }
  });
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = (value: string) => {
    setText(value);
    if (!value.trim()) {
      onChange({ raw: '' });
      setParseError(null);
      return;
    }
    try {
      const parsed = JSON.parse(value);
      onChange(parsed);
      setParseError(null);
    } catch {
      // Bubble the raw string so the student doesn't lose work; the
      // server will reject it on submit if the runtime requires JSON.
      onChange({ raw: value });
      setParseError(
        "JSON sifatida tahlil qilib bo'lmadi — matn ko'rinishida saqlanadi.",
      );
    }
  };

  return (
    <div className="space-y-3">
      {module.configJson ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            Vazifa sozlamalari
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-cream/80">
            {safeStringify(module.configJson)}
          </pre>
        </div>
      ) : null}
      <label className="block">
        <span className="mb-2 block font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cream-dim">
          Javobingiz (JSON yoki matn)
        </span>
        <textarea
          rows={8}
          value={text}
          disabled={!editable}
          onChange={(e) => handleChange(e.target.value)}
          placeholder='Masalan: { "answer": "..." }'
          className="w-full rounded-2xl border border-ink-line bg-white/[0.04] px-4 py-3 font-mono text-xs leading-relaxed text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-70"
        />
      </label>
      {parseError ? (
        <p className="text-xs text-amber-300">{parseError}</p>
      ) : null}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function AutosaveIndicator({
  state,
  savedAt,
  editable,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
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
        Saqlash xatosi
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
      Avtomatik saqlash har 10 soniyada
    </span>
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
        {pct !== null ? ` (~${pct}% ehtimol)` : ''}. O&apos;qituvchi
        qo&apos;shimcha tekshiruvi natijasida yakuniy bahoni qo&apos;yadi.
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

function EditorSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="h-40 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
      <div className="h-64 animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
    </div>
  );
}

/**
 * Map server-side error codes (the same envelope the auth forms read
 * from `error.details.code`) to Uzbek-friendly copy. Falls back to the
 * server-provided `message` so unknown errors aren't swallowed.
 */
function translateError(error: ApiClientError): string {
  const details = error.details as
    | { code?: string; message?: string }
    | undefined;
  const code = details?.code;
  switch (code) {
    case 'SUBMISSION_NOT_FOUND':
      return "Topshirilgan ish topilmadi.";
    case 'SUBMISSION_LOCKED':
    case 'SUBMISSION_NOT_EDITABLE':
      return "Bu topshirilgan ish endi tahrirlanmaydi.";
    case 'ASSIGNMENT_NOT_FOUND':
      return 'Topshiriq topilmadi.';
    case 'FORBIDDEN':
    case 'NOT_OWNING_TEACHER':
      return "Sizda bu topshirilgan ishni ko'rish huquqi yo'q.";
    case 'UNAUTHENTICATED':
      return 'Iltimos, qayta tizimga kiring.';
    default:
      return details?.message || error.message;
  }
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
