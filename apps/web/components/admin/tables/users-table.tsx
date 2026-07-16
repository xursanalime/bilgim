'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldBan, UserCheck, Users as UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { adminApi, type AdminUser } from '../../../lib/api/admin';
import { ApiClientError } from '../../../lib/api-client';
import { Badge, type BadgeProps } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { toast } from '../../ui/toast';
import { ConfirmDialog } from '../confirm-dialog';
import { DataTable, type DataTableColumn } from '../data-table';

// ═════════════════════════════════════════════════════════════════
// Users management table (task 13.2, Req 17.2/17.3).
//
// Fetches a page of users once and applies client-side filter / sort /
// pagination through the shared DataTable. Suspending a user is a
// destructive, audit-logged action and is confirmed via ConfirmDialog.
// ═════════════════════════════════════════════════════════════════

const PAGE_FETCH_LIMIT = 200;

const ROLE_LABELS: Record<AdminUser['role'], string> = {
  STUDENT: 'Talaba',
  TEACHER: "O'qituvchi",
  ADMIN: 'Admin',
};

const STATUS_META: Record<
  AdminUser['status'],
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  ACTIVE: { label: 'Faol', variant: 'green' },
  SUSPENDED: { label: 'Bloklangan', variant: 'red' },
  PENDING_VERIFY: { label: 'Tasdiqlanmagan', variant: 'orange' },
};

const dateFormatter = new Intl.DateTimeFormat('uz-UZ', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function UsersTable() {
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pendingSuspend, setPendingSuspend] = useState<AdminUser | null>(null);

  // Debounce the free-text query so each keystroke doesn't hit the API. The
  // backend matches email, full name AND the 6-digit publicId against `q`.
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', 'table', q],
    queryFn: () =>
      adminApi.listUsers({
        page: 1,
        limit: PAGE_FETCH_LIMIT,
        ...(q ? { q } : {}),
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AdminUser['status'] }) =>
      adminApi.updateUserStatus(id, status, crypto.randomUUID()),
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(
        variables.status === 'SUSPENDED'
          ? 'Foydalanuvchi bloklandi'
          : 'Foydalanuvchi faollashtirildi',
      );
      setPendingSuspend(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi',
      );
    },
  });

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    return roleFilter ? items.filter((u) => u.role === roleFilter) : items;
  }, [data, roleFilter]);

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'publicId',
      header: 'ID',
      accessor: (u) => u.publicId,
      sortable: true,
      cell: (u) => (
        <span className="font-mono text-xs font-semibold text-ink-soft">
          {u.publicId}
        </span>
      ),
    },
    {
      id: 'fullName',
      header: 'Foydalanuvchi',
      accessor: (u) => `${u.fullName} ${u.email}`,
      sortable: true,
      cell: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue/10 text-xs font-bold text-blue">
            {u.fullName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink-strong">
              {u.fullName}
            </span>
            <span className="block truncate text-xs text-ink-soft">{u.email}</span>
          </span>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Rol',
      accessor: (u) => u.role,
      sortable: true,
      cell: (u) => ROLE_LABELS[u.role],
    },
    {
      id: 'status',
      header: 'Holat',
      accessor: (u) => u.status,
      sortable: true,
      cell: (u) => {
        const meta = STATUS_META[u.status];
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    {
      id: 'createdAt',
      header: "Ro'yxatdan o'tgan",
      accessor: (u) => u.createdAt,
      sortable: true,
      cell: (u) => dateFormatter.format(new Date(u.createdAt)),
    },
  ];

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(u) => u.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={
          error instanceof ApiClientError
            ? error.message
            : "Foydalanuvchilarni olishda xatolik."
        }
        onRetry={() => void refetch()}
        emptyIcon={<UsersIcon className="h-8 w-8" aria-hidden="true" />}
        hideFilter
        labels={{
          emptyTitle: 'Foydalanuvchilar topilmadi',
        }}
        toolbar={
          <>
            <div className="w-full sm:max-w-xs">
              <label className="sr-only" htmlFor="users-search">
                Foydalanuvchilarni qidirish
              </label>
              <Input
                id="users-search"
                type="search"
                inputSize="sm"
                placeholder="Email, ism yoki ID (6 xonali) bo'yicha qidirish"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
            <div className="w-44">
              <label className="sr-only" htmlFor="users-role-filter">
                Rol bo'yicha filtr
              </label>
              <Select
                id="users-role-filter"
                selectSize="sm"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">Barcha rollar</option>
                <option value="STUDENT">Talabalar</option>
                <option value="TEACHER">O&apos;qituvchilar</option>
                <option value="ADMIN">Adminlar</option>
              </Select>
            </div>
          </>
        }
        actionsHeader="Amallar"
        renderRowActions={(u) =>
          u.status === 'SUSPENDED' ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<UserCheck className="h-4 w-4" aria-hidden="true" />}
              onClick={() =>
                statusMutation.mutate({ id: u.id, status: 'ACTIVE' })
              }
            >
              Faollashtirish
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-red hover:bg-red/10"
              leftIcon={<ShieldBan className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setPendingSuspend(u)}
            >
              Bloklash
            </Button>
          )
        }
      />

      <ConfirmDialog
        open={pendingSuspend !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSuspend(null);
        }}
        title="Foydalanuvchini bloklash"
        description={
          pendingSuspend ? (
            <>
              <strong>{pendingSuspend.fullName}</strong> hisobini bloklamoqchimisiz?
              Ular tizimga kira olmaydi. Bu amal audit jurnaliga yoziladi.
            </>
          ) : null
        }
        confirmLabel="Bloklash"
        loading={statusMutation.isPending}
        onConfirm={() => {
          if (pendingSuspend) {
            statusMutation.mutate({ id: pendingSuspend.id, status: 'SUSPENDED' });
          }
        }}
      />
    </>
  );
}
