'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { adminApi, type AdminExamTrack } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { toast } from '../../ui/toast';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// Exam_Track options table (task 13.2, Req 17.2).
//
// Lists the admin-managed exam-prep tracks (e.g. IELTS) that instructors
// can focus on during onboarding. Deleting a track is destructive (it is
// referenced by `examTrackFocus`), so it is confirmed via ConfirmDialog.
// ═════════════════════════════════════════════════════════════════

export function ExamTracksTable() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<AdminExamTrack | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'exam-tracks'],
    queryFn: () => adminApi.listExamTracks(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteExamTrack(id, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'exam-tracks'] });
      toast.success("Exam_Track o'chirildi");
      setPendingDelete(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi',
      );
    },
  });

  const columns: DataTableColumn<AdminExamTrack>[] = [
    {
      id: 'nameUz',
      header: 'Nomi',
      accessor: (t) => `${t.nameUz} ${t.nameEn} ${t.slug}`,
      sortable: true,
      cell: (t) => (
        <span className="min-w-0">
          <span className="block font-semibold text-ink-strong">{t.nameUz}</span>
          <span className="block text-xs text-ink-soft">{t.nameEn}</span>
        </span>
      ),
    },
    {
      id: 'slug',
      header: 'Slug',
      accessor: (t) => t.slug,
      sortable: true,
      cell: (t) => (
        <code className="rounded-md bg-tint px-2 py-0.5 text-xs text-ink-soft">
          {t.slug}
        </code>
      ),
    },
    {
      id: 'instructorCount',
      header: "O'qituvchilar",
      accessor: (t) => t.instructorCount ?? 0,
      sortable: true,
      align: 'right',
      cell: (t) => (
        <span className="tabular-nums text-ink-strong">
          {t.instructorCount ?? 0}
        </span>
      ),
    },
    {
      id: 'isActive',
      header: 'Holat',
      accessor: (t) => t.isActive,
      sortable: true,
      cell: (t) => (
        <Badge variant={t.isActive ? 'green' : 'neutral'}>
          {t.isActive ? 'Faol' : 'Nofaol'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <DataTable
        data={data ?? []}
        columns={columns}
        getRowId={(t) => t.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={
          error instanceof ApiClientError
            ? error.message
            : 'Exam_Track ro&apos;yxatini olishda xatolik.'
        }
        onRetry={() => void refetch()}
        emptyIcon={<GraduationCap className="h-8 w-8" aria-hidden="true" />}
        labels={{
          filterPlaceholder: 'Track nomi bo&apos;yicha qidirish...',
          emptyTitle: 'Exam_Track topilmadi',
          emptyDescription:
            'Hali birorta imtihon yo&apos;nalishi qo&apos;shilmagan.',
        }}
        actionsHeader="Amallar"
        renderRowActions={(t) => (
          <Button
            size="sm"
            variant="ghost"
            className="text-red hover:bg-red/10"
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setPendingDelete(t)}
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
        title="Exam_Track o'chirish"
        description={
          pendingDelete ? (
            <>
              <strong>{pendingDelete.nameUz}</strong> ({pendingDelete.slug})
              yo&apos;nalishini o&apos;chirmoqchimisiz? Bu amalni ortga qaytarib
              bo&apos;lmaydi.
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
