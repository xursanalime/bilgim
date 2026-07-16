'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Film,
  Info,
  Layers,
  Radio,
  UploadCloud,
} from 'lucide-react';

import { Button } from '../ui/button';
import { FormField, Label } from '../ui/form-field';
import { Input, Textarea } from '../ui/input';
import { RadioCard } from '../ui/radio-card';
import {
  lessonsApi,
  type CreateLessonDto,
  type Lesson,
  type LessonType,
  type UpdateLessonDto,
} from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';

// ── Schema ────────────────────────────────────────────────────────────
//
// Mirrors the writable slice of CreateLessonDto / UpdateLessonDto. The
// lesson `type` drives which fields are required (Req 8.3):
//   • LIVE / HYBRID  → scheduledAt is required (it is a scheduled session).
//   • TEXT_ONLY      → the rich-text body (stored in `description`) is
//                      required — it IS the lesson content.
//   • RECORDED       → no extra required fields; the video is attached by
//                      the resumable uploader (Task 4.4).
//
// BACKEND ASSUMPTION: the catalog DTOs expose no dedicated "content"/"body"
// field, so for TEXT_ONLY lessons the authored rich text is persisted in
// `description`. If the backend later adds a first-class body field, switch
// the TEXT_ONLY editor to write to it instead.

const LESSON_TYPES = ['RECORDED', 'LIVE', 'HYBRID', 'TEXT_ONLY'] as const;

const LessonFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Sarlavhani kiriting')
      .max(200, 'Sarlavha 200 belgidan oshmasligi kerak'),
    description: z.string().max(20_000, 'Matn juda uzun').optional(),
    type: z.enum(LESSON_TYPES, {
      errorMap: () => ({ message: 'Dars turini tanlang' }),
    }),
    position: z
      .preprocess(
        (v) =>
          v === '' || v === null || v === undefined ? undefined : Number(v),
        z
          .number({ invalid_type_error: 'Tartib raqamni kiriting' })
          .int('Butun son bo\u2018lishi kerak')
          .nonnegative('Manfiy bo\u2018lmasligi kerak')
          .max(10_000, 'Juda katta'),
      )
      .optional(),
    scheduledAt: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.type === 'LIVE' || data.type === 'HYBRID') &&
      !data.scheduledAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledAt'],
        message: 'Jonli dars uchun sana va vaqtni belgilang',
      });
    }
    if (
      data.type === 'TEXT_ONLY' &&
      (!data.description || !data.description.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Matnli dars uchun matn kiriting',
      });
    }
  });

type LessonFormValues = z.infer<typeof LessonFormSchema>;
type LessonFormInput = z.input<typeof LessonFormSchema>;

export interface LessonFormInitialData {
  id: string;
  title: string;
  description: string | null;
  type: LessonType;
  position: number;
  scheduledAt: string | null;
}

interface LessonFormProps {
  locale: string;
  mode: 'create' | 'edit';
  courseId: string;
  groupId: string;
  initialData?: LessonFormInitialData;
}

interface TypeOption {
  value: LessonType;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const TYPE_OPTIONS: TypeOption[] = [
  {
    value: 'RECORDED',
    label: 'Yozib olingan',
    hint: 'Oldindan tayyorlangan video dars',
    icon: <Film className="h-5 w-5" />,
  },
  {
    value: 'LIVE',
    label: 'Jonli efir',
    hint: 'Belgilangan vaqtda jonli o\u2018tiladi',
    icon: <Radio className="h-5 w-5" />,
  },
  {
    value: 'HYBRID',
    label: 'Aralash',
    hint: 'Jonli efir + yozib olingan materiallar',
    icon: <Layers className="h-5 w-5" />,
  },
  {
    value: 'TEXT_ONLY',
    label: 'Faqat matn',
    hint: 'Maqola ko\u2018rinishidagi matnli dars',
    icon: <FileText className="h-5 w-5" />,
  },
];

// ── Date helpers ──────────────────────────────────────────────────────

/** ISO datetime → `YYYY-MM-DDTHH:mm` (local) for the datetime-local input. */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` (local) → ISO 8601 string for the API. */
function localInputToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// ── Rich-text editor (TEXT_ONLY body) ─────────────────────────────────
//
// The platform standardises on TipTap for rich text (see steering/tech.md),
// and `@tiptap/react` + `@tiptap/starter-kit` are already declared in this
// app's package.json. A shared TipTap editor component does not yet exist in
// the codebase, so this is intentionally a plain textarea for now.
//
// FOLLOW-UP: replace this textarea with a TipTap-based editor (reusing the
// already-installed @tiptap packages — no new dependency required) so authors
// get formatting controls. The form contract stays the same: the editor must
// keep writing its value into the RHF `description` field.

interface RichTextFieldProps {
  id: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}

function RichTextField({
  id,
  value,
  error,
  onChange,
  onBlur,
}: RichTextFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required>
        Dars matni
      </Label>
      <Textarea
        id={id}
        rows={12}
        placeholder="Darsning to‘liq matnini shu yerga yozing..."
        value={value}
        error={!!error}
        aria-describedby={error ? `${id}-error` : `${id}-helper`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="leading-relaxed"
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red">
          {error}
        </p>
      ) : (
        <p id={`${id}-helper`} className="text-xs text-ink-soft">
          Matnli dars uchun asosiy mazmun. Boy matn tahrirlagichi (TipTap)
          keyingi bosqichda qo&apos;shiladi.
        </p>
      )}
    </div>
  );
}

export function LessonForm({
  locale,
  mode,
  courseId,
  groupId,
  initialData,
}: LessonFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LessonFormInput, unknown, LessonFormValues>({
    resolver: zodResolver(LessonFormSchema),
    defaultValues: {
      title: initialData?.title ?? '',
      description: initialData?.description ?? '',
      type: initialData?.type ?? 'RECORDED',
      position: initialData?.position ?? undefined,
      scheduledAt: isoToLocalInput(initialData?.scheduledAt),
    },
  });

  const selectedType = watch('type');
  const descriptionValue = watch('description') ?? '';

  const needsSchedule = selectedType === 'LIVE' || selectedType === 'HYBRID';
  const needsVideo = selectedType === 'RECORDED' || selectedType === 'HYBRID';
  const isTextOnly = selectedType === 'TEXT_ONLY';

  const mutation = useMutation({
    mutationFn: async (values: LessonFormValues) => {
      const description = values.description?.trim();
      // scheduledAt only applies to LIVE / HYBRID lessons.
      const scheduledAt =
        values.type === 'LIVE' || values.type === 'HYBRID'
          ? localInputToIso(values.scheduledAt)
          : undefined;

      if (mode === 'create') {
        const payload: CreateLessonDto = {
          title: values.title,
          type: values.type,
          ...(description ? { description } : {}),
          ...(values.position !== undefined
            ? { position: values.position }
            : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        };
        return lessonsApi.create(groupId, payload);
      }

      if (!initialData?.id) throw new Error('Dars ID topilmadi');
      const payload: UpdateLessonDto = {
        title: values.title,
        type: values.type,
        description: description ? description : null,
        // Clear the schedule when the type no longer needs it.
        scheduledAt: scheduledAt ?? null,
        ...(values.position !== undefined
          ? { position: values.position }
          : {}),
      };
      return lessonsApi.update(initialData.id, payload);
    },
    onSuccess: (lesson: Lesson) => {
      router.push(
        `/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}`,
      );
      router.refresh();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) setServerError(err.message);
      else if (err instanceof Error) setServerError(err.message);
      else setServerError('Server bilan aloqa xatosi.');
    },
  });

  function onSubmit(values: LessonFormValues) {
    setServerError(null);
    mutation.mutate(values);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-8 rounded-[2rem] border border-rim bg-canvas p-6 shadow-soft sm:p-8"
    >
      {serverError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-semibold text-red"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{serverError}</p>
        </div>
      )}

      {/* Type selector — cards (Req 8.3) */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink-strong">
          Dars turi
          <span className="ml-1 text-blue" aria-hidden="true">
            *
          </span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {TYPE_OPTIONS.map((opt) => (
            <RadioCard
              key={opt.value}
              id={`lesson-type-${opt.value}`}
              value={opt.value}
              label={opt.label}
              description={opt.hint}
              icon={opt.icon}
              {...register('type')}
            />
          ))}
        </div>
        {errors.type && (
          <p className="text-xs font-medium text-red">{errors.type.message}</p>
        )}
      </fieldset>

      {/* Core fields */}
      <div className="space-y-6 border-t border-rim pt-6">
        <FormField
          id="lesson-title"
          label="Dars sarlavhasi"
          required
          placeholder="Masalan: Speaking Part 1 — Introduction"
          error={errors.title?.message}
          helperText="Talabalar ko‘radigan dars nomi."
          {...register('title')}
        />

        {/* TEXT_ONLY → rich-text body; otherwise an optional note. */}
        {isTextOnly ? (
          <RichTextField
            id="lesson-body"
            value={descriptionValue}
            error={errors.description?.message}
            onChange={(v) =>
              setValue('description', v, { shouldValidate: true })
            }
            onBlur={() =>
              setValue('description', descriptionValue, {
                shouldValidate: true,
              })
            }
          />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="lesson-description">Tavsif (ixtiyoriy)</Label>
            <Textarea
              id="lesson-description"
              rows={4}
              placeholder="Talabaga dars haqida qisqa eslatma yoki ko‘rsatma..."
              error={!!errors.description}
              aria-describedby={
                errors.description ? 'lesson-description-error' : undefined
              }
              {...register('description')}
            />
            {errors.description && (
              <p
                id="lesson-description-error"
                className="text-xs font-medium text-red"
              >
                {errors.description.message}
              </p>
            )}
          </div>
        )}

        <FormField
          id="lesson-position"
          label="Tartib raqami"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="1"
          error={errors.position?.message}
          helperText="Guruh ichidagi dars tartibi (ixtiyoriy)."
          {...register('position')}
        />
      </div>

      {/* LIVE / HYBRID → schedule */}
      {needsSchedule && (
        <div className="space-y-1.5 border-t border-rim pt-6">
          <Label htmlFor="lesson-scheduled-at" required>
            Jonli efir vaqti
          </Label>
          <Input
            id="lesson-scheduled-at"
            type="datetime-local"
            leftIcon={<CalendarClock className="h-4 w-4" />}
            error={!!errors.scheduledAt}
            aria-describedby={
              errors.scheduledAt
                ? 'lesson-scheduled-at-error'
                : 'lesson-scheduled-at-helper'
            }
            {...register('scheduledAt')}
          />
          {errors.scheduledAt ? (
            <p
              id="lesson-scheduled-at-error"
              className="text-xs font-medium text-red"
            >
              {errors.scheduledAt.message}
            </p>
          ) : (
            <p id="lesson-scheduled-at-helper" className="text-xs text-ink-soft">
              Dars jonli boshlanadigan sana va vaqt.
            </p>
          )}
        </div>
      )}

      {/* RECORDED / HYBRID → video upload (owned by Task 4.4) */}
      {needsVideo && (
        <div className="border-t border-rim pt-6">
          <div className="flex items-start gap-4 rounded-2xl border border-dashed border-rim bg-tint/50 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue">
              <UploadCloud className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-ink-strong">
                Video yuklash
              </p>
              <p className="flex items-start gap-1.5 text-xs text-ink-soft">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Avval darsni saqlang, so&apos;ng dars sahifasidan video
                  yuklang. Yuklash moduli keyingi bosqichda (Task 4.4)
                  qo&apos;shiladi.
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-rim pt-6">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Bekor qilish
        </Button>
        <Button
          type="submit"
          loading={mutation.isPending}
          leftIcon={
            mutation.isPending ? undefined : <CheckCircle2 className="h-4 w-4" />
          }
        >
          {mode === 'create'
            ? 'Darsni yaratish'
            : 'O\u2018zgarishlarni saqlash'}
        </Button>
      </div>
    </form>
  );
}
