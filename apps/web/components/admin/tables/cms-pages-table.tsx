'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { adminApi, type AdminCmsPage } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { toast } from '../../ui/toast';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// CMS pages table (task 13.2, Req 17.2/17.3).
//
// CONSISTENT STUB: the current CMS surface is key/value based
// (`/admin/system-settings`). This page-oriented table follows the same
// data-table + confirm-destructive pattern as the other admin tables but
// is backed by assumed endpoints (`GET /admin/cms/pages`,
// `DELETE /admin/cms/pages/:id` — see `lib/api/admin.ts`). Until those
// land, it degrades gracefully to an empty state.
// ═════════════════════════════════════════════════════════════════

const dateFormatter = new Intl.DateTimeFormat('uz-UZ', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function CmsPagesTable() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<AdminCmsPage | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'cms-pages'],
    queryFn: () => adminApi.listCmsPages(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteCmsPage(id, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'cms-pages'] });
      toast.success("Sahifa o'chirildi");
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi',
      );
    },
  });

  const columns: DataTableColumn<AdminCmsPage>[] = [
    {
      id: 'titleUz',
      header: 'Sahifa',
      accessor: (p) => `${p.titleUz} ${p.slug}`,
      sortable: true,
      cell: (p) => (
        <span className="min-w-0">
          <span className="block font-semibold text-ink-strong">{p.titleUz}</span>
          <span className="block text-xs text-ink-soft">/{p.slug}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Holat',
      accessor: (p) => p.status,
      sortable: true,
      cell: (p) => (
        <Badge variant={p.status === 'PUBLISHED' ? 'green' : 'orange'}>
          {p.status === 'PUBLISHED' ? 'Chop etilgan' : 'Qoralama'}
        </Badge>
      ),
    },
    {
      id: 'updatedAt',
      header: 'Yangilangan',
      accessor: (p) => p.updatedAt,
      sortable: true,
      cell: (p) => (
        <span className="text-xs text-ink-soft">
          {dateFormatter.format(new Date(p.updatedAt))}
        </span>
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
            : 'CMS sahifalarini olishda xatolik.'
        }
        onRetry={() => void refetch()}
        emptyIcon={<FileText className="h-8 w-8" aria-hidden="true" />}
        labels={{
          filterPlaceholder: 'Sahifa nomi bo&apos;yicha qidirish...',
          emptyTitle: 'CMS sahifalari topilmadi',
          emptyDescription:
            'Hali birorta sahifa qo&apos;shilmagan yoki endpoint mavjud emas.',
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
        title="Sahifani o'chirish"
        description={
          pendingDelete ? (
            <>
              <strong>{pendingDelete.titleUz}</strong> sahifasini
              o&apos;chirmoqchimisiz? Bu amalni ortga qaytarib bo&apos;lmaydi.
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
