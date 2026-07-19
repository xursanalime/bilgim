'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { groupsApi, type Group } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';

// ── Schema (mirrors CreateGroupSchema / UpdateGroupSchema on the API) ──

const numericOptional = (max: number, msg = 'Raqamni to\u2018g\u2018ri kiriting') =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number({ invalid_type_error: msg }).int(msg).positive(msg).max(max).optional(),
  );

const GroupFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Guruh nomini kiriting')
    .max(100, 'Nom 100 belgidan oshmasligi kerak'),
  priceUzs: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
    z
      .number({ invalid_type_error: 'Narxni raqam sifatida kiriting' })
      .int('Narx butun son bo\u2018lishi kerak')
      .nonnegative('Narx manfiy bo\u2018lmasligi kerak')
      .max(100_000_000, 'Narx juda katta'),
  ),
  capacity: numericOptional(1000, 'Sig\u2018im 1 dan 1000 gacha'),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
});

type GroupFormValues = z.infer<typeof GroupFormSchema>;
type GroupFormInput = z.input<typeof GroupFormSchema>;

interface GroupFormProps {
  locale: string;
  mode: 'create' | 'edit';
  courseId: string;
  initialData?: Pick<
    Group,
    'id' | 'name' | 'priceUzs' | 'capacity' | 'startsOn' | 'endsOn'
  >;
}

function toLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

export function GroupForm({
  locale,
  mode,
  courseId,
  initialData,
}: GroupFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GroupFormInput, unknown, GroupFormValues>({
    resolver: zodResolver(GroupFormSchema),
    defaultValues: {
      name: initialData?.name ?? '',
      priceUzs: initialData?.priceUzs ?? 0,
      capacity: initialData?.capacity ?? undefined,
      startsOn: toLocalDateInput(initialData?.startsOn),
      endsOn: toLocalDateInput(initialData?.endsOn),
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: GroupFormValues) => {
      const payload = {
        name: values.name,
        priceUzs: values.priceUzs,
        ...(values.capacity !== undefined ? { capacity: values.capacity } : {}),
        ...(values.startsOn ? { startsOn: dateToIso(values.startsOn)! } : {}),
        ...(values.endsOn ? { endsOn: dateToIso(values.endsOn)! } : {}),
      };
      if (mode === 'create') {
        return groupsApi.create(courseId, payload);
      }
      if (!initialData?.id) throw new Error('Guruh ID topilmadi');
      return groupsApi.update(initialData.id, payload);
    },
    onSuccess: (group) => {
      router.push(`/${locale}/dashboard/courses/${courseId}/groups/${group.id}`);
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
      className="space-y-5 liquid-glass rounded-2xl p-6"
    >
      {serverError && (
        <div className="rounded-2xl border border-red/20 bg-red-tint p-4 text-sm text-red">
          {serverError}
        </div>
      )}

      <div className="space-y-2">
        <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
          Guruh nomi *
        </label>
        <input
          type="text"
          placeholder="Masalan, IELTS 7.0 — Kuz 2025"
          className="w-full rounded-2xl border border-rim bg-canvas px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/40 focus:ring-2 focus:ring-blue/10"
          {...register('name')}
        />
        {errors.name && (
          <p className="text-xs text-red">{errors.name.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Narx (UZS) *
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="500000"
            className="w-full rounded-2xl border border-rim bg-canvas px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/40 focus:ring-2 focus:ring-blue/10"
            {...register('priceUzs')}
          />
          {errors.priceUzs && (
            <p className="text-xs text-red">{errors.priceUzs.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Sig&apos;im
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="20"
            className="w-full rounded-2xl border border-rim bg-canvas px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/40 focus:ring-2 focus:ring-blue/10"
            {...register('capacity')}
          />
          {errors.capacity && (
            <p className="text-xs text-red">{errors.capacity.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Boshlanish sanasi
          </label>
          <input
            type="date"
            className="w-full rounded-2xl border border-rim bg-canvas px-4 py-3 text-sm text-ink-strong outline-none focus:border-blue/40 focus:ring-2 focus:ring-blue/10"
            {...register('startsOn')}
          />
        </div>
        <div className="space-y-2">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Tugash sanasi
          </label>
          <input
            type="date"
            className="w-full rounded-2xl border border-rim bg-canvas px-4 py-3 text-sm text-ink-strong outline-none focus:border-blue/40 focus:ring-2 focus:ring-blue/10"
            {...register('endsOn')}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl px-4 py-2 text-sm font-medium text-ink-soft hover:bg-soft hover:text-ink-strong"
        >
          Bekor qilish
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-blue-soft transition-colors hover:bg-blue-600 disabled:opacity-60"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'create'
            ? 'Guruh yaratish'
            : 'O\u2018zgarishlarni saqlash'}
        </button>
      </div>
    </form>
  );
}
