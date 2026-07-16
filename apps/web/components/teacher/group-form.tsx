'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, X } from 'lucide-react';

import { Button } from '../ui/button';
import { FormField, Label } from '../ui/form-field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import {
  groupsApi,
  type CreateGroupDto,
  type Group,
  type UpdateGroupDto,
} from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { CEFR_LEVELS, type CefrLevel } from '../discovery/facets';

// ── Schema ────────────────────────────────────────────────────────────
//
// Mirrors the writable slice of CreateGroupDto / UpdateGroupDto. Prices are
// in UZS (so'm) — whole-number, non-negative. The CEFR level is the group's
// own level (Req 8.2); it is optional so a group can inherit the course
// level. The schedule stays simple (startsOn / endsOn dates) — the RRULE
// editor is Task 4.5 and the module toggles are Task 4.6.

const CEFR_VALUES = CEFR_LEVELS as readonly string[];

const numericOptional = (max: number, msg: string) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z
      .number({ invalid_type_error: msg })
      .int(msg)
      .positive(msg)
      .max(max, msg)
      .optional(),
  );

const GroupFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Guruh nomini kiriting')
      .max(100, 'Nom 100 belgidan oshmasligi kerak'),
    cefrLevel: z
      .string()
      .optional()
      .refine((v) => !v || CEFR_VALUES.includes(v), 'Yaroqsiz CEFR daraja'),
    priceUzs: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
      z
        .number({ invalid_type_error: 'Narxni raqam sifatida kiriting' })
        .int('Narx butun son bo\u2018lishi kerak')
        .nonnegative('Narx manfiy bo\u2018lmasligi kerak')
        .max(100_000_000, 'Narx juda katta'),
    ),
    capacity: numericOptional(1000, 'Sig\u2018im 1 dan 1000 gacha bo\u2018lishi kerak'),
    startsOn: z.string().optional(),
    endsOn: z.string().optional(),
    joinCode: z
      .string()
      .trim()
      .max(32, 'Kod 32 belgidan oshmasligi kerak')
      .regex(/^[A-Za-z0-9-]*$/, 'Faqat harf, raqam va chiziqcha')
      .optional(),
  })
  .refine(
    (d) => !d.startsOn || !d.endsOn || d.endsOn >= d.startsOn,
    {
      message: 'Tugash sanasi boshlanish sanasidan keyin bo\u2018lishi kerak',
      path: ['endsOn'],
    },
  );

type GroupFormValues = z.infer<typeof GroupFormSchema>;
type GroupFormInput = z.input<typeof GroupFormSchema>;

export interface GroupFormInitialData {
  id: string;
  name: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: string | null;
  endsOn: string | null;
  cefrLevel?: CefrLevel | null;
  joinCode?: string | null;
}

interface GroupFormProps {
  locale: string;
  mode: 'create' | 'edit';
  courseId: string;
  initialData?: GroupFormInitialData;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** ISO datetime → `yyyy-mm-dd` for the native date input. */
function toLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** `yyyy-mm-dd` → ISO 8601 datetime (UTC midnight) for the API. */
function dateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(iso.getTime())) return undefined;
  return iso.toISOString();
}

/** Random 6-char uppercase join code (no ambiguous 0/O/1/I). */
function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function GroupForm({
  locale,
  mode,
  courseId,
  initialData,
}: GroupFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const initialJoinCode = initialData?.joinCode ?? '';

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<GroupFormInput, unknown, GroupFormValues>({
    resolver: zodResolver(GroupFormSchema),
    defaultValues: {
      name: initialData?.name ?? '',
      cefrLevel: initialData?.cefrLevel ?? '',
      priceUzs: initialData?.priceUzs ?? 0,
      capacity: initialData?.capacity ?? undefined,
      startsOn: toLocalDateInput(initialData?.startsOn),
      endsOn: toLocalDateInput(initialData?.endsOn),
      joinCode: initialJoinCode,
    },
  });

  const joinCodeValue = watch('joinCode') ?? '';

  const mutation = useMutation({
    mutationFn: async (values: GroupFormValues) => {
      const cefrLevel = values.cefrLevel
        ? (values.cefrLevel as CefrLevel)
        : undefined;
      const startsOn = dateToIso(values.startsOn);
      const endsOn = dateToIso(values.endsOn);

      // Persist the group core fields first.
      let group: Group;
      if (mode === 'create') {
        const payload: CreateGroupDto = {
          name: values.name,
          priceUzs: values.priceUzs,
          ...(values.capacity !== undefined ? { capacity: values.capacity } : {}),
          ...(startsOn ? { startsOn } : {}),
          ...(endsOn ? { endsOn } : {}),
          ...(cefrLevel ? { cefrLevel } : {}),
        };
        // `create` resolves to GroupWithModules, which extends Group.
        group = await groupsApi.create(courseId, payload);
      } else {
        if (!initialData?.id) throw new Error('Guruh ID topilmadi');
        const payload: UpdateGroupDto = {
          name: values.name,
          priceUzs: values.priceUzs,
          capacity: values.capacity ?? null,
          startsOn: startsOn ?? null,
          endsOn: endsOn ?? null,
          cefrLevel: cefrLevel ?? null,
        };
        group = await groupsApi.update(initialData.id, payload);
      }

      // Join code is written through the dedicated endpoint (Req 8.2 / 9.1).
      // Only call it when the value actually changed to avoid a redundant
      // PATCH. An empty string clears the code (null).
      const desiredJoinCode = values.joinCode?.trim()
        ? values.joinCode.trim().toUpperCase()
        : null;
      const currentJoinCode = initialJoinCode.trim()
        ? initialJoinCode.trim().toUpperCase()
        : null;
      if (desiredJoinCode !== currentJoinCode) {
        group = await groupsApi.updateJoinCode(group.id, desiredJoinCode);
      }

      return group;
    },
    onSuccess: (group) => {
      router.push(
        `/${locale}/dashboard/courses/${courseId}/groups/${group.id}`,
      );
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

  function onSubmit(values: GroupFormValues) {
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

      {/* Identity + level */}
      <div className="space-y-6">
        <FormField
          id="group-name"
          label="Guruh nomi"
          required
          placeholder="Masalan: IELTS 7.0 — Kuz 2025"
          error={errors.name?.message}
          helperText="Talabalar ko‘radigan guruh nomi."
          {...register('name')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="group-cefr">CEFR daraja</Label>
            <Select
              id="group-cefr"
              error={!!errors.cefrLevel}
              aria-describedby={
                errors.cefrLevel ? 'group-cefr-error' : 'group-cefr-helper'
              }
              {...register('cefrLevel')}
            >
              <option value="">Kurs darajasi (ixtiyoriy)</option>
              {CEFR_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
            {errors.cefrLevel ? (
              <p id="group-cefr-error" className="text-xs font-medium text-red">
                {errors.cefrLevel.message}
              </p>
            ) : (
              <p id="group-cefr-helper" className="text-xs text-ink-soft">
                Bu guruhning darajasi. Bo‘sh qoldirilsa kurs darajasi qo‘llanadi.
              </p>
            )}
          </div>

          <FormField
            id="group-price"
            label="Narx (UZS)"
            required
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            placeholder="500000"
            error={errors.priceUzs?.message}
            helperText="So‘mda. 0 — bepul."
            {...register('priceUzs')}
          />
        </div>
      </div>

      {/* Capacity + schedule */}
      <div className="space-y-6 border-t border-rim pt-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            id="group-capacity"
            label="Sig‘im"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="20"
            error={errors.capacity?.message}
            helperText="Maks. talaba (ixtiyoriy)."
            {...register('capacity')}
          />

          <div className="space-y-1.5">
            <Label htmlFor="group-starts-on">Boshlanish sanasi</Label>
            <Input id="group-starts-on" type="date" {...register('startsOn')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="group-ends-on">Tugash sanasi</Label>
            <Input
              id="group-ends-on"
              type="date"
              error={!!errors.endsOn}
              aria-describedby={errors.endsOn ? 'group-ends-on-error' : undefined}
              {...register('endsOn')}
            />
            {errors.endsOn && (
              <p
                id="group-ends-on-error"
                className="text-xs font-medium text-red"
              >
                {errors.endsOn.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Join / invite controls */}
      <div className="space-y-3 border-t border-rim pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="group-join-code">Qo‘shilish kodi</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="group-join-code"
              className="font-mono uppercase tracking-widest sm:max-w-[220px]"
              placeholder="Masalan: ABC123"
              leftIcon={<KeyRound className="h-4 w-4" />}
              error={!!errors.joinCode}
              aria-describedby={
                errors.joinCode ? 'group-join-code-error' : 'group-join-code-helper'
              }
              {...register('joinCode')}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() =>
                setValue('joinCode', generateJoinCode(), {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
            >
              Yaratish
            </Button>
            {joinCodeValue && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={<X className="h-4 w-4" />}
                onClick={() =>
                  setValue('joinCode', '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              >
                Tozalash
              </Button>
            )}
          </div>
          {errors.joinCode ? (
            <p
              id="group-join-code-error"
              className="text-xs font-medium text-red"
            >
              {errors.joinCode.message}
            </p>
          ) : (
            <p id="group-join-code-helper" className="text-xs text-ink-soft">
              Talabalar shu kod orqali guruhga qo‘shilishni so‘rashadi. Vaqtinchalik
              taklif havolalari guruh sahifasida boshqariladi.
            </p>
          )}
        </div>
      </div>

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
            ? 'Guruh yaratish'
            : 'O\u2018zgarishlarni saqlash'}
        </Button>
      </div>
    </form>
  );
}
