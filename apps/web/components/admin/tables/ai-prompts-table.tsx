'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { adminApi, type AdminAiPromptTemplate } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { toast } from '../../ui/toast';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// AI prompt templates table (task 13.2, Req 17.2/17.3).
//
// Consistent management-table view over the AI prompt catalog with a
// destructive delete confirmed via ConfirmDialog. Create / full edit
// continue to live on the existing `/admin/ai` editor surface.
// ═════════════════════════════════════════════════════════════════

export function AiPromptsTable() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] =
    useState<AdminAiPromptTemplate | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'ai-prompts'],
    queryFn: () => adminApi.listAiPrompts(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteAiPrompt(id, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ai-prompts'] });
      toast.success("Prompt o'chirildi");
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi',
      );
    },
  });

  const columns: DataTableColumn<AdminAiPromptTemplate>[] = [
    {
      id: 'key',
      header: 'Kalit',
      accessor: (p) => p.key,
      sortable: true,
      cell: (p) => <span className="font-semibold text-ink-strong">{p.key}</span>,
    },
    {
      id: 'intent',
      header: 'Intent',
      accessor: (p) => p.intent,
      sortable: true,
      cell: (p) => <Badge variant="blue">{p.intent}</Badge>,
    },
    {
      id: 'modelName',
      header: 'Model',
      accessor: (p) => p.modelName,
      sortable: true,
    },
    {
      id: 'maxTokens',
      header: 'Max tokens',
      accessor: (p) => p.maxTokens,
      sortable: true,
      align: 'right',
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
            : 'AI promptlarni olishda xatolik.'
        }
        onRetry={() => void refetch()}
        emptyIcon={<Sparkles className="h-8 w-8" aria-hidden="true" />}
        labels={{
          filterPlaceholder: 'Kalit, intent yoki model bo&apos;yicha qidirish...',
          emptyTitle: 'Promptlar topilmadi',
        }}
        actionsHeader="Amallar"
        renderRowActions={(p) => (
          <Button
            size="sm"
            variant="ghost"
            className="text-red hover:bg-red/10"
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setPendingDelete(p)}
          >
            O&apos;chirish
          </Button>
        )}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Promptni o'chirish"
        description={
          pendingDelete ? (
            <>
              <strong>{pendingDelete.key}</strong> promptini o&apos;chirmoqchimisiz?
              Bu AI intentini ishlamay qolishiga olib kelishi mumkin.
            </>
          ) : null
        }
        confirmLabel="O'chirish"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </>
  );
}
