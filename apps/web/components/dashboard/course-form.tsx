'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

import { coursesApi, type Course } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';

// ── Schema (mirrors CreateCourseDto / UpdateCourseDto on the API) ─────

const CourseFormSchema = z.object({
  title: z
    .string()
    .min(1, 'Sarlavhani kiriting')
    .max(200, 'Sarlavha 200 belgidan oshmasligi kerak'),
  description: z.string().max(5000, 'Tavsif juda uzun').optional(),
  level: z.string().max(50, 'Yo\u2018nalish juda uzun').optional(),
});

type CourseFormValues = z.infer<typeof CourseFormSchema>;
type CourseFormInput = z.input<typeof CourseFormSchema>;

interface CourseFormProps {
  locale: string;
  mode: 'create' | 'edit';
  initialData?: Pick<
    Course,
    'id' | 'title' | 'description' | 'level' | 'fromPriceUzs'
  >;
}

export function CourseForm({ locale, mode, initialData }: CourseFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CourseFormInput, unknown, CourseFormValues>({
    resolver: zodResolver(CourseFormSchema),
    defaultValues: {
      title: initialData?.title ?? '',
      description: initialData?.description ?? '',
      level: initialData?.level ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: CourseFormValues) => {
      const payload = {
        title: values.title,
        ...(values.description ? { description: values.description } : {}),
        ...(values.level ? { level: values.level } : {}),
      };
      if (mode === 'create') {
        return coursesApi.create(payload);
      }
      if (!initialData?.id) {
        throw new Error('Kurs ID topilmadi');
      }
      return coursesApi.update(initialData.id, payload);
    },
    onSuccess: (course) => {
      router.push(`/${locale}/dashboard/courses/${course.id}`);
      router.refresh();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setServerError(err.message);
      } else if (err instanceof Error) {
        setServerError(err.message);
      } else {
        setServerError('Server bilan aloqa xatosi.');
      }
    },
  });

  function onSubmit(values: CourseFormValues) {
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
        {/* Left Column: Basic Info */}
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
              Fan nomi / Kurs sarlavhasi *
            </label>
            <input
              type="text"
              placeholder="Masalan: Ingliz tili"
              className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3 text-sm font-bold text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5"
              {...register('title')}
            />
            {errors.title && (
              <p className="flex items-center gap-1.5 text-xs font-bold text-red">
                <AlertCircle className="h-3 w-3" />
                {errors.title.message}
              </p>
            )}
            <p className="text-[11px] leading-relaxed text-ink-soft opacity-80">
              Bu fanning umumiy nomi. Guruhlar kurs ichida yaratiladi.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
              Yo'nalish / Sifati
            </label>
            <input
              type="text"
              placeholder="Masalan: General"
              className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3 text-sm font-bold text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5"
              {...register('level')}
            />
            {errors.level && (
              <p className="text-xs font-bold text-red">{errors.level.message}</p>
            )}
          </div>
        </div>

        {/* Right Column: Description */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
            Kurs haqida batafsil
          </label>
          <textarea
            rows={7}
            placeholder="Talabalarga bu fan doirasida nimalar o'rgatilishi haqida yozing..."
            className="w-full rounded-2xl border border-rim bg-tint/50 px-5 py-3.5 text-sm font-medium leading-relaxed text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/40 focus:bg-white focus:ring-4 focus:ring-blue/5 resize-none"
            {...register('description')}
          />
          {errors.description && (
            <p className="text-xs font-bold text-red">{errors.description.message}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-rim pt-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl px-5 py-2.5 text-sm font-bold text-ink-soft transition-all hover:bg-tint hover:text-ink-strong"
        >
          Bekor qilish
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="group inline-flex items-center gap-2 rounded-2xl bg-blue px-8 py-3 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 disabled:opacity-60 active:scale-[0.98]"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 transition-transform group-hover:scale-110" />
          )}
          <span>{mode === 'create' ? 'Kursni yaratish' : 'O\u2018zgarishlarni saqlash'}</span>
        </button>
      </div>
    </form>
  );
}
