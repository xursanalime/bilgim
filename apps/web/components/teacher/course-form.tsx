'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Trash2,
} from 'lucide-react';

import { Button } from '../ui/button';
import { FormField, Label } from '../ui/form-field';
import { Textarea } from '../ui/input';
import { Select } from '../ui/select';
import {
  coursesApi,
  type CreateCourseDto,
  type UpdateCourseDto,
} from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { uploadFile } from '../../lib/upload';
import { CEFR_LEVELS, EXAM_TRACKS, type CefrLevel } from '../discovery/facets';

// ── Schema ────────────────────────────────────────────────────────────
//
// Mirrors the relevant slice of CreateCourseDto / UpdateCourseDto. CEFR
// level is required (English-only platform attribute, Req 8.1); the
// Exam_Track is optional. The cover image is handled outside RHF because it
// is uploaded to the media endpoint before submit and tracked as an assetId.

const CEFR_VALUES = CEFR_LEVELS as readonly string[];

const CourseFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Kurs nomini kiriting')
    .max(200, 'Nom 200 belgidan oshmasligi kerak'),
  description: z.string().max(5000, 'Tavsif juda uzun').optional(),
  cefrLevel: z
    .string()
    .min(1, 'CEFR darajani tanlang')
    .refine((v) => CEFR_VALUES.includes(v), 'Yaroqsiz CEFR daraja'),
  examTrack: z.string().optional(),
});

type CourseFormValues = z.infer<typeof CourseFormSchema>;

export interface CourseFormInitialData {
  id: string;
  title: string;
  description: string | null;
  cefrLevel: string | null;
  examTrack: string | null;
  coverUrl: string | null;
}

interface CourseFormProps {
  locale: string;
  mode: 'create' | 'edit';
  initialData?: CourseFormInitialData;
}

type CoverState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'ready'; assetId: string }
  | { status: 'error'; message: string };

const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5MB

export function CourseForm({ locale, mode, initialData }: CourseFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [serverError, setServerError] = useState<string | null>(null);
  const [cover, setCover] = useState<CoverState>({ status: 'idle' });
  // Preview shows the freshly-picked file (object URL) or the existing cover.
  const [coverPreview, setCoverPreview] = useState<string | null>(
    initialData?.coverUrl ?? null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CourseFormValues>({
    resolver: zodResolver(CourseFormSchema),
    defaultValues: {
      title: initialData?.title ?? '',
      description: initialData?.description ?? '',
      cefrLevel: initialData?.cefrLevel ?? '',
      examTrack: initialData?.examTrack ?? '',
    },
  });

  async function handleCoverChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setCover({ status: 'error', message: 'Faqat rasm fayllari qabul qilinadi' });
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      setCover({ status: 'error', message: 'Rasm hajmi 5MB dan oshmasligi kerak' });
      return;
    }

    setCoverPreview(URL.createObjectURL(file));
    setCover({ status: 'uploading', progress: 0 });

    try {
      const assetId = await uploadFile(file, 'IMAGE', (progress) =>
        setCover({ status: 'uploading', progress }),
      );
      setCover({ status: 'ready', assetId });
    } catch (err) {
      setCover({
        status: 'error',
        message:
          err instanceof Error ? err.message : 'Rasmni yuklab bo\u2018lmadi',
      });
    }
  }

  function clearCover() {
    setCover({ status: 'idle' });
    setCoverPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const mutation = useMutation({
    mutationFn: async (values: CourseFormValues) => {
      const cefrLevel = values.cefrLevel as CefrLevel;
      const description = values.description?.trim();
      const examTrack = values.examTrack?.trim();
      const coverAssetId =
        cover.status === 'ready' ? cover.assetId : undefined;

      if (mode === 'create') {
        const payload: CreateCourseDto = {
          title: values.title,
          // Keep the legacy free-text `level` in sync with the CEFR level so
          // existing level pills keep rendering.
          level: cefrLevel,
          cefrLevel,
          ...(description ? { description } : {}),
          ...(examTrack ? { examTrack } : {}),
          ...(coverAssetId ? { coverAssetId } : {}),
        };
        return coursesApi.create(payload);
      }

      if (!initialData?.id) {
        throw new Error('Kurs ID topilmadi');
      }
      const payload: UpdateCourseDto = {
        title: values.title,
        level: cefrLevel,
        cefrLevel,
        description: description ? description : null,
        // Empty selection clears the optional Exam_Track.
        examTrack: examTrack ? examTrack : null,
        ...(coverAssetId ? { coverAssetId } : {}),
      };
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

  const isUploading = cover.status === 'uploading';

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

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left: text fields */}
        <div className="space-y-6">
          <FormField
            id="course-title"
            label="Kurs nomi"
            required
            placeholder="Masalan: IELTS Speaking Intensive"
            error={errors.title?.message}
            helperText="Talabalar katalogda ko‘radigan nom."
            {...register('title')}
          />

          <div className="space-y-1.5">
            <Label htmlFor="course-description">Tavsif</Label>
            <Textarea
              id="course-description"
              rows={6}
              placeholder="Kurs nimani qamrab oladi, kimga mo‘ljallangan..."
              error={!!errors.description}
              aria-describedby={
                errors.description ? 'course-description-error' : undefined
              }
              {...register('description')}
            />
            {errors.description && (
              <p
                id="course-description-error"
                className="text-xs font-medium text-red"
              >
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="course-cefr" required>
                CEFR daraja
              </Label>
              <Select
                id="course-cefr"
                error={!!errors.cefrLevel}
                aria-describedby={
                  errors.cefrLevel ? 'course-cefr-error' : undefined
                }
                {...register('cefrLevel')}
              >
                <option value="">Darajani tanlang</option>
                {CEFR_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </Select>
              {errors.cefrLevel && (
                <p
                  id="course-cefr-error"
                  className="text-xs font-medium text-red"
                >
                  {errors.cefrLevel.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="course-exam-track">Imtihon yo&apos;nalishi</Label>
              <Select id="course-exam-track" {...register('examTrack')}>
                <option value="">Yo&apos;q (ixtiyoriy)</option>
                {EXAM_TRACKS.map((track) => (
                  <option key={track.slug} value={track.slug}>
                    {track.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-ink-soft">
                IELTS, TOEFL kabi imtihonga tayyorlov (ixtiyoriy).
              </p>
            </div>
          </div>
        </div>

        {/* Right: cover image */}
        <div className="space-y-1.5">
          <Label htmlFor="course-cover">Muqova rasmi</Label>
          <div className="overflow-hidden rounded-2xl border border-rim bg-tint">
            <div className="relative flex aspect-video items-center justify-center bg-tint">
              {coverPreview ? (
                <Image
                  src={coverPreview}
                  alt="Kurs muqovasi"
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-faint">
                  <ImagePlus className="h-8 w-8" />
                  <span className="text-xs font-medium">Muqova rasmi yo&apos;q</span>
                </div>
              )}

              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-canvas/70 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {cover.progress}%
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-rim p-3">
              <input
                ref={fileInputRef}
                id="course-cover"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverChange}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<ImagePlus className="h-4 w-4" />}
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {coverPreview ? 'Almashtirish' : 'Rasm tanlash'}
              </Button>
              {coverPreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  disabled={isUploading}
                  onClick={clearCover}
                >
                  O&apos;chirish
                </Button>
              )}
            </div>
          </div>
          {cover.status === 'error' && (
            <p className="text-xs font-medium text-red">{cover.message}</p>
          )}
          <p className="text-xs text-ink-soft">
            JPG yoki PNG, 5MB gacha. 16:9 nisbat tavsiya etiladi.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-rim pt-6">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Bekor qilish
        </Button>
        <Button
          type="submit"
          loading={mutation.isPending}
          disabled={isUploading}
          leftIcon={
            mutation.isPending ? undefined : <CheckCircle2 className="h-4 w-4" />
          }
        >
          {mode === 'create'
            ? 'Kursni yaratish'
            : 'O\u2018zgarishlarni saqlash'}
        </Button>
      </div>
    </form>
  );
}
