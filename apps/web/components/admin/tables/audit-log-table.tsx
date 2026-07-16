'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';

import { adminApi, type AdminAuditLog } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge } from '../../ui/badge';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// Audit log table (task 13.2, Req 17.3/17.4).
//
// Read-only — audit rows are immutable, so there are no destructive
// actions. Reflects that administrative changes are audit-logged (Req
// 17.4). Fetches a page and applies client-side filter / sort / paginate.
// ═════════════════════════════════════════════════════════════════

const PAGE_FETCH_LIMIT = 200;

const dateTimeFormatter = new Intl.DateTimeFormat('uz-UZ', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function AuditLogTable() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'audit-logs', 'table'],
    queryFn: () => adminApi.listAuditLogs({ page: 1, limit: PAGE_FETCH_LIMIT }),
  });

  const columns: DataTableColumn<AdminAuditLog>[] = [
    {
      id: 'admin',
      header: 'Admin',
      accessor: (l) => l.adminEmail ?? l.adminId ?? 'Tizim',
      sortable: true,
      cell: (l) => (
        <span className="min-w-0">
          <span className="block truncate font-semibold text-ink-strong">
            {l.adminEmail ?? 'Tizim'}
          </span>
          {l.adminId ? (
            <span className="block truncate font-mono text-[11px] text-ink-faint">
              {l.adminId}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'action',
      header: 'Harakat',
      accessor: (l) => l.action,
      sortable: true,
      cell: (l) => <Badge variant="blue">{l.action}</Badge>,
    },
    {
      id: 'targetId',
      header: 'Obyekt',
      accessor: (l) => l.targetId ?? '',
      cell: (l) =>
        l.targetId ? (
          <code className="rounded-md bg-tint px-2 py-0.5 text-xs text-ink-soft">
            {l.targetId}
          </code>
        ) : (
          '—'
        ),
    },
    {
      id: 'ip',
      header: 'IP manzil',
      accessor: (l) => l.ip,
      sortable: true,
      cell: (l) => (
        <span className="font-mono text-xs text-ink-soft">{l.ip}</span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Sana',
      accessor: (l) => l.createdAt,
      sortable: true,
      cell: (l) => (
        <span className="text-xs text-ink-soft">
          {dateTimeFormatter.format(new Date(l.createdAt))}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={data?.items ?? []}
      columns={columns}
      getRowId={(l) => l.id}
      isLoading={isLoading}
      isError={isError}
      errorMessage={
        error instanceof ApiClientError
          ? error.message
          : 'Audit loglarni olishda xatolik.'
      }
      onRetry={() => void refetch()}
      pageSize={15}
      emptyIcon={<History className="h-8 w-8" aria-hidden="true" />}
      labels={{
        filterPlaceholder: 'Admin, harakat yoki IP bo&apos;yicha qidirish...',
        emptyTitle: 'Audit yozuvlari topilmadi',
      }}
    />
  );
}
