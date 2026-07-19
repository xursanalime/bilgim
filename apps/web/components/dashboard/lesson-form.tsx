'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

import { lessonsApi, type Lesson, type LessonType } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

const LessonFormSchema = z.object({
  title: z
    .string()
    .min(1, 'Sarlavhani kiriting')
    .max(200, 'Sarlavha 200 belgidan oshmasligi kerak'),
  description: z.string().max(5000, 'Tavsif juda uzun').optional(),
  type: z.enum(['RECORDED', 'LIVE', 'HYBRID', 'TEXT_ONLY'], {
    errorMap: () => ({ message: 'Dars turini tanlang' }),
  }),
  position: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
      z
        .number({ invalid_type_error: 'Tartib raqamni kiriting' })
        .int('Butun son bo\u2018lishi kerak')
        .nonnegative('Manfiy bo\u2018lmasligi kerak')
        .max(10_000),
    )
    .optional(),
  scheduledAt: z.string().optional(),
});

type LessonFormValues = z.infer<typeof LessonFormSchema>;
type LessonFormInput = z.input<typeof LessonFormSchema>;

interface LessonFormProps {
  locale: string;
  mode: 'create' | 'edit';
  courseId: string;
  groupId: string;
  initialData?: Pick<
    Lesson,
    'id' | 'title' | 'description' | 'type' | 'position' | 'scheduledAt'
  >;
}

const TYPE_OPTIONS: Array<{ value: LessonType; label: string; hint: string }> =
  [
    { value: 'RECORDED', label: 'Yozib olingan', hint: 'Video dars' },
    { value: 'LIVE', label: 'Jonli efir', hint: 'Belgilangan vaqtda' },
    { value: 'HYBRID', label: 'Aralash', hint: 'Live + materiallar' },
    { value: 'TEXT_ONLY', label: 'Faqat matn', hint: 'Maqola ko\u2018rinishida' },
  ];

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // datetime-local needs YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
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

  const mutation = useMutation({
    mutationFn: async (values: LessonFormValues) => {
      const payload = {
        title: values.title,
        ...(values.description ? { description: values.description } : {}),
        type: values.type,
        ...(values.position !== undefined ? { position: values.position } : {}),
        ...(values.scheduledAt
          ? { scheduledAt: localInputToIso(values.scheduledAt)! }
          : {}),
      };
      if (mode === 'create') {
        return lessonsApi.create(groupId, payload);
      }
      if (!initialData?.id) throw new Error('Dars ID topilmadi');
      return lessonsApi.update(initialData.id, payload);
    },
    onSuccess: () => {
      router.push(`/${locale}/dashboard/courses/${courseId}/groups/${groupId}`);
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
      className="mx-auto max-w-4xl space-y-8 rounded-[2rem] border border-rim bg-white p-8 shadow-soft sm:p-10"
    >
      {serverError && (
        <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-bold text-red animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{serverError}</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
              Dars sarlavhasi *
            </label>
            <input
              type="text"
              placeholder="Masalan: Speaking Part 1 — Introduction"
              className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3 text-sm font-bold text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5"
              {...register('title')}
            />
            {errors.title && (
              <p className="flex items-center gap-1.5 text-xs font-bold text-red">
                <AlertCircle className="h-3 w-3" />
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
              Tavsif (ixtiyoriy)
            </label>
            <textarea
              rows={4}
              placeholder="Talabaga dars haqida qisqa eslatma yoki ko'rsatma yozing..."
              className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3.5 text-sm font-medium leading-relaxed text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5 resize-none"
              {...register('description')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
                Tartib raqami
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="1"
                className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3 text-sm font-bold text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5"
                {...register('position')}
              />
              {errors.position && (
                <p className="text-xs font-bold text-red">{errors.position.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
                Vaqti
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3 text-sm font-bold text-ink-strong outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5"
                {...register('scheduledAt')}
              />
            </div>
          </div>
        </div>

        {/* Right Column: Lesson Type */}
        <div className="space-y-3">
          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
            Dars turi *
          </label>
          <div className="grid gap-3">
            {TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-all duration-300",
                  "hover:border-blue/30 hover:bg-blue/5",
                  "has-[:checked]:border-blue/50 has-[:checked]:bg-blue/5 has-[:checked]:shadow-sm"
                )}
              >
                <input
                  type="radio"
                  value={opt.value}
                  className="mt-1.5 h-4 w-4 accent-blue"
                  {...register('type')}
                />
                <span className="flex flex-col">
                  <span className="text-[15px] font-bold text-ink-strong">
                    {opt.label}
                  </span>
                  <span className="text-[11px] font-medium text-ink-soft opacity-70">
                    {opt.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {errors.type && (
            <p className="text-xs font-bold text-red mt-2">{errors.type.message}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-rim pt-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl px-6 py-2.5 text-sm font-bold text-ink-soft transition-all hover:bg-tint hover:text-ink-strong"
        >
          Bekor qilish
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="group inline-flex items-center gap-2 rounded-2xl bg-blue px-10 py-3 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 disabled:opacity-60 active:scale-[0.98]"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 transition-transform group-hover:scale-110" />
          )}
          <span>{mode === 'create' ? 'Darsni yaratish' : 'O\u2018zgarishlarni saqlash'}</span>
        </button>
      </div>
    </form>
  );
}
