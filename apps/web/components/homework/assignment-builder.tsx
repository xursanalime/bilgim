'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { forwardRef, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';

import { ApiClientError } from '../../lib/api-client';
import { coursesApi, groupsApi, lessonsApi } from '../../lib/api/catalog';
import {
  homeworkApi,
  isLanguageSkillModuleType,
  type AssignmentModuleInput,
  type CreateAssignmentPayload,
  type LanguageSkillModuleType,
} from '../../lib/api/homework';
import {
  BuilderSchema,
  buildModuleConfig,
  type BuilderInput,
  type BuilderValues,
} from './assignment-builder-config';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { FormField, Label } from '../ui/form-field';
import { Input, Textarea } from '../ui/input';
import { Select } from '../ui/select';
import { toast } from '../ui/toast';
import { ErrorState, LoadingState } from '../states';

interface AssignmentBuilderProps {
  locale: string;
}

// ── Per-skill metadata (the eight English language skills, Req 10.1) ──

interface SkillMeta {
  label: string;
  icon: string;
  /** Short helper line shown under the module picker. */
  blurb: string;
}

const SKILL_META: Record<LanguageSkillModuleType, SkillMeta> = {
  WRITING: { label: 'Yozma ish', icon: '✍️', blurb: 'Insho yoki matn yozish topshirig\u2018i.' },
  READING: { label: 'O\u2018qish', icon: '📖', blurb: 'Matn + tushunish savollari.' },
  LISTENING: { label: 'Tinglash', icon: '🎧', blurb: 'Audio + tinglab tushunish.' },
  GRAMMAR: { label: 'Grammatika', icon: '📐', blurb: 'Qoida + mashqlar.' },
  VOCABULARY: { label: 'Lug\u2018at', icon: '🃏', blurb: 'So\u2018z kartalari (flashcard).' },
  SPELLING: { label: 'Imlo', icon: '🔤', blurb: 'To\u2018g\u2018ri yozish mashqi.' },
  SPEAKING: { label: 'Gapirish', icon: '🎤', blurb: 'Ovozli javob topshirig\u2018i.' },
  PRONUNCIATION: { label: 'Talaffuz', icon: '🔊', blurb: 'Talaffuzni baholash.' },
};

// ── Component ──────────────────────────────────────────────────────────

/**
 * `/[locale]/homework/new` — Teacher AssignmentBuilder (Req 10.1).
 *
 * The instructor picks Course → Group → Lesson, then a single English
 * language-skill module (one of the eight) that is currently enabled for
 * the group, sets a due date + points, and fills the skill-specific prompt
 * fields. Only modules with `GroupModule.isEnabled === true` (and within the
 * eight-skill set) are offered. The backend re-validates both constraints
 * (see `lib/api/homework.ts` — `LANGUAGE_SKILL_MODULE_TYPES`).
 */
export function AssignmentBuilder({ locale }: AssignmentBuilderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BuilderInput, unknown, BuilderValues>({
    resolver: zodResolver(BuilderSchema),
    defaultValues: {
      courseId: searchParams.get('courseId') ?? '',
      groupId: searchParams.get('groupId') ?? '',
      lessonId: searchParams.get('lessonId') ?? '',
      moduleType: '',
      title: '',
      description: '',
      dueAt: '',
      totalPoints: 100,
      prompt: '',
      passage: '',
      audioUrl: '',
      transcript: '',
      ruleTitle: '',
      ruleExplanation: '',
      words: '',
      targetText: '',
      studyMode: 'flashcard',
    },
  });

  const courseId = watch('courseId');
  const groupId = watch('groupId');
  const moduleType = watch('moduleType');

  // ── Catalog reads (cascading) ──
  const coursesSwr = useQuery({
    queryKey: ['catalog', 'courses'],
    queryFn: () => coursesApi.list(),
  });
  const groupsSwr = useQuery({
    queryKey: ['catalog', 'course', courseId, 'groups'],
    queryFn: () => groupsApi.listForCourse(courseId),
    enabled: Boolean(courseId),
  });
  const lessonsSwr = useQuery({
    queryKey: ['catalog', 'group', groupId, 'lessons'],
    queryFn: () => lessonsApi.listForGroup(groupId),
    enabled: Boolean(groupId),
  });
  const modulesSwr = useQuery({
    queryKey: ['catalog', 'group', groupId, 'modules'],
    queryFn: () => groupsApi.listModules(groupId),
    enabled: Boolean(groupId),
  });

  // Reset dependent selections when a parent changes.
  useEffect(() => {
    setValue('groupId', '');
    setValue('lessonId', '');
    setValue('moduleType', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);
  useEffect(() => {
    setValue('lessonId', '');
    setValue('moduleType', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Modules offered = enabled for the group ∧ within the eight skills.
  const enabledSkills = useMemo<LanguageSkillModuleType[]>(() => {
    const mods = modulesSwr.data ?? [];
    return mods
      .filter((m) => m.isEnabled && isLanguageSkillModuleType(m.moduleType))
      .map((m) => m.moduleType as LanguageSkillModuleType);
  }, [modulesSwr.data]);

  const noModulesEnabled =
    !!groupId &&
    !modulesSwr.isLoading &&
    !modulesSwr.error &&
    enabledSkills.length === 0;

  async function onSubmit(values: BuilderValues) {
    const module: AssignmentModuleInput = {
      type: values.moduleType as LanguageSkillModuleType,
      order: 0,
      configJson: buildModuleConfig(values),
      weight: 100,
    };

    const payload: CreateAssignmentPayload = {
      title: values.title.trim(),
      ...(values.description?.trim()
        ? { description: values.description.trim() }
        : {}),
      ...(values.dueAt ? { dueAt: new Date(values.dueAt).toISOString() } : {}),
      totalPoints: values.totalPoints,
      modules: [module],
    };

    try {
      const created = await homeworkApi.createForLesson(values.lessonId, payload);
      toast.success('Topshiriq yaratildi');
      router.push(`/${locale}/homework/${created.id}`);
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        /MODULE_TYPE_NOT_SUPPORTED|enabled/i.test(err.message)
      ) {
        setError('moduleType', { message: 'Bu modul guruh uchun yoqilmagan.' });
        toast.error('Tanlangan modul bu guruh uchun mavjud emas.');
        return;
      }
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : 'Topshiriqni yaratib bo\u2018lmadi.',
      );
    }
  }

  if (coursesSwr.error) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <ErrorState
          title="Kurslarni yuklab bo\u2018lmadi"
          message="Iltimos, sahifani yangilang yoki keyinroq urinib ko\u2018ring."
          onRetry={() => void coursesSwr.refetch()}
        />
      </div>
    );
  }

  const courses = coursesSwr.data ?? [];
  const groups = groupsSwr.data ?? [];
  const lessons = lessonsSwr.data ?? [];

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mx-auto max-w-3xl space-y-6 pb-12"
    >
      <div>
        <Link
          href={`/${locale}/homework`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-blue"
        >
          <ArrowLeft className="h-4 w-4" /> Barcha topshiriqlar
        </Link>
        <h1 className="text-2xl font-black tracking-tight text-ink-strong">
          Yangi topshiriq
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Kurs, guruh va darsni tanlang, so&apos;ngra guruh uchun yoqilgan ingliz
          tili skill modulidan topshiriq tuzing.
        </p>
      </div>

      {/* ── Step 1: location ── */}
      <Card>
        <CardHeader>
          <CardTitle>1. Joylashuv</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ab-course" required>
              Kurs
            </Label>
            <Select
              id="ab-course"
              error={!!errors.courseId}
              disabled={coursesSwr.isLoading}
              {...register('courseId')}
            >
              <option value="">
                {coursesSwr.isLoading ? 'Yuklanmoqda…' : 'Kursni tanlang'}
              </option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            {errors.courseId && (
              <p className="text-xs font-medium text-red">
                {errors.courseId.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ab-group" required>
              Guruh
            </Label>
            <Select
              id="ab-group"
              error={!!errors.groupId}
              disabled={!courseId || groupsSwr.isLoading}
              {...register('groupId')}
            >
              <option value="">
                {!courseId
                  ? 'Avval kursni tanlang'
                  : groupsSwr.isLoading
                    ? 'Yuklanmoqda…'
                    : 'Guruhni tanlang'}
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            {errors.groupId && (
              <p className="text-xs font-medium text-red">
                {errors.groupId.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ab-lesson" required>
              Dars
            </Label>
            <Select
              id="ab-lesson"
              error={!!errors.lessonId}
              disabled={!groupId || lessonsSwr.isLoading}
              {...register('lessonId')}
            >
              <option value="">
                {!groupId
                  ? 'Avval guruhni tanlang'
                  : lessonsSwr.isLoading
                    ? 'Yuklanmoqda…'
                    : 'Darsni tanlang'}
              </option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
            {errors.lessonId && (
              <p className="text-xs font-medium text-red">
                {errors.lessonId.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2: basics ── */}
      <Card>
        <CardHeader>
          <CardTitle>2. Asosiy ma&apos;lumot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            id="ab-title"
            label="Sarlavha"
            required
            placeholder="Masalan: Present Simple — yozma ish"
            error={errors.title?.message}
            {...register('title')}
          />
          <div className="space-y-1.5">
            <Label htmlFor="ab-description">Ko&apos;rsatma (ixtiyoriy)</Label>
            <Textarea
              id="ab-description"
              rows={3}
              placeholder="Talabaga umumiy ko\u2018rsatma…"
              error={!!errors.description}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs font-medium text-red">
                {errors.description.message}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="ab-points"
              label="Maksimal ball"
              required
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              error={errors.totalPoints?.message}
              {...register('totalPoints')}
            />
            <div className="space-y-1.5">
              <Label htmlFor="ab-due">Muddat (ixtiyoriy)</Label>
              <Input id="ab-due" type="datetime-local" {...register('dueAt')} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Step 3: skill module ── */}
      <Card>
        <CardHeader>
          <CardTitle>3. Skill moduli</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!groupId ? (
            <p className="rounded-2xl border border-rim bg-tint px-4 py-3 text-sm text-ink-soft">
              Avval guruhni tanlang — modullar guruh uchun yoqilgan ro&apos;yxatdan
              ko&apos;rsatiladi.
            </p>
          ) : modulesSwr.isLoading ? (
            <LoadingState variant="list" count={2} label="Modullar yuklanmoqda…" />
          ) : modulesSwr.error ? (
            <ErrorState
              title="Modullarni yuklab bo\u2018lmadi"
              onRetry={() => void modulesSwr.refetch()}
            />
          ) : noModulesEnabled ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-orange/20 bg-orange/5 px-4 py-3 text-sm text-ink-soft"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange" />
              <p>
                Bu guruh uchun hech bir skill moduli yoqilmagan. Guruh
                sozlamalaridan kerakli modullarni yoqing.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ab-module" required>
                  Skill turi
                </Label>
                <Select
                  id="ab-module"
                  error={!!errors.moduleType}
                  {...register('moduleType')}
                >
                  <option value="">Skillni tanlang</option>
                  {enabledSkills.map((type) => (
                    <option key={type} value={type}>
                      {SKILL_META[type].icon} {SKILL_META[type].label}
                    </option>
                  ))}
                </Select>
                {errors.moduleType ? (
                  <p className="text-xs font-medium text-red">
                    {errors.moduleType.message}
                  </p>
                ) : moduleType && isLanguageSkillModuleType(moduleType) ? (
                  <p className="text-xs text-ink-soft">
                    {SKILL_META[moduleType].blurb}
                  </p>
                ) : null}
              </div>

              {moduleType && isLanguageSkillModuleType(moduleType) && (
                <SkillFields
                  moduleType={moduleType}
                  register={register}
                  errors={errors}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button asChild variant="ghost">
          <Link href={`/${locale}/homework`}>Bekor qilish</Link>
        </Button>
        <Button
          type="submit"
          loading={isSubmitting}
          leftIcon={isSubmitting ? undefined : <CheckCircle2 className="h-4 w-4" />}
        >
          Topshiriq yaratish
        </Button>
      </div>
    </form>
  );
}

// ── Skill-specific prompt fields ───────────────────────────────────────

type Register = ReturnType<
  typeof useForm<BuilderInput, unknown, BuilderValues>
>['register'];
type FieldErrors = ReturnType<
  typeof useForm<BuilderInput, unknown, BuilderValues>
>['formState']['errors'];

function SkillFields({
  moduleType,
  register,
  errors,
}: {
  moduleType: LanguageSkillModuleType;
  register: Register;
  errors: FieldErrors;
}) {
  switch (moduleType) {
    case 'WRITING':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FieldTextarea
            id="ab-prompt"
            label="Yozma ish ko\u2018rsatmasi"
            required
            rows={4}
            placeholder="Masalan: Write a 150-word essay about your daily routine."
            error={errors.prompt?.message}
            {...register('prompt')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="ab-minwords"
              label="Min so\u2018z"
              type="number"
              min={1}
              error={errors.minWords?.message}
              {...register('minWords')}
            />
            <FormField
              id="ab-maxwords"
              label="Max so\u2018z"
              type="number"
              min={1}
              error={errors.maxWords?.message}
              {...register('maxWords')}
            />
          </div>
        </div>
      );
    case 'READING':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FieldTextarea
            id="ab-passage"
            label="O\u2018qish matni"
            required
            rows={6}
            placeholder="Talabalar o\u2018qiydigan matn…"
            error={errors.passage?.message}
            {...register('passage')}
          />
          <FieldTextarea
            id="ab-prompt"
            label="Ko\u2018rsatma (ixtiyoriy)"
            rows={2}
            placeholder="Masalan: Read the passage and answer the questions."
            error={errors.prompt?.message}
            {...register('prompt')}
          />
        </div>
      );
    case 'LISTENING':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FormField
            id="ab-audio"
            label="Audio URL"
            required
            type="url"
            placeholder="https://…"
            error={errors.audioUrl?.message}
            {...register('audioUrl')}
          />
          <FieldTextarea
            id="ab-transcript"
            label="Transkripsiya (ixtiyoriy)"
            rows={3}
            placeholder="Audio matni…"
            error={errors.transcript?.message}
            {...register('transcript')}
          />
          <FieldTextarea
            id="ab-prompt"
            label="Ko\u2018rsatma (ixtiyoriy)"
            rows={2}
            error={errors.prompt?.message}
            {...register('prompt')}
          />
        </div>
      );
    case 'GRAMMAR':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FormField
            id="ab-ruletitle"
            label="Qoida nomi"
            required
            placeholder="Masalan: Present Simple"
            error={errors.ruleTitle?.message}
            {...register('ruleTitle')}
          />
          <FieldTextarea
            id="ab-ruleexp"
            label="Qoida tushuntirishi"
            required
            rows={4}
            placeholder="Qoidani tushuntiring…"
            error={errors.ruleExplanation?.message}
            {...register('ruleExplanation')}
          />
        </div>
      );
    case 'VOCABULARY':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FieldTextarea
            id="ab-words"
            label="So\u2018zlar (har bir qatorda: word - tarjima)"
            required
            rows={6}
            placeholder={'apple - olma\nbook - kitob'}
            error={errors.words?.message}
            {...register('words')}
          />
          <div className="space-y-1.5">
            <Label htmlFor="ab-studymode">O&apos;rganish rejimi</Label>
            <Select id="ab-studymode" {...register('studyMode')}>
              <option value="flashcard">Flashcard</option>
              <option value="quiz">Test</option>
              <option value="both">Ikkalasi</option>
            </Select>
          </div>
        </div>
      );
    case 'SPELLING':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FieldTextarea
            id="ab-words"
            label="So\u2018zlar (vergul yoki yangi qator bilan)"
            required
            rows={5}
            placeholder={'necessary, accommodate, rhythm'}
            error={errors.words?.message}
            {...register('words')}
          />
          <FieldTextarea
            id="ab-prompt"
            label="Ko\u2018rsatma (ixtiyoriy)"
            rows={2}
            error={errors.prompt?.message}
            {...register('prompt')}
          />
        </div>
      );
    case 'SPEAKING':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FieldTextarea
            id="ab-prompt"
            label="Gapirish topshirig\u2018i"
            required
            rows={3}
            placeholder="Masalan: Describe your last holiday in 1 minute."
            error={errors.prompt?.message}
            {...register('prompt')}
          />
          <FormField
            id="ab-target"
            label="Namuna matn (ixtiyoriy)"
            placeholder="Aytilishi kutilgan matn…"
            error={errors.targetText?.message}
            {...register('targetText')}
          />
        </div>
      );
    case 'PRONUNCIATION':
      return (
        <div className="space-y-4 border-t border-rim pt-4">
          <FieldTextarea
            id="ab-target"
            label="Talaffuz qilinadigan matn"
            required
            rows={3}
            placeholder="Masalan: The quick brown fox jumps over the lazy dog."
            error={errors.targetText?.message}
            {...register('targetText')}
          />
          <FormField
            id="ab-prompt"
            label="Ko\u2018rsatma (ixtiyoriy)"
            error={errors.prompt?.message}
            {...register('prompt')}
          />
        </div>
      );
    default:
      return null;
  }
}

// Small Textarea + Label + error helper (the UI `FormField` only wraps <Input>).
interface FieldTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
}

const FieldTextarea = forwardRef<HTMLTextAreaElement, FieldTextareaProps>(
  ({ id, label, required, error, ...rest }, ref) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required ?? false}>
        {label}
      </Label>
      <Textarea id={id} ref={ref} error={!!error} {...rest} />
      {error && <p className="text-xs font-medium text-red">{error}</p>}
    </div>
  ),
);
FieldTextarea.displayName = 'FieldTextarea';
