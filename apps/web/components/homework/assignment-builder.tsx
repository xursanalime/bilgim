'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { ApiClientError } from '../../lib/api-client';
import { coursesApi, groupsApi, lessonsApi } from '../../lib/api/catalog';
import {
  homeworkFetchers,
  homeworkMutations,
  type AssignmentModuleInput,
  type AvailableModule,
  type HomeworkModuleType,
} from '../../lib/homework-api';
import { MODULE_TYPE_LABELS } from './module-runtimes';
import { AiTestGenerator } from '../ai/ai-test-generator';
import { AI_ENABLED } from '../../lib/features';

interface AssignmentBuilderProps {
  locale: string;
}

interface ModuleDraft {
  /** Stable key for React lists. */
  uid: string;
  type: HomeworkModuleType;
  weight: number;
  configJson: string;
  configError: string | null;
}

/**
 * `/[locale]/homework/new` — AssignmentBuilder (Task 25.4, Req 11.5,
 * 11.8).
 *
 * Lets the teacher pick a Course → Group → Lesson, then assemble one or
 * more `AssignmentModule` entries from the modules currently enabled
 * for that group. The "available module types per group" data comes
 * from the existing GroupModule toggle endpoint:
 *   GET /catalog/groups/:id/modules     → per-group toggle state
 *   GET /homework/available-modules     → specialty catalog
 *
 * The intersection (specialty catalog ∧ enabled-for-group) is what we
 * present in the picker — the same constraint the API enforces.
 */
export function AssignmentBuilder({ locale }: AssignmentBuilderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-selection from query string (?courseId=, ?groupId=, ?lessonId=)
  const initialCourseId = searchParams.get('courseId') ?? '';
  const initialGroupId = searchParams.get('groupId') ?? '';
  const initialLessonId = searchParams.get('lessonId') ?? '';
  // Where "back" and the post-create redirect should return to — set when
  // this builder was opened from a specific lesson page, so creating a
  // homework assignment doesn't strand the teacher on the global list.
  const returnTo = searchParams.get('returnTo');

  const [courseId, setCourseId] = useState(initialCourseId);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [lessonId, setLessonId] = useState(initialLessonId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [totalPoints, setTotalPoints] = useState('100');

  const [modules, setModules] = useState<ModuleDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function applyAiQuestions(
    questions: Array<{ type: 'mcq' | 'true_false' | 'short'; prompt: string; choices?: string[]; answer: string | string[]; explanation?: string }>,
    passage: string,
  ) {
    const configJson = JSON.stringify({
      passage,
      questions: questions.map((q, i) => ({
        id: `ai-q-${Date.now()}-${i}`,
        prompt: q.prompt,
        kind: q.type,
        choices: q.choices,
        answer: q.answer,
      })),
    }, null, 2);

    const hasReading = modules.some((m) => m.type === 'READING');
    if (hasReading) {
      setModules((prev) =>
        prev.map((m) =>
          m.type === 'READING' ? { ...m, configJson, configError: null } : m,
        ),
      );
    } else {
      setModules((prev) => [
        ...prev,
        {
          uid: `ai-reading-${Date.now()}`,
          type: 'READING' as HomeworkModuleType,
          weight: 100,
          configJson,
          configError: null,
        },
      ]);
    }
  }

  // Catalog data
  const coursesSwr = useSWR('builder:courses', () => coursesApi.list());
  const groupsSwr = useSWR(
    courseId ? ['builder:groups', courseId] : null,
    () => groupsApi.listForCourse(courseId),
  );
  const lessonsSwr = useSWR(
    groupId ? ['builder:lessons', groupId] : null,
    () => lessonsApi.listForGroup(groupId),
  );
  const groupModulesSwr = useSWR(
    groupId ? ['builder:group-modules', groupId] : null,
    () => groupsApi.listModules(groupId),
  );
  const specialtyCatalogSwr = useSWR(
    groupId ? ['builder:specialty-catalog', groupId] : null,
    () => homeworkFetchers.availableModules({ groupId }),
  );

  // Derived: the picker shows only modules that are BOTH in the
  // specialty catalog (active=true) AND enabled for the selected group.
  const pickableModuleTypes = useMemo<HomeworkModuleType[]>(() => {
    const enabled = new Set(
      (groupModulesSwr.data ?? [])
        .filter((m) => m.isEnabled)
        .map((m) => m.moduleType as HomeworkModuleType),
    );
    const catalog: AvailableModule[] = specialtyCatalogSwr.data ?? [];
    return catalog
      .filter((m) => m.isActive && enabled.has(m.moduleType))
      .map((m) => m.moduleType);
  }, [groupModulesSwr.data, specialtyCatalogSwr.data]);

  // Reset child selectors when their parent changes.
  useEffect(() => {
    if (!courseId) {
      setGroupId('');
      setLessonId('');
    }
  }, [courseId]);
  useEffect(() => {
    if (!groupId) {
      setLessonId('');
      setModules([]);
    }
  }, [groupId]);

  function addModule(type: HomeworkModuleType) {
    setModules((prev) => [
      ...prev,
      {
        uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        weight: 100,
        configJson: defaultConfigForType(type),
        configError: null,
      },
    ]);
  }

  function removeModule(uid: string) {
    setModules((prev) => prev.filter((m) => m.uid !== uid));
  }

  function moveModule(uid: string, direction: -1 | 1) {
    setModules((prev) => {
      const idx = prev.findIndex((m) => m.uid === uid);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target]!, copy[idx]!];
      return copy;
    });
  }

  function updateModule(uid: string, patch: Partial<ModuleDraft>) {
    setModules((prev) =>
      prev.map((m) => (m.uid === uid ? { ...m, ...patch } : m)),
    );
  }

  function validateModuleConfigs(): AssignmentModuleInput[] | null {
    const out: AssignmentModuleInput[] = [];
    let hasError = false;
    setModules((prev) =>
      prev.map((m, idx) => {
        // 1. Check for client-side validation errors first
        const clientErr = clientValidateModuleConfig(m.type, m.configJson);
        if (clientErr) {
          hasError = true;
          return { ...m, configError: clientErr };
        }
        // 2. Parse JSON
        const trimmed = m.configJson.trim();
        let parsed: unknown = {};
        if (trimmed) {
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            hasError = true;
            return { ...m, configError: "JSON formati noto'g'ri." };
          }
        }
        out.push({ type: m.type, order: idx, configJson: parsed, weight: m.weight });
        return { ...m, configError: null };
      }),
    );
    if (hasError) return null;
    return out;
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!lessonId) {
      setSubmitError('Iltimos, kurs / guruh / dars tanlang.');
      return;
    }
    if (!title.trim()) {
      setSubmitError('Sarlavha bo\u2018sh bo\u2018lishi mumkin emas.');
      return;
    }
    if (modules.length === 0 && !description.trim()) {
      setSubmitError('Talabaga nima qilish kerakligini tushuntiruvchi tavsif yozing.');
      return;
    }
    const moduleInputs = validateModuleConfigs();
    if (!moduleInputs) {
      setSubmitError('Modul sozlamalarida xatolik bor — JSON ni tekshiring.');
      return;
    }

    const points = Number(totalPoints);
    if (!Number.isFinite(points) || !Number.isInteger(points) || points < 1) {
      setSubmitError('Maksimal ball noto\u2018g\u2018ri.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        totalPoints: points,
        modules: moduleInputs,
      };
      const created = await homeworkMutations.createAssignment(
        lessonId,
        payload,
      );
      router.push(
        `/${locale}/homework/${created.id}` +
          (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''),
      );
    } catch (err) {
      if (err instanceof ApiClientError) {
        // Try to extract Zod issue details from backend
        const details = (err as { details?: { index?: number; type?: string; issues?: Array<{ path: (string|number)[]; message: string }> } }).details;
        if (details?.issues?.length) {
          const firstIssue = details.issues[0]!;
          const path = firstIssue.path.join(' → ');
          setSubmitError(`Modul #${(details.index ?? 0) + 1} (${details.type ?? ''}): ${path ? path + ': ' : ''}${firstIssue.message}`);
        } else {
          setSubmitError(err.message);
        }
      } else {
        setSubmitError("Topshiriqni yaratib bo'lmadi.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const courses = coursesSwr.data ?? [];
  const groups = groupsSwr.data ?? [];
  const lessons = lessonsSwr.data ?? [];

  const selectorsLoading =
    coursesSwr.isLoading || (!!courseId && groupsSwr.isLoading);

  const noModulesEnabled =
    !!groupId &&
    !groupModulesSwr.isLoading &&
    !specialtyCatalogSwr.isLoading &&
    pickableModuleTypes.length === 0;

  return (
    <div className="mx-auto max-w-4xl pb-32">
      {/* ── Page header ── */}
      <div className="mb-8">
        <Link
          href={returnTo ?? `/${locale}/homework`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-blue transition-colors mb-4"
        >
          <span>←</span> {returnTo ? 'Darsga qaytish' : 'Barcha topshiriqlar'}
        </Link>
        <h1 className="text-2xl font-black text-ink-strong tracking-tight">
          Yangi topshiriq yaratish
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Kurs va guruhni tanlang, topshiriq ma'lumotlarini kiriting, modullar qo'shing.
        </p>
      </div>

      {coursesSwr.error && (
        <ErrorBanner message="Kurslar ro'yxatini yuklab bo'lmadi." />
      )}

      <div className="space-y-5">
        {/* ── Step 1: Location ── */}
        <Card step={1} title="Joylashuv" subtitle="Kurs → Guruh → Dars">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField
              label="Kurs"
              value={courseId}
              onChange={(v) => { setCourseId(v); setGroupId(''); setLessonId(''); setModules([]); }}
              placeholder={selectorsLoading ? 'Yuklanmoqda...' : 'Kursni tanlang'}
              options={courses.map((c) => ({ value: c.id, label: c.title }))}
            />
            <SelectField
              label="Guruh"
              value={groupId}
              onChange={(v) => { setGroupId(v); setLessonId(''); setModules([]); }}
              placeholder={!courseId ? 'Avval kursni tanlang' : groupsSwr.isLoading ? 'Yuklanmoqda...' : 'Guruhni tanlang'}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              disabled={!courseId}
            />
            <SelectField
              label="Dars"
              value={lessonId}
              onChange={setLessonId}
              placeholder={!groupId ? 'Avval guruhni tanlang' : lessonsSwr.isLoading ? 'Yuklanmoqda...' : 'Darsni tanlang'}
              options={lessons.map((l) => ({ value: l.id, label: l.title }))}
              disabled={!groupId}
            />
          </div>
        </Card>

        {/* ── Step 2: Basic info ── */}
        <Card step={2} title="Asosiy ma'lumot" subtitle="Topshiriq nomi va muddati">
          <div className="space-y-4">
            <FieldGroup label="Sarlavha *">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Masalan: Present Simple Grammar"
                className={inputCls}
              />
            </FieldGroup>
            <FieldGroup
              label={
                modules.length === 0
                  ? "Ko'rsatma *"
                  : "Ko'rsatma (ixtiyoriy)"
              }
            >
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  modules.length === 0
                    ? "Modul qo'shmayapsiz — talabaga nima qilish kerakligini shu yerda tushuntiring (masalan: \"3-bobni o'qib, xulosa yozing\")."
                    : "Talabaga ko'rsatiladigan qo'shimcha ko'rsatmalar..."
                }
                className={inputCls}
              />
            </FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldGroup label="Maksimal ball">
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={totalPoints}
                    onChange={(e) => setTotalPoints(e.target.value)}
                    className={inputCls + ' pr-12'}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-faint">ball</span>
                </div>
              </FieldGroup>
              <FieldGroup label="Muddat (ixtiyoriy)">
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className={inputCls}
                />
              </FieldGroup>
            </div>
          </div>
        </Card>

        {/* ── AI test generator (out of the MVP, behind the AI flag) ── */}
        {AI_ENABLED && lessonId && (
          <AiTestGenerator onApply={applyAiQuestions} />
        )}

        {/* ── Step 3: Modules ── */}
        <Card
          step={3}
          title="Modullar"
          subtitle="Topshiriq qismlarini qo'shing"
          badge={modules.length > 0 ? `${modules.length} ta` : undefined}
        >
          {/* Module picker */}
          {!groupId ? (
            <div className="flex items-center gap-3 rounded-2xl border border-rim bg-tint px-4 py-3.5">
              <div className="h-8 w-8 rounded-xl bg-white border border-rim flex items-center justify-center shrink-0">
                <span className="text-base">📋</span>
              </div>
              <p className="text-sm text-ink-soft">
                Avval guruhni tanlang — modullar guruhga sozlangan ro'yxatdan ko'rsatiladi.
              </p>
            </div>
          ) : groupModulesSwr.isLoading || specialtyCatalogSwr.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[1,2,3,4].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-tint animate-pulse" />
              ))}
            </div>
          ) : noModulesEnabled ? null : (
            <ModulePicker available={pickableModuleTypes} onAdd={addModule} />
          )}

          {/* Module list */}
          {modules.length > 0 && (
            <ol className="space-y-3 mt-4">
              {modules.map((m, idx) => (
                <ModuleEditor
                  key={m.uid}
                  index={idx}
                  module={m}
                  isFirst={idx === 0}
                  isLast={idx === modules.length - 1}
                  onMove={(dir) => moveModule(m.uid, dir)}
                  onRemove={() => removeModule(m.uid)}
                  onChange={(patch) => updateModule(m.uid, patch)}
                />
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* ── Error ── */}
      {submitError && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red/20 bg-red/5 px-4 py-3.5">
          <span className="text-red text-lg mt-0.5">!</span>
          <p className="text-sm text-red font-medium">{submitError}</p>
        </div>
      )}

      {/* ── Sticky action bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-rim bg-white/80 backdrop-blur-xl px-6 py-4 lg:left-72">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-4">
          <div className="text-sm text-ink-soft hidden sm:block">
            {modules.length === 0
              ? `Modulsiz (faqat tavsif) • ${totalPoints || 100} ball`
              : `${modules.length} ta modul • ${totalPoints || 100} ball`
            }
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <Link
              href={`/${locale}/homework`}
              className="rounded-2xl border border-rim bg-white px-5 py-2.5 text-sm font-bold text-ink-soft hover:bg-tint hover:text-ink-strong transition-all"
            >
              Bekor qilish
            </Link>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-2xl bg-blue px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_16px_-4px_rgba(0,113,227,0.5)] transition-all hover:bg-blue/90 hover:scale-[1.02] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saqlanmoqda...' : 'Topshiriq yaratish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

const inputCls = "w-full rounded-2xl border border-rim bg-white px-4 py-2.5 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/30 focus:ring-4 focus:ring-blue/5 transition-all";

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-black uppercase tracking-widest text-ink-soft">{label}</label>
      {children}
    </div>
  );
}

function Card({
  step, title, subtitle, badge, children,
}: {
  step: number; title: string; subtitle?: string | undefined; badge?: string | undefined; children: React.ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-rim bg-white shadow-soft overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-5 border-b border-rim">
        <div className="h-8 w-8 rounded-xl bg-blue flex items-center justify-center shrink-0 shadow-sm shadow-blue/20">
          <span className="text-xs font-black text-white">{step}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black text-ink-strong leading-none">{title}</h2>
          {subtitle && <p className="text-[11px] text-ink-faint mt-0.5">{subtitle}</p>}
        </div>
        {badge && (
          <span className="shrink-0 rounded-full bg-blue/10 border border-blue/20 px-2.5 py-0.5 text-[11px] font-black text-blue">
            {badge}
          </span>
        )}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <FieldGroup label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={inputCls + (value ? ' text-ink-strong' : ' text-ink-faint') + ' disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-tint'}
      >
        <option value="" className="text-ink-faint">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldGroup>
  );
}

const MODULE_ICONS: Partial<Record<HomeworkModuleType, string>> = {
  WRITING: '✍️', READING: '📖', LISTENING: '🎧', GRAMMAR: '📐',
  VOCABULARY: '🃏', SPEAKING: '🎤', PRONUNCIATION: '🔊', GAP_FILL: '🧩',
  MULTIPLE_CHOICE: '☑️', MATCHING: '🔗', SPELLING: '🔤',
};

function ModulePicker({
  available,
  onAdd,
}: {
  available: HomeworkModuleType[];
  onAdd: (type: HomeworkModuleType) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-ink-faint">
        Modul qo'shish uchun bosing
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {available.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onAdd(type)}
            className="flex items-center gap-2.5 rounded-2xl border border-rim bg-tint px-3.5 py-3 text-left text-sm font-bold text-ink-strong hover:border-blue/25 hover:bg-blue/5 hover:text-blue transition-all active:scale-[0.97] group"
          >
            <span className="text-base shrink-0">{MODULE_ICONS[type] ?? '📝'}</span>
            <span className="truncate text-xs">{MODULE_TYPE_LABELS[type] ?? type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Per-module visual config forms ─────────────────────────────────

function WritingConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <FormField label="Ko'rsatma (prompt)">
        <textarea rows={3} value={String(cfg.prompt ?? '')}
          onChange={(e) => onChange({ ...cfg, prompt: e.target.value })}
          placeholder="Talabaga ko'rsatma yozing..." className={fldCls} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Min so'z">
          <input type="number" min={1} value={Number(cfg.minWords ?? 50)}
            onChange={(e) => onChange({ ...cfg, minWords: Number(e.target.value) })} className={fldCls} />
        </FormField>
        <FormField label="Max so'z">
          <input type="number" min={1} value={Number(cfg.maxWords ?? 500)}
            onChange={(e) => onChange({ ...cfg, maxWords: Number(e.target.value) })} className={fldCls} />
        </FormField>
      </div>
    </div>
  );
}

function ReadingConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const questions: Array<Record<string, unknown>> = Array.isArray(cfg.questions) ? (cfg.questions as Array<Record<string, unknown>>) : [];

  const addQ = () => onChange({ ...cfg, questions: [...questions, { id: `q${Date.now()}`, prompt: '', kind: 'mcq', choices: ['', '', '', ''], answer: '' }] });
  const removeQ = (i: number) => onChange({ ...cfg, questions: questions.filter((_, j) => j !== i) });
  const updateQ = (i: number, patch: Record<string, unknown>) => {
    const next = questions.map((q, j) => j === i ? { ...q, ...patch } : q);
    onChange({ ...cfg, questions: next });
  };

  return (
    <div className="space-y-4">
      <FormField label="Matn (passage)">
        <textarea rows={5} value={String(cfg.passage ?? '')}
          onChange={(e) => onChange({ ...cfg, passage: e.target.value })}
          placeholder="O'qish matni..." className={fldCls} />
      </FormField>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={lblCls}>Savollar</span>
          <button type="button" onClick={addQ} className={addBtnCls}>+ Savol qo'shish</button>
        </div>
        {questions.map((q, i) => (
          <div key={i} className="rounded-xl border border-rim bg-tint p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">{i + 1}-savol</span>
              <button type="button" onClick={() => removeQ(i)} className="text-[11px] text-red/60 hover:text-red">O'chirish</button>
            </div>
            <textarea rows={2} value={String(q.prompt ?? '')}
              onChange={(e) => updateQ(i, { prompt: e.target.value })}
              placeholder="Savol matni..." className={fldCls} />
            <select value={String(q.kind ?? 'mcq')}
              onChange={(e) => updateQ(i, { kind: e.target.value })}
              className={fldCls}>
              <option value="mcq">Ko'p tanlovli (MCQ)</option>
              <option value="true_false">To'g'ri / Noto'g'ri</option>
              <option value="short">Qisqa javob</option>
            </select>
            {String(q.kind ?? 'mcq') === 'mcq' && (
              <div className="space-y-1">
                <span className={lblCls}>Variantlar</span>
                {(Array.isArray(q.choices) ? q.choices as string[] : ['', '', '', '']).map((c, ci) => (
                  <input key={ci} type="text" value={c}
                    onChange={(e) => {
                      const ch = [...(Array.isArray(q.choices) ? q.choices as string[] : ['', '', '', ''])];
                      ch[ci] = e.target.value;
                      updateQ(i, { choices: ch });
                    }}
                    placeholder={`${ci + 1}-variant`} className={fldCls} />
                ))}
                <FormField label="To'g'ri javob">
                  <input type="text" value={String(q.answer ?? '')}
                    onChange={(e) => updateQ(i, { answer: e.target.value })}
                    placeholder="To'g'ri variant matni" className={fldCls} />
                </FormField>
              </div>
            )}
            {String(q.kind ?? 'mcq') === 'true_false' && (
              <select value={String(q.answer ?? 'true')}
                onChange={(e) => updateQ(i, { answer: e.target.value })} className={fldCls}>
                <option value="true">To'g'ri</option>
                <option value="false">Noto'g'ri</option>
              </select>
            )}
            {String(q.kind ?? 'mcq') === 'short' && (
              <FormField label="Kutilayotgan javob">
                <input type="text" value={String(q.answer ?? '')}
                  onChange={(e) => updateQ(i, { answer: e.target.value })} className={fldCls} />
              </FormField>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListeningConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const questions: Array<Record<string, unknown>> = Array.isArray(cfg.questions) ? (cfg.questions as Array<Record<string, unknown>>) : [];
  const addQ = () => onChange({ ...cfg, questions: [...questions, { id: `q${Date.now()}`, prompt: '', kind: 'mcq', choices: ['', '', ''], answer: '' }] });
  const removeQ = (i: number) => onChange({ ...cfg, questions: questions.filter((_, j) => j !== i) });
  const updateQ = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...cfg, questions: questions.map((q, j) => j === i ? { ...q, ...patch } : q) });

  return (
    <div className="space-y-3">
      <FormField label="Audio URL">
        <input type="url" value={String(cfg.audioUrl ?? '')}
          onChange={(e) => onChange({ ...cfg, audioUrl: e.target.value })}
          placeholder="https://..." className={fldCls} />
      </FormField>
      <FormField label="Transkripsiya (ixtiyoriy)">
        <textarea rows={3} value={String(cfg.transcript ?? '')}
          onChange={(e) => onChange({ ...cfg, transcript: e.target.value })}
          placeholder="Audio matni..." className={fldCls} />
      </FormField>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
          <input type="checkbox" checked={Boolean(cfg.allowTranscript)}
            onChange={(e) => onChange({ ...cfg, allowTranscript: e.target.checked })} className="accent-blue" />
          Transkripsiyani ko'rsatishga ruxsat
        </label>
        <FormField label="Max tinglash soni">
          <input type="number" min={1} max={10} value={Number(cfg.listenCount ?? 3)}
            onChange={(e) => onChange({ ...cfg, listenCount: Number(e.target.value) })} className={fldCls} />
        </FormField>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={lblCls}>Savollar</span>
          <button type="button" onClick={addQ} className={addBtnCls}>+ Savol</button>
        </div>
        {questions.map((q, i) => (
          <div key={i} className="rounded-xl border border-rim p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-[10px] text-white/30">{i + 1}</span>
              <button type="button" onClick={() => removeQ(i)} className="text-[11px] text-red/60 hover:text-red">O'chirish</button>
            </div>
            <input type="text" value={String(q.prompt ?? '')}
              onChange={(e) => updateQ(i, { prompt: e.target.value })} placeholder="Savol..." className={fldCls} />
            <select value={String(q.kind ?? 'mcq')} onChange={(e) => updateQ(i, { kind: e.target.value })} className={fldCls}>
              <option value="mcq">MCQ</option>
              <option value="true_false">To'g'ri/Noto'g'ri</option>
              <option value="short">Qisqa javob</option>
            </select>
            {String(q.kind ?? 'mcq') === 'mcq' && (
              (Array.isArray(q.choices) ? q.choices as string[] : ['', '', '']).map((c, ci) => (
                <input key={ci} type="text" value={c}
                  onChange={(e) => {
                    const ch = [...(Array.isArray(q.choices) ? q.choices as string[] : ['', '', ''])];
                    ch[ci] = e.target.value;
                    updateQ(i, { choices: ch });
                  }} placeholder={`${ci + 1}-variant`} className={fldCls} />
              ))
            )}
            <input type="text" value={String(q.answer ?? '')}
              onChange={(e) => updateQ(i, { answer: e.target.value })} placeholder="To'g'ri javob" className={fldCls} />
          </div>
        ))}
      </div>
    </div>
  );
}

function VocabularyConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const cards: Array<Record<string, unknown>> = Array.isArray(cfg.cards) ? (cfg.cards as Array<Record<string, unknown>>) : [];
  const addCard = () => onChange({ ...cfg, cards: [...cards, { id: `c${Date.now()}`, word: '', translation: '', example: '', partOfSpeech: 'noun' }] });
  const removeCard = (i: number) => onChange({ ...cfg, cards: cards.filter((_, j) => j !== i) });
  const updateCard = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...cfg, cards: cards.map((c, j) => j === i ? { ...c, ...patch } : c) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={lblCls}>So'zlar ro'yxati</span>
        <button type="button" onClick={addCard} className={addBtnCls}>+ So'z qo'shish</button>
      </div>
      {cards.map((card, i) => (
        <div key={i} className="rounded-xl border border-rim bg-tint p-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-[10px] text-white/30">{i + 1}-karta</span>
            <button type="button" onClick={() => removeCard(i)} className="text-[11px] text-red/60 hover:text-red">O'chirish</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={String(card.word ?? '')}
              onChange={(e) => updateCard(i, { word: e.target.value })} placeholder="Inglizcha so'z" className={fldCls} />
            <input type="text" value={String(card.translation ?? '')}
              onChange={(e) => updateCard(i, { translation: e.target.value })} placeholder="Tarjimasi" className={fldCls} />
          </div>
          <input type="text" value={String(card.example ?? '')}
            onChange={(e) => updateCard(i, { example: e.target.value })} placeholder="Misol jumla (ixtiyoriy)" className={fldCls} />
          <select value={String(card.partOfSpeech ?? 'noun')}
            onChange={(e) => updateCard(i, { partOfSpeech: e.target.value })} className={fldCls}>
            {['noun','verb','adjective','adverb','phrase','idiom'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      ))}
      {cards.length === 0 && (
        <p className="text-center text-xs text-white/30 py-4">Hali so'z yo'q — "So'z qo'shish" tugmasini bosing</p>
      )}
    </div>
  );
}

function GrammarConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const rule = (cfg.rule as Record<string, unknown> | undefined) ?? {};
  const exercises: Array<Record<string, unknown>> = Array.isArray(cfg.exercises) ? (cfg.exercises as Array<Record<string, unknown>>) : [];
  const setRule = (patch: Record<string, unknown>) => onChange({ ...cfg, rule: { ...rule, ...patch } });
  const addEx = () => onChange({ ...cfg, exercises: [...exercises, { id: `ex${Date.now()}`, type: 'choose_correct', prompt: '', options: ['', ''], answer: '' }] });
  const removeEx = (i: number) => onChange({ ...cfg, exercises: exercises.filter((_, j) => j !== i) });
  const updateEx = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...cfg, exercises: exercises.map((e, j) => j === i ? { ...e, ...patch } : e) });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue/20 bg-blue/5 p-4 space-y-3">
        <span className={lblCls}>Grammatika qoidasi</span>
        <input type="text" value={String(rule.title ?? '')}
          onChange={(e) => setRule({ title: e.target.value })} placeholder="Qoida nomi (masalan: Present Simple)" className={fldCls} />
        <textarea rows={3} value={String(rule.explanation ?? '')}
          onChange={(e) => setRule({ explanation: e.target.value })} placeholder="Qoidaning tushuntirishi..." className={fldCls} />
        <input type="text" value={String(rule.formula ?? '')}
          onChange={(e) => setRule({ formula: e.target.value })} placeholder="Formula (masalan: Subject + Verb + s/es)" className={fldCls} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={lblCls}>Mashqlar</span>
          <button type="button" onClick={addEx} className={addBtnCls}>+ Mashq</button>
        </div>
        {exercises.map((ex, i) => (
          <div key={i} className="rounded-xl border border-rim p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-[10px] text-white/30">{i + 1}</span>
              <button type="button" onClick={() => removeEx(i)} className="text-[11px] text-red/60 hover:text-red">O'chirish</button>
            </div>
            <select value={String(ex.type ?? 'choose_correct')} onChange={(e) => updateEx(i, { type: e.target.value })} className={fldCls}>
              <option value="choose_correct">To'g'risini tanlang</option>
              <option value="fill_blank">Bo'sh joyni to'ldiring</option>
              <option value="error_correction">Xatoni toping</option>
              <option value="transformation">O'zgartiring</option>
            </select>
            <textarea rows={2} value={String(ex.prompt ?? '')}
              onChange={(e) => updateEx(i, { prompt: e.target.value })} placeholder="Mashq matni..." className={fldCls} />
            {String(ex.type ?? 'choose_correct') === 'choose_correct' && (
              <div className="space-y-1">
                <span className="text-[10px] text-white/30">Variantlar:</span>
                {(Array.isArray(ex.options) ? ex.options as string[] : ['', '']).map((o, oi) => (
                  <input key={oi} type="text" value={o}
                    onChange={(e) => {
                      const ops = [...(Array.isArray(ex.options) ? ex.options as string[] : ['', ''])];
                      ops[oi] = e.target.value;
                      updateEx(i, { options: ops });
                    }} placeholder={`${oi + 1}-variant`} className={fldCls} />
                ))}
                <button type="button" onClick={() => updateEx(i, { options: [...(Array.isArray(ex.options) ? ex.options as string[] : []), ''] })} className={addBtnCls}>+ Variant</button>
              </div>
            )}
            <input type="text" value={String(ex.answer ?? '')}
              onChange={(e) => updateEx(i, { answer: e.target.value })} placeholder="To'g'ri javob" className={fldCls} />
            <input type="text" value={String(ex.explanation ?? '')}
              onChange={(e) => updateEx(i, { explanation: e.target.value })} placeholder="Izoh (ixtiyoriy)" className={fldCls} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeakingConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const tasks: Array<Record<string, unknown>> = Array.isArray(cfg.tasks) ? (cfg.tasks as Array<Record<string, unknown>>) : [];
  const addTask = () => onChange({ ...cfg, tasks: [...tasks, { id: `t${Date.now()}`, prompt: '', targetText: '', hint: '' }] });
  const removeTask = (i: number) => onChange({ ...cfg, tasks: tasks.filter((_, j) => j !== i) });
  const updateTask = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...cfg, tasks: tasks.map((t, j) => j === i ? { ...t, ...patch } : t) });

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
        <input type="checkbox" checked={Boolean(cfg.showTargetText)}
          onChange={(e) => onChange({ ...cfg, showTargetText: e.target.checked })} className="accent-blue" />
        Aytish kerak bo'lgan matnni ko'rsatish
      </label>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={lblCls}>Vazifalar</span>
          <button type="button" onClick={addTask} className={addBtnCls}>+ Vazifa</button>
        </div>
        {tasks.map((task, i) => (
          <div key={i} className="rounded-xl border border-rim p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-[10px] text-white/30">{i + 1}</span>
              <button type="button" onClick={() => removeTask(i)} className="text-[11px] text-red/60 hover:text-red">O'chirish</button>
            </div>
            <input type="text" value={String(task.prompt ?? '')}
              onChange={(e) => updateTask(i, { prompt: e.target.value })} placeholder="Topshiriq (masalan: 'O'zingizni tanishtiring')" className={fldCls} />
            <input type="text" value={String(task.targetText ?? '')}
              onChange={(e) => updateTask(i, { targetText: e.target.value })} placeholder="Aytish kerak bo'lgan matn (inglizcha)" className={fldCls} />
            <input type="text" value={String(task.hint ?? '')}
              onChange={(e) => updateTask(i, { hint: e.target.value })} placeholder="Yordam matni (ixtiyoriy)" className={fldCls} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GapFillConfigForm({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const sentences: Array<Record<string, unknown>> = Array.isArray(cfg.sentences) ? (cfg.sentences as Array<Record<string, unknown>>) : [];
  const addSentence = () => onChange({ ...cfg, sentences: [...sentences, { id: `s${Date.now()}`, template: '', answers: [''], wordBank: [] }] });
  const removeSentence = (i: number) => onChange({ ...cfg, sentences: sentences.filter((_, j) => j !== i) });
  const updateSentence = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...cfg, sentences: sentences.map((s, j) => j === i ? { ...s, ...patch } : s) });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={lblCls}>Rejim</span>
          <select value={String(cfg.mode ?? 'type')} onChange={(e) => onChange({ ...cfg, mode: e.target.value })} className={fldCls}>
            <option value="type">Yozib to'ldirish</option>
            <option value="choose">So'z bankidan tanlash</option>
          </select>
        </div>
        <div className="flex items-center pt-5">
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input type="checkbox" checked={Boolean(cfg.showWordBank)}
              onChange={(e) => onChange({ ...cfg, showWordBank: e.target.checked })} className="accent-blue" />
            So'z bankini ko'rsatish
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={lblCls}>Jumlalar (bo'sh joy = ___)</span>
          <button type="button" onClick={addSentence} className={addBtnCls}>+ Jumla</button>
        </div>
        {sentences.map((s, i) => (
          <div key={i} className="rounded-xl border border-rim p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-[10px] text-white/30">{i + 1}</span>
              <button type="button" onClick={() => removeSentence(i)} className="text-[11px] text-red/60 hover:text-red">O'chirish</button>
            </div>
            <input type="text" value={String(s.template ?? '')}
              onChange={(e) => updateSentence(i, { template: e.target.value })}
              placeholder="She ___ to school every day." className={fldCls} />
            <input type="text"
              value={Array.isArray(s.answers) ? (s.answers as string[]).join(', ') : ''}
              onChange={(e) => updateSentence(i, { answers: e.target.value.split(',').map((a) => a.trim()) })}
              placeholder="To'g'ri javoblar (vergul bilan ajratiing): goes" className={fldCls} />
            <input type="text"
              value={Array.isArray(s.wordBank) ? (s.wordBank as string[]).join(', ') : ''}
              onChange={(e) => updateSentence(i, { wordBank: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) })}
              placeholder="So'z banki (ixtiyoriy): goes, go, went, gone" className={fldCls} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared style helpers (light design)
const fldCls = "w-full rounded-xl border border-rim bg-white px-3 py-2.5 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/30 focus:ring-2 focus:ring-blue/5 transition-all";
const lblCls = "text-[10px] font-black uppercase tracking-widest text-ink-soft block mb-1.5";
const addBtnCls = "text-[11px] font-black text-blue border border-blue/20 rounded-xl px-3 py-1.5 hover:bg-blue/5 transition-all active:scale-95";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className={lblCls}>{label}</span>
      {children}
    </div>
  );
}

// ── Module config dispatcher ────────────────────────────────────────

function ModuleConfigForm({ type, cfg, onChange }: { type: HomeworkModuleType; cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  switch (type) {
    case 'WRITING': return <WritingConfigForm cfg={cfg} onChange={onChange} />;
    case 'READING': return <ReadingConfigForm cfg={cfg} onChange={onChange} />;
    case 'LISTENING': return <ListeningConfigForm cfg={cfg} onChange={onChange} />;
    case 'VOCABULARY': return <VocabularyConfigForm cfg={cfg} onChange={onChange} />;
    case 'GRAMMAR': return <GrammarConfigForm cfg={cfg} onChange={onChange} />;
    case 'SPEAKING':
    case 'PRONUNCIATION': return <SpeakingConfigForm cfg={cfg} onChange={onChange} />;
    case 'GAP_FILL': return <GapFillConfigForm cfg={cfg} onChange={onChange} />;
    default:
      return (
        <p className="text-xs text-white/40 italic">
          Bu modul uchun visual sozlama hali mavjud emas. Qo'lda JSON yozish ham mumkin.
        </p>
      );
  }
}

// ── Module editor ───────────────────────────────────────────────────

function ModuleEditor({
  index, module, isFirst, isLast, onMove, onRemove, onChange,
}: {
  index: number; module: ModuleDraft; isFirst: boolean; isLast: boolean;
  onMove: (direction: -1 | 1) => void; onRemove: () => void;
  onChange: (patch: Partial<ModuleDraft>) => void;
}) {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(module.configJson || '{}'); } catch { cfg = {}; }

  return (
    <li className="rounded-[1.5rem] border border-rim bg-white shadow-soft overflow-hidden">
      {/* Module header */}
      <div className="flex items-center gap-3 px-5 py-3.5 bg-tint border-b border-rim">
        <span className="h-6 w-6 rounded-lg bg-white border border-rim flex items-center justify-center text-xs font-black text-ink-soft shadow-sm">
          {index + 1}
        </span>
        <span className="text-base">{MODULE_ICONS[module.type] ?? '📝'}</span>
        <span className="text-sm font-black text-ink-strong">
          {MODULE_TYPE_LABELS[module.type] ?? module.type}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={isFirst}
            className="h-7 w-7 rounded-xl border border-rim bg-white flex items-center justify-center text-xs text-ink-soft hover:text-ink-strong disabled:opacity-30 transition-all">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast}
            className="h-7 w-7 rounded-xl border border-rim bg-white flex items-center justify-center text-xs text-ink-soft hover:text-ink-strong disabled:opacity-30 transition-all">↓</button>
          <button type="button" onClick={onRemove}
            className="h-7 px-2.5 rounded-xl border border-red/20 bg-red/5 text-[11px] font-black text-red hover:bg-red/10 transition-all">
            O&apos;chirish
          </button>
        </div>
      </div>

      {/* Weight + config */}
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-36">
            <span className={lblCls}>Ball ulushi</span>
            <div className="relative">
              <input type="number" min={1} max={1000} value={module.weight}
                onChange={(e) => onChange({ weight: Number(e.target.value) || 1 })}
                className={fldCls + ' pr-10'} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint font-bold">%</span>
            </div>
          </div>
        </div>

        <div className="border-t border-rim pt-4">
          <ModuleConfigForm
            type={module.type}
            cfg={cfg}
            onChange={(next) => onChange({ configJson: JSON.stringify(next, null, 2), configError: null })}
          />
        </div>

        {module.configError && (
          <p className="text-xs text-red font-medium">{module.configError}</p>
        )}
      </div>
    </li>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red/20 bg-red/5 px-4 py-3.5">
      <span className="text-red font-black mt-0.5">!</span>
      <p className="text-sm text-red">{message}</p>
    </div>
  );
}

/**
 * Best-effort default config skeleton per module type so the teacher
 * has something to edit instead of an empty `{}`. The server validates
 * the actual shape per module-type runtime, so the defaults below are
 * intentionally minimal and forgiving.
 */
function defaultConfigForType(type: HomeworkModuleType): string {
  switch (type) {
    case 'WRITING':
      return JSON.stringify({ prompt: '', minWords: 100, maxWords: 500 }, null, 2);
    case 'READING':
      // passage min(1) + questions min(1) — teacher must fill in before saving
      return JSON.stringify({ passage: '', questions: [] }, null, 2);
    case 'LISTENING':
      return JSON.stringify({ audioUrl: '', transcript: '', allowTranscript: false, listenCount: 3, questions: [] }, null, 2);
    case 'VOCABULARY':
      return JSON.stringify({ cards: [], studyMode: 'flashcard' }, null, 2);
    case 'GRAMMAR':
      return JSON.stringify({ rule: { title: '', explanation: '', formula: '', examples: [] }, exercises: [] }, null, 2);
    case 'SPEAKING':
    case 'PRONUNCIATION':
      return JSON.stringify({ tasks: [], showTargetText: true }, null, 2);
    case 'GAP_FILL':
      return JSON.stringify({ sentences: [], mode: 'type', showWordBank: true }, null, 2);
    default:
      return JSON.stringify({}, null, 2);
  }
}

/**
 * Frontend pre-validation — checks common issues before sending to API.
 * Returns an error message string or null if OK.
 */
function clientValidateModuleConfig(
  type: HomeworkModuleType,
  configJson: string,
): string | null {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(configJson || '{}'); } catch { return 'JSON formati noto\'g\'ri.'; }

  switch (type) {
    case 'WRITING': {
      if (!String(cfg.prompt ?? '').trim()) return 'Ko\'rsatma (prompt) maydoni bo\'sh bo\'lishi mumkin emas.';
      return null;
    }
    case 'READING': {
      if (!String(cfg.passage ?? '').trim()) return 'O\'qish matni (passage) bo\'sh bo\'lishi mumkin emas.';
      const questions = Array.isArray(cfg.questions) ? cfg.questions as Array<Record<string, unknown>> : [];
      if (questions.length === 0) return 'Kamida bitta savol qo\'shing.';
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]!;
        if (!String(q.prompt ?? '').trim()) return `${i + 1}-savol: savol matni bo\'sh.`;
        if (!q.kind) return `${i + 1}-savol: savol turini tanlang.`;
        if (q.kind === 'mcq') {
          const choices = Array.isArray(q.choices) ? (q.choices as string[]).filter(Boolean) : [];
          if (choices.length < 2) return `${i + 1}-savol (MCQ): kamida 2 ta variant kerak.`;
          if (!String(q.answer ?? '').trim()) return `${i + 1}-savol (MCQ): to\'g\'ri javobni belgilang.`;
          if (!choices.includes(String(q.answer))) return `${i + 1}-savol (MCQ): to\'g\'ri javob variantlar ichida bo\'lishi kerak.`;
        }
        if (q.kind === 'true_false') {
          if (q.answer !== 'true' && q.answer !== 'false') return `${i + 1}-savol: To\'g\'ri yoki Noto\'g\'ri ni tanlang.`;
        }
      }
      return null;
    }
    case 'LISTENING': {
      if (!String(cfg.audioUrl ?? '').trim()) return 'Audio URL kiritish majburiy.';
      return null;
    }
    case 'VOCABULARY': {
      const cards = Array.isArray(cfg.cards) ? cfg.cards as Array<Record<string, unknown>> : [];
      if (cards.length === 0) return 'Kamida bitta so\'z (karta) qo\'shing.';
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i]!;
        if (!String(c.word ?? '').trim()) return `${i + 1}-karta: inglizcha so\'z bo\'sh.`;
        if (!String(c.translation ?? '').trim()) return `${i + 1}-karta: tarjimasi bo\'sh.`;
      }
      return null;
    }
    case 'GRAMMAR': {
      const rule = (cfg.rule as Record<string, unknown> | undefined) ?? {};
      if (!String(rule.title ?? '').trim()) return 'Grammatika qoidasi nomini kiriting.';
      if (!String(rule.explanation ?? '').trim()) return 'Qoida tushuntirishini kiriting.';
      return null;
    }
    case 'SPEAKING':
    case 'PRONUNCIATION': {
      const tasks = Array.isArray(cfg.tasks) ? cfg.tasks as Array<Record<string, unknown>> : [];
      if (tasks.length === 0) return 'Kamida bitta gapirish vazifasi qo\'shing.';
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i]!;
        if (!String(t.targetText ?? '').trim()) return `${i + 1}-vazifa: aytish kerak bo\'lgan matnni kiriting.`;
      }
      return null;
    }
    case 'GAP_FILL': {
      const sentences = Array.isArray(cfg.sentences) ? cfg.sentences as Array<Record<string, unknown>> : [];
      if (sentences.length === 0) return 'Kamida bitta jumla qo\'shing.';
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i]!;
        if (!String(s.template ?? '').includes('___')) return `${i + 1}-jumla: ___ belgisi qo\'shing (bo\'sh joy).`;
        const answers = Array.isArray(s.answers) ? (s.answers as string[]).filter(Boolean) : [];
        if (answers.length === 0) return `${i + 1}-jumla: to\'g\'ri javob kiriting.`;
      }
      return null;
    }
    default:
      return null;
  }
}
