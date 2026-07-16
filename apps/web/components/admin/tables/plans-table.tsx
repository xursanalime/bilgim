'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Power, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { adminApi, type AdminPlan } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { toast } from '../../ui/toast';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// Plans management table (task 13.2, Req 17.2/17.3).
//
// Lists billing plans with two destructive flows — deactivate (PATCH
// isActive:false) and hard delete — both confirmed via ConfirmDialog,
// since existing subscribers reference a plan.
// ═════════════════════════════════════════════════════════════════

type PendingAction =
  | { kind: 'deactivate'; plan: AdminPlan }
  | { kind: 'delete'; plan: AdminPlan }
  | null;

const numberFormatter = new Intl.NumberFormat('uz-UZ');

function planName(plan: AdminPlan): string {
  return plan.nameUz ?? plan.name;
}

function planInterval(plan: AdminPlan): string {
  if (typeof plan.intervalDays === 'number') {
    return `${plan.intervalDays} kun`;
  }
  return plan.interval === 'YEARLY' ? 'Yillik' : 'Oylik';
}

export function PlansTable() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => adminApi.listPlans(),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });

  const onMutationError = (err: unknown) => {
    toast.error(err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi');
  };

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      adminApi.updatePlan(id, { isActive: false }, crypto.randomUUID()),
    onSuccess: () => {
      invalidate();
      toast.success('Tarif faolsizlantirildi');
      setPending(null);
    },
    onError: onMutationError,
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      adminApi.updatePlan(id, { isActive: true }, crypto.randomUUID()),
    onSuccess: () => {
      invalidate();
      toast.success('Tarif faollashtirildi');
    },
    onError: onMutationError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deletePlan(id, crypto.randomUUID()),
    onSuccess: () => {
      invalidate();
      toast.success("Tarif o'chirildi");
      setPending(null);
    },
    onError: onMutationError,
  });

  const columns: DataTableColumn<AdminPlan>[] = [
    {
      id: 'name',
      header: 'Tarif',
      accessor: (p) => `${planName(p)} ${p.slug ?? ''}`,
      sortable: true,
      cell: (p) => (
        <span className="min-w-0">
          <span className="block font-semibold text-ink-strong">{planName(p)}</span>
          {p.slug ? (
            <span className="block text-xs text-ink-soft">{p.slug}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'priceUzs',
      header: 'Narx',
      accessor: (p) => p.priceUzs,
      sortable: true,
      align: 'right',
      cell: (p) => (
        <span className="tabular-nums text-ink-strong">
          {numberFormatter.format(p.priceUzs)} so&apos;m
        </span>
      ),
    },
    {
      id: 'interval',
      header: 'Davr',
      accessor: (p) => p.intervalDays ?? p.interval,
      sortable: true,
      cell: (p) => planInterval(p),
    },
    {
      id: 'isActive',
      header: 'Holat',
      accessor: (p) => p.isActive,
      sortable: true,
      cell: (p) => (
        <Badge variant={p.isActive ? 'green' : 'neutral'}>
          {p.isActive ? 'Faol' : 'Nofaol'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <DataTable
        data={data ?? []}
        columns={columns}
        getRowId={(p) => p.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={
          error instanceof ApiClientError
            ? error.message
            : 'Tariflarni olishda xatolik.'
        }
        onRetry={() => void refetch()}
        emptyIcon={<CreditCard className="h-8 w-8" aria-hidden="true" />}
        labels={{
          filterPlaceholder: 'Tarif nomi bo&apos;yicha qidirish...',
          emptyTitle: 'Tariflar topilmadi',
        }}
        actionsHeader="Amallar"
        renderRowActions={(p) => (
          <div className="flex justify-end gap-1.5">
            {p.isActive ? (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Power className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setPending({ kind: 'deactivate', plan: p })}
              >
                Faolsizlantirish
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Power className="h-4 w-4" aria-hidden="true" />}
                onClick={() => activateMutation.mutate(p.id)}
              >
                Faollashtirish
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-red hover:bg-red/10"
              leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setPending({ kind: 'delete', plan: p })}
            >
              O&apos;chirish
            </Button>
          </div>
        )}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === 'delete'
            ? "Tarifni o'chirish"
            : 'Tarifni faolsizlantirish'
        }
        description={
          pending ? (
            pending.kind === 'delete' ? (
              <>
                <strong>{planName(pending.plan)}</strong> tarifini butunlay
                o&apos;chirmoqchimisiz? Bu amalni ortga qaytarib bo&apos;lmaydi.
              </>
            ) : (
              <>
                <strong>{planName(pending.plan)}</strong> tarifini
                faolsizlantirmoqchimisiz? Yangi obunalar uchun ko&apos;rinmaydi.
              </>
            )
          ) : null
        }
        confirmLabel={pending?.kind === 'delete' ? "O'chirish" : 'Faolsizlantirish'}
        loading={deleteMutation.isPending || deactivateMutation.isPending}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'delete') {
            deleteMutation.mutate(pending.plan.id);
          } else {
            deactivateMutation.mutate(pending.plan.id);
          }
        }}
      />
    </>
  );
}
