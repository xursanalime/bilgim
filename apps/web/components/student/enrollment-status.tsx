'use client';

import Link from 'next/link';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Clock,
  CreditCard,
  CheckCircle2,
  XCircle,
  Ban,
  ArrowRight,
  Inbox,
} from 'lucide-react';

import { enrollmentApi, type EnrollmentRequest, type EnrollmentStatus } from '../../lib/api/enrollment';
import { billingApi } from '../../lib/api/billing';
import { studentApi } from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';
import { Badge, type BadgeProps } from '../ui/badge';
import { Button } from '../ui/button';
import { LoadingState, ErrorState, EmptyState } from '../states';

// ═════════════════════════════════════════════════════════════════
// EnrollmentStatus (Task 5.3 — Req 9.5)
//
// Learner-facing list of the student's own enrollment requests with
// clear, per-status states:
//   PENDING_PAYMENT  → "Payme orqali to'lash" CTA (billingApi.checkout)
//   PENDING_APPROVAL → awaiting teacher; cancellable
//   APPROVED         → link into the group/course
//   REJECTED/REVOKED → terminal, with reason when the backend supplies one
//
// Data comes from enrollmentApi.myRequests(). Group names are resolved
// per-request via studentApi.getGroup (cached by the shared query key).
// ═════════════════════════════════════════════════════════════════

interface EnrollmentStatusProps {
  locale: string;
  /** Optional heading; omit to render the list bare (e.g. embedded in a page). */
  heading?: string;
}

interface StatusMeta {
  label: string;
  badge: NonNullable<BadgeProps['variant']>;
  description: string;
}

const STATUS_META: Record<EnrollmentStatus, StatusMeta> = {
  PENDING_PAYMENT: {
    label: 'Toʻlov kutilmoqda',
    badge: 'orange',
    description: "Aʼzolikni faollashtirish uchun toʻlovni amalga oshiring.",
  },
  PENDING_APPROVAL: {
    label: 'Tasdiq kutilmoqda',
    badge: 'blue',
    description: "Oʻqituvchi soʻrovingizni koʻrib chiqmoqda.",
  },
  APPROVED: {
    label: 'Tasdiqlangan',
    badge: 'green',
    description: "Soʻrovingiz tasdiqlandi. Guruhga kirishingiz mumkin.",
  },
  REJECTED: {
    label: 'Rad etilgan',
    badge: 'red',
    description: "Afsuski, soʻrovingiz rad etildi.",
  },
  REVOKED: {
    label: 'Bekor qilingan',
    badge: 'neutral',
    description: "Aʼzoligingiz bekor qilindi.",
  },
};

function StatusIcon({ status }: { status: EnrollmentStatus }) {
  const cls = 'h-5 w-5';
  switch (status) {
    case 'PENDING_PAYMENT':
      return <CreditCard className={cls} />;
    case 'PENDING_APPROVAL':
      return <Clock className={cls} />;
    case 'APPROVED':
      return <CheckCircle2 className={cls} />;
    case 'REJECTED':
      return <XCircle className={cls} />;
    case 'REVOKED':
      return <Ban className={cls} />;
  }
}

const ICON_TONE: Record<EnrollmentStatus, string> = {
  PENDING_PAYMENT: 'bg-orange-tint text-orange',
  PENDING_APPROVAL: 'bg-blue-tint text-blue',
  APPROVED: 'bg-green-tint text-green',
  REJECTED: 'bg-red-tint text-red',
  REVOKED: 'bg-soft text-ink-soft',
};

export function EnrollmentStatus({ locale, heading }: EnrollmentStatusProps) {
  const requestsQuery = useQuery({
    queryKey: ['student', 'requests'],
    queryFn: () => enrollmentApi.myRequests(),
  });

  const requests = useMemo(() => {
    const order: Record<EnrollmentStatus, number> = {
      PENDING_PAYMENT: 0,
      PENDING_APPROVAL: 1,
      APPROVED: 2,
      REJECTED: 3,
      REVOKED: 4,
    };
    return [...(requestsQuery.data ?? [])].sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) return byStatus;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [requestsQuery.data]);

  // Resolve group names for each request (cached + shared with other views).
  const groupQueries = useQueries({
    queries: requests.map((req) => ({
      queryKey: ['catalog', 'group', req.groupId],
      queryFn: () => studentApi.getGroup(req.groupId),
      enabled: requests.length > 0,
    })),
  });

  if (requestsQuery.isLoading) {
    return <LoadingState variant="list" count={2} label="Soʻrovlar yuklanmoqda…" />;
  }

  if (requestsQuery.isError) {
    return (
      <ErrorState
        title="Soʻrovlarni yuklab boʻlmadi"
        message={
          requestsQuery.error instanceof ApiClientError
            ? requestsQuery.error.message
            : "Aʼzolik soʻrovlarini yuklashda xato yuz berdi."
        }
        onRetry={() => requestsQuery.refetch()}
        retryLabel="Qayta urinish"
      />
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10" />}
        title="Aʼzolik soʻrovlari yoʻq"
        description="Hali birorta guruhga soʻrov yubormagansiz. Kod orqali yoki kurslarni qidirib qoʻshiling."
      />
    );
  }

  return (
    <section className="space-y-4">
      {heading ? (
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-extrabold uppercase tracking-wider text-ink-strong">
            {heading}
          </h2>
          <div className="h-px flex-1 bg-rim" />
        </div>
      ) : null}

      <ul className="grid gap-4">
        {requests.map((req, idx) => (
          <li key={req.id}>
            <EnrollmentRow
              request={req}
              locale={locale}
              groupName={groupQueries[idx]?.data?.name ?? null}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EnrollmentRow({
  request,
  locale,
  groupName,
}: {
  request: EnrollmentRequest;
  locale: string;
  groupName: string | null;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const meta = STATUS_META[request.status];

  const cancelMutation = useMutation({
    mutationFn: () => enrollmentApi.cancelRequest(request.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['student', 'requests'] });
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiClientError ? err.message : "Soʻrovni bekor qilishda xato.",
      );
    },
  });

  const payMutation = useMutation({
    mutationFn: () =>
      billingApi.checkout({ kind: 'STUDENT_COURSE', groupId: request.groupId }),
    onSuccess: (res) => {
      setActionError(null);
      if (res?.payUrl) {
        window.location.assign(res.payUrl);
      } else {
        setActionError("Toʻlov havolasini olishda xato.");
      }
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiClientError ? err.message : "Toʻlovni boshlashda xato.",
      );
    },
  });

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-rim bg-white p-5 shadow-soft transition-all hover:border-blue/10 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ICON_TONE[request.status]}`}
          aria-hidden="true"
        >
          <StatusIcon status={request.status} />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-base font-extrabold text-ink-strong">
            {groupName ?? '…'}
          </p>
          <p className="mt-0.5 text-xs font-medium text-ink-soft">{meta.description}</p>
          {(request.status === 'REJECTED' || request.status === 'REVOKED') && request.reason ? (
            <p className="mt-1.5 text-xs text-ink-soft">
              <span className="font-semibold text-ink-strong">Sabab:</span> {request.reason}
            </p>
          ) : null}
          {actionError ? (
            <p className="mt-1.5 text-xs font-semibold text-red" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end md:flex-row md:items-center">
        <Badge variant={meta.badge}>{meta.label}</Badge>

        {request.status === 'PENDING_PAYMENT' ? (
          <Button
            type="button"
            size="sm"
            loading={payMutation.isPending}
            leftIcon={<CreditCard className="h-4 w-4" />}
            onClick={() => payMutation.mutate()}
          >
            Payme orqali toʻlash
          </Button>
        ) : null}

        {request.status === 'PENDING_APPROVAL' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Bekor qilish
          </Button>
        ) : null}

        {request.status === 'APPROVED' ? (
          <Button
            asChild
            size="sm"
            variant="outline"
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            <Link href={`/${locale}/groups/${request.groupId}`}>Guruhga kirish</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
