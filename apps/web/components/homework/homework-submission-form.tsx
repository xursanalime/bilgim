'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import useSWR from 'swr';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkFetchers,
  homeworkMutations,
  type AssignmentModule,
  type AssignmentWithModules,
  type Submission,
} from '../../lib/homework-api';
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
import { AssignmentMaterials } from './assignment-materials';

interface HomeworkSubmissionFormProps {
  locale: string;
  assignmentId: string;
}

const AUTOSAVE_INTERVAL_MS = 10_000;

/**
 * `/[locale]/homework/[assignmentId]/submit` (Task 25.4, Req 12.1).
 *
 * Renders one input slot per `AssignmentModule`. Form state is tracked
 * by `react-hook-form` + a zod schema (`answers` is a free record so
 * the schema simply asserts shape). The form is autosaved every 10
 * seconds while the student is editing (DRAFT / RETURNED); on submit
 * it transitions to SUBMITTED via `/submissions/:id/submit` and
 * navigates back to the assignment view.
 */
export function HomeworkSubmissionForm({
  locale,
  assignmentId,
}: HomeworkSubmissionFormProps) {
  const router = useRouter();

  // ── Data: assignment + my submission ──────────────────────────
  const assignmentSwr = useSWR(
    ['homework:assignment', assignmentId],
    () => homeworkFetchers.assignment(assignmentId),
  );
  const submissionSwr = useSWR(
    ['homework:my-submission', assignmentId],
    () => homeworkFetchers.mySubmission(assignmentId),
  );

  const assignment: AssignmentWithModules | undefined = assignmentSwr.data;
  const submission: Submission | null | undefined = submissionSwr.data;

  // ── react-hook-form + zod ─────────────────────────────────────
  const moduleIds = useMemo(
    () => (assignment ? assignment.modules.map((m) => m.id) : []),
    [assignment],
  );

  const formSchema = useMemo(
    () => buildAnswersSchema(moduleIds),
    [moduleIds],
  );

  type FormShape = { answers: Record<string, unknown> };

  const { control, handleSubmit, reset, getValues, watch } = useForm<FormShape>({
    resolver: zodResolver(formSchema),
    defaultValues: { answers: {} },
  });

  // Hydrate the form once the existing submission is fetched. Use
  // `reset` so dirty tracking starts clean from the persisted state.
  useEffect(() => {
    if (submission?.answersJson) {
      reset({ answers: submission.answersJson as Record<string, unknown> });
    }
  }, [submission?.answersJson, reset]);

  // ── Autosave loop ─────────────────────────────────────────────
  const editable = useMemo(() => {
    if (!submission) return true;
    return submission.status === 'DRAFT' || submission.status === 'RETURNED';
  }, [submission]);

  const [savingState, setSavingState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirtyRef = useRef(false);
  const lastSerialisedRef = useRef('');
  const submissionIdRef = useRef<string | null>(submission?.id ?? null);
  useEffect(() => {
    submissionIdRef.current = submission?.id ?? null;
  }, [submission?.id]);

  // Watch answers; flag dirty when the serialised snapshot moves.
  const watchedAnswers = watch('answers');
  useEffect(() => {
    const serialised = JSON.stringify(watchedAnswers ?? {});
    if (serialised !== lastSerialisedRef.current) {
      dirtyRef.current = true;
    }
  }, [watchedAnswers]);

  const ensureDraftId = useCallback(async (): Promise<string> => {
    if (submissionIdRef.current) return submissionIdRef.current;
    const created = await homeworkMutations.createDraft(assignmentId);
    submissionIdRef.current = created.id;
    submissionSwr.mutate(created, false);
    return created.id;
  }, [assignmentId, submissionSwr]);

  const persistAnswers = useCallback(
    async (answers: Record<string, unknown>) => {
      const id = await ensureDraftId();
      const updated = await homeworkMutations.updateAnswers(id, answers);
      submissionSwr.mutate(updated, false);
      return updated;
    },
    [ensureDraftId, submissionSwr],
  );

  useEffect(() => {
    if (!editable || !assignment) return;
    const handle = window.setInterval(async () => {
      if (!dirtyRef.current) return;
      const snapshot = (getValues('answers') ?? {}) as Record<string, unknown>;
      const serialised = JSON.stringify(snapshot);
      try {
        setSavingState('saving');
        await persistAnswers(snapshot);
        lastSerialisedRef.current = serialised;
        dirtyRef.current =
          serialised !== JSON.stringify(getValues('answers') ?? {});
        setSavingState('saved');
        setSavedAt(new Date());
      } catch {
        setSavingState('error');
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [editable, assignment, getValues, persistAnswers]);

  // Flush on unmount when there are unsaved edits.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current || !editable) return;
      const snapshot = (getValues('answers') ?? {}) as Record<string, unknown>;
      // Best-effort fire-and-forget: navigation cancels the fetch but the
      // browser will still try to deliver it.
      persistAnswers(snapshot).catch(() => undefined);
    };
  }, [editable, getValues, persistAnswers]);

  // ── Submit ────────────────────────────────────────────────────
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const id = await ensureDraftId();
      const updated = await homeworkMutations.submit(id, values.answers);
      submissionSwr.mutate(updated, false);
      router.push(`/${locale}/homework/${assignmentId}`);
    } catch (error) {
      setSubmitError(
        error instanceof ApiClientError
          ? error.message
          : "Yuborib bo'lmadi. Qayta urinib ko'ring.",
      );
    } finally {
      setSubmitting(false);
    }
  });

  const manualSave = useCallback(async () => {
    if (!editable) return;
    const snapshot = (getValues('answers') ?? {}) as Record<string, unknown>;
    try {
      setSavingState('saving');
      await persistAnswers(snapshot);
      lastSerialisedRef.current = JSON.stringify(snapshot);
      dirtyRef.current = false;
      setSavingState('saved');
      setSavedAt(new Date());
    } catch {
      setSavingState('error');
    }
  }, [editable, getValues, persistAnswers]);

  // ── Render ────────────────────────────────────────────────────
  if (assignmentSwr.isLoading || submissionSwr.isLoading) {
    return <FormSkeleton />;
  }
  if (assignmentSwr.error || !assignment) {
    return (
      <ErrorBanner
        message={
          assignmentSwr.error instanceof ApiClientError
            ? assignmentSwr.error.message
            : "Topshiriqni yuklab bo'lmadi."
        }
      />
    );
  }

  const orderedModules = [...assignment.modules].sort(
    (a, b) => a.order - b.order,
  );
  const totalCount = orderedModules.length;
  const completedCount = countCompletedModules(orderedModules, watchedAnswers);

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/${locale}/homework/${assignmentId}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft hover:text-blue"
        >
          ← Topshiriqqa qaytish
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
            {assignment.title}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {assignment.dueAt
              ? `Muddat: ${formatDateTime(assignment.dueAt)}`
              : "Muddat yo'q"}
            {assignment.totalPoints
              ? ` • Maksimal ball: ${assignment.totalPoints}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {submission ? (
            <SubmissionStatusBadge status={submission.status} />
          ) : null}
          <span className="rounded-full bg-soft px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            {completedCount}/{totalCount} bajarildi
          </span>
        </div>
      </header>

      <ProgressBar value={completedCount} total={totalCount} />

      {assignment.description ? (
        <article className="rounded-2xl border border-rim bg-canvas p-5 text-sm leading-relaxed text-ink-strong/90">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            Topshiriq tavsifi
          </p>
          <p className="mt-2 whitespace-pre-wrap">{assignment.description}</p>
        </article>
      ) : null}

      <AssignmentMaterials
        assignmentId={assignmentId}
        editable={false}
        initialAttachments={assignment.attachments}
      />

      <div className="space-y-6">
        {orderedModules.map((module, idx) => (
          <Controller
            key={module.id}
            name={`answers.${module.id}` as const}
            control={control}
            render={({ field }) => (
              <ModuleSlot
                index={idx + 1}
                module={module}
                value={field.value}
                editable={editable}
                onChange={field.onChange}
              />
            )}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rim bg-canvas px-5 py-4">
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
                onClick={manualSave}
                disabled={savingState === 'saving'}
                className="rounded-2xl border border-rim bg-tint px-5 py-2.5 text-sm font-semibold text-ink-strong transition-colors hover:border-blue/40 hover:text-blue disabled:opacity-60"
              >
                {savingState === 'saving' ? 'Saqlanyapti...' : 'Saqlash'}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,113,227,0.6)] transition-colors hover:bg-blue-400 disabled:opacity-60"
              >
                {submitting ? 'Yuborilmoqda...' : 'Yuborish'}
              </button>
            </>
          ) : (
            <span className="text-sm text-ink-soft">
              Bu topshiriq yopilgan — tahrirlab bo&apos;lmaydi.
            </span>
          )}
        </div>
      </div>

      {submitError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {submitError}
        </div>
      ) : null}
    </form>
  );
}

// ── Per-module slot (writing / reading + JSON fallback) ─────────────

interface ModuleSlotProps {
  index: number;
  module: AssignmentModule;
  value: unknown;
  editable: boolean;
  onChange: (value: unknown) => void;
}

function ModuleSlot({ index, module, value, editable, onChange }: ModuleSlotProps) {
  return (
    <section className="rounded-2xl border border-rim bg-canvas p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
          {MODULE_TYPE_LABELS[module.type] ?? module.type}
        </span>
        <span className="font-mono text-[10px] text-ink-soft">#{index}</span>
      </div>
      {renderRunner(module, value, editable, onChange)}
    </section>
  );
}

function renderRunner(
  module: AssignmentModule,
  value: unknown,
  editable: boolean,
  onChange: (v: unknown) => void,
) {
  if (module.type === 'WRITING') {
    const config = (module.configJson ?? { prompt: '' }) as ModuleRunnerWritingConfig;
    return (
      <ModuleRunnerWriting
        config={config}
        initialAnswer={(value as ModuleRunnerWritingAnswer | null) ?? null}
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
        initialAnswer={(value as ModuleRunnerReadingAnswer | null) ?? null}
        editable={editable}
        onChange={(a) => onChange(a)}
      />
    );
  }
  return (
    <GenericRunner module={module} value={value} editable={editable} onChange={onChange} />
  );
}

function GenericRunner({
  module,
  value,
  editable,
  onChange,
}: {
  module: AssignmentModule;
  value: unknown;
  editable: boolean;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState<string>(() => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  });
  const [parseError, setParseError] = useState<string | null>(null);

  function handleChange(next: string) {
    setText(next);
    if (!next.trim()) {
      onChange({ raw: '' });
      setParseError(null);
      return;
    }
    try {
      onChange(JSON.parse(next));
      setParseError(null);
    } catch {
      onChange({ raw: next });
      setParseError(
        "JSON sifatida tahlil qilib bo'lmadi — matn sifatida saqlanadi.",
      );
    }
  }

  return (
    <div className="space-y-3">
      {module.configJson ? (
        <div className="rounded-2xl border border-rim bg-tint p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            Vazifa sozlamalari
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-ink-strong/80">
            {safeStringify(module.configJson)}
          </pre>
        </div>
      ) : null}
      <label className="block">
        <span className="mb-2 block font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
          Javobingiz (JSON yoki matn)
        </span>
        <textarea
          rows={8}
          value={text}
          disabled={!editable}
          onChange={(e) => handleChange(e.target.value)}
          placeholder='Masalan: { "answer": "..." }'
          className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 font-mono text-xs leading-relaxed text-ink-strong placeholder-ink-faint outline-none focus:border-blue/60 focus:bg-soft disabled:cursor-not-allowed disabled:opacity-70"
        />
      </label>
      {parseError ? (
        <p className="text-xs text-amber-300">{parseError}</p>
      ) : null}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildAnswersSchema(moduleIds: string[]) {
  // The server validates per-module shapes through dedicated runtimes;
  // here we only assert that `answers` is an object, then narrow each
  // known module key to "any structured value". This keeps the form
  // useful even when the runtime hasn't yet supplied a typed schema.
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const id of moduleIds) {
    shape[id] = z.unknown().optional();
  }
  return z.object({
    answers: z.object(shape).passthrough(),
  });
}

function countCompletedModules(
  modules: AssignmentModule[],
  answers: unknown,
): number {
  if (!answers || typeof answers !== 'object') return 0;
  const map = answers as Record<string, unknown>;
  let count = 0;
  for (const m of modules) {
    if (isAnswered(m, map[m.id])) count += 1;
  }
  return count;
}

function isAnswered(module: AssignmentModule, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'object') return false;

  if (module.type === 'WRITING') {
    const text = (value as { text?: unknown }).text;
    return typeof text === 'string' && text.trim().length > 0;
  }
  if (module.type === 'READING') {
    const responses = (value as { responses?: Record<string, unknown> }).responses;
    if (!responses || typeof responses !== 'object') return false;
    return Object.keys(responses).length > 0;
  }
  // Generic: count any non-empty record / payload as "answered".
  return Object.keys(value).length > 0;
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-ink-soft">
        <span className="font-mono uppercase tracking-[0.18em]">
          Bajarilgan modullar
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft">
        <div
          className="h-full rounded-full bg-blue transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

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
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
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
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-blue">
        Saqlandi{' '}
        {savedAt.toLocaleTimeString('uz-UZ', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
      Avtomatik saqlash har 10 soniyada
    </span>
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

function FormSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-soft" />
      <div className="h-40 animate-pulse rounded-2xl border border-rim bg-canvas" />
      <div className="h-64 animate-pulse rounded-2xl border border-rim bg-canvas" />
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
