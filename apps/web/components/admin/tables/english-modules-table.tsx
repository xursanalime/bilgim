'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { useState } from 'react';

import { adminApi, type AdminEnglishModule } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { toast } from '../../ui/toast';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// English module catalog table (task 13.2, Req 17.2/17.3).
//
// The catalog membership is fixed — the eight global English skills
// (see `apps/api/.../catalog/english-module-catalog.ts`); only each
// skill's platform-wide `enabled` flag is mutable. Disabling a skill
// removes it from every newly created Group, so it is confirmed via
// ConfirmDialog; enabling is non-destructive and applies immediately.
// ═════════════════════════════════════════════════════════════════

const MODULE_LABELS: Record<AdminEnglishModule['moduleType'], string> = {
  WRITING: 'Yozish',
  READING: "O'qish",
  LISTENING: 'Tinglash',
  GRAMMAR: 'Grammatika',
  SPELLING: 'Imlo',
  VOCABULARY: "Lug'at",
  SPEAKING: 'Gapirish',
  PRONUNCIATION: 'Talaffuz',
};

export function EnglishModulesTable() {
  const queryClient = useQueryClient();
  const [pendingDisable, setPendingDisable] = useState<AdminEnglishModule | null>(
    null,
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'english-modules'],
    queryFn: () => adminApi.listEnglishModules(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({
      moduleType,
      enabled,
    }: {
      moduleType: string;
      enabled: boolean;
    }) => adminApi.setEnglishModuleEnabled(moduleType, enabled, crypto.randomUUID()),
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'english-modules'] });
      toast.success(
        variables.enabled ? 'Modul yoqildi' : "Modul o'chirildi",
      );
      setPendingDisable(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi',
      );
    },
  });

  const columns: DataTableColumn<AdminEnglishModule>[] = [
    {
      id: 'moduleType',
      header: 'Modul (skill)',
      accessor: (m) => MODULE_LABELS[m.moduleType],
      sortable: true,
      cell: (m) => (
        <span className="font-semibold text-ink-strong">
          {MODULE_LABELS[m.moduleType]}
          <span className="ml-2 text-xs font-medium text-ink-faint">
            {m.moduleType}
          </span>
        </span>
      ),
    },
    {
      id: 'defaultEnabled',
      header: 'Standart holat',
      accessor: (m) => m.defaultEnabled,
      sortable: true,
      cell: (m) => (
        <span className="text-xs text-ink-soft">
          {m.defaultEnabled ? 'Yoqilgan' : "O'chirilgan"}
        </span>
      ),
    },
    {
      id: 'enabled',
      header: 'Holat',
      accessor: (m) => m.enabled,
      sortable: true,
      cell: (m) => (
        <Badge variant={m.enabled ? 'green' : 'neutral'}>
          {m.enabled ? 'Faol' : 'Nofaol'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <DataTable
        data={data ?? []}
        columns={columns}
        getRowId={(m) => m.moduleType}
        isLoading={isLoading}
        isError={isError}
        errorMessage={
          error instanceof ApiClientError
            ? error.message
            : 'Modul katalogini olishda xatolik.'
        }
        onRetry={() => void refetch()}
        emptyIcon={<BookOpen className="h-8 w-8" aria-hidden="true" />}
        labels={{
          filterPlaceholder: 'Modul nomi bo&apos;yicha qidirish...',
          emptyTitle: 'Modullar topilmadi',
          emptyDescription:
            'Ingliz tili modul katalogi hali yuklanmagan.',
        }}
        actionsHeader="Amallar"
        renderRowActions={(m) =>
          m.enabled ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-red hover:bg-red/10"
              onClick={() => setPendingDisable(m)}
            >
              O&apos;chirish
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                toggleMutation.mutate({ moduleType: m.moduleType, enabled: true })
              }
            >
              Yoqish
            </Button>
          )
        }
      />

      <ConfirmDialog
        open={pendingDisable !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisable(null);
        }}
        title="Modulni o'chirish"
        description={
          pendingDisable ? (
            <>
              <strong>{MODULE_LABELS[pendingDisable.moduleType]}</strong> modulini
              o&apos;chirmoqchimisiz? Bu skill yangi yaratiladigan barcha
              guruhlardan olib tashlanadi.
            </>
          ) : null
        }
        confirmLabel="O'chirish"
        loading={toggleMutation.isPending}
        onConfirm={() => {
          if (pendingDisable) {
            toggleMutation.mutate({
              moduleType: pendingDisable.moduleType,
              enabled: false,
            });
          }
        }}
      />
    </>
  );
}
