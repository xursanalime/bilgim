'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  Inbox,
  Layers,
  MessageSquare,
  UserCheck,
  XCircle,
} from 'lucide-react';

import {
  enrollmentApi,
  type EnrollmentRequest,
} from '../../lib/api/enrollment';
import { studentApi } from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { toast } from '../ui/toast';
import { EmptyState, ErrorState, LoadingState } from '../states';

// ═══════════════════════════════════════════════════════════════════
// RequestsQueue — instructor inbox of pending enrollment requests.
//
// Task 5.2 (Req 9.3, 9.4):
//   • List PENDING_APPROVAL join requests across the teacher's groups
//     (student name/email, group, optional message, submitted time).
//   • Approve / reject each request OPTIMISTICALLY: snapshot the cache,
//     drop the row immediately, and roll back if the request fails.
//   • Share the SAME query key as `hooks/use-pending-requests.ts`
//     (`['enrollment', 'requests', 'pending']`) so the sidebar/top-nav
//     badge counts update live off the same cached data, and a single
//     invalidate refreshes both the list and the nav counters.
// ═══════════════════════════════════════════════════════════════════

/**
 * Query key shared with `usePendingRequests` (the nav-count hook). Editing
 * this cache entry optimistically also moves the sidebar/top-nav badges,
 * and invalidating it refetches the list and the counts in one shot.
 */
const PENDING_REQUESTS_KEY = ['enrollment', 'requests', 'pending'] as const;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

interface OptimisticContext {
  previous: EnrollmentRequest[] | undefined;
}

export function RequestsQueue() {
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: PENDING_REQUESTS_KEY,
    queryFn: () => enrollmentApi.pendingRequests(),
  });

  // Shared optimistic lifecycle for approve + reject: both decisions
  // remove the request from the pending list. The only difference is the
  // mutation function and the toast copy.
  function buildDecisionHandlers(successCopy: string, errorCopy: string) {
    return {
      onMutate: async (id: string): Promise<OptimisticContext> => {
        // Cancel in-flight refetches so they don't clobber our snapshot.
        await queryClient.cancelQueries({ queryKey: PENDING_REQUESTS_KEY });
        const previous = queryClient.getQueryData<EnrollmentRequest[]>(
          PENDING_REQUESTS_KEY,
        );
        // Drop the decided request immediately — this also shrinks the
        // nav badge counts because they read the same cache entry.
        queryClient.setQueryData<EnrollmentRequest[]>(
          PENDING_REQUESTS_KEY,
          (current) => (current ?? []).filter((r) => r.id !== id),
        );
        return { previous };
      },
      onError: (err: unknown, _id: string, context?: OptimisticContext) => {
        // Roll back to the pre-mutation snapshot.
        if (context?.previous !== undefined) {
          queryClient.setQueryData(PENDING_REQUESTS_KEY, context.previous);
        }
        toast.error(errorMessage(err, errorCopy));
      },
      onSuccess: () => {
        toast.success(successCopy);
      },
      onSettled: () => {
        // Re-sync the list and the nav-count badges from the server.
        void queryClient.invalidateQueries({ queryKey: PENDING_REQUESTS_KEY });
      },
    };
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => enrollmentApi.approveRequest(id),
    ...buildDecisionHandlers('Soʻrov tasdiqlandi', 'Tasdiqlab boʻlmadi'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => enrollmentApi.rejectRequest(id),
    ...buildDecisionHandlers('Soʻrov rad etildi', 'Rad etib boʻlmadi'),
  });

  const requests = requestsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <header className="relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue/5 blur-[80px]" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
              <UserCheck className="h-3.5 w-3.5" />
              Soʻrovlar qutisi
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                Qoʻshilish soʻrovlari
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80">
                Guruhlaringizga qoʻshilmoqchi boʻlgan oʻquvchilarning
                arizalarini koʻrib chiqing va tasdiqlang yoki rad eting.
              </p>
            </div>
          </div>

          {!requestsQuery.isLoading && requests.length > 0 && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/5 text-blue">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  Kutilmoqda
                </p>
                <p className="text-sm font-black text-ink-strong">
                  {requests.length} ta soʻrov
                </p>
              </div>
            </div>
          )}
        </div>
      </header>

      {requestsQuery.isLoading ? (
        <LoadingState variant="list" count={3} label="Soʻrovlar yuklanmoqda" />
      ) : requestsQuery.isError ? (
        <ErrorState
          icon={<XCircle className="h-10 w-10" />}
          title="Soʻrovlarni yuklab boʻlmadi"
          message={errorMessage(
            requestsQuery.error,
            'Soʻrovlar roʻyxatini olishda xatolik yuz berdi.',
          )}
          retryLabel="Qayta urinish"
          onRetry={() => void requestsQuery.refetch()}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10" />}
          title="Hozircha soʻrovlar yoʻq"
          description="Oʻquvchilar guruhga qoʻshilish uchun soʻrov yuborganda, ular shu yerda paydo boʻladi."
        />
      ) : (
        <ul className="grid gap-4">
          {requests.map((req) => (
            <li key={req.id}>
              <RequestRow
                request={req}
                onApprove={() => approveMutation.mutate(req.id)}
                onReject={() => rejectMutation.mutate(req.id)}
                isApproving={
                  approveMutation.isPending &&
                  approveMutation.variables === req.id
                }
                isRejecting={
                  rejectMutation.isPending &&
                  rejectMutation.variables === req.id
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestRow({
  request,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  request: EnrollmentRequest;
  onApprove: () => void;
  onReject: () => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  // Group name isn't part of the request payload; resolve it lazily and
  // cache it (shared key with the rest of the dashboard).
  const groupQuery = useQuery({
    queryKey: ['catalog', 'group', request.groupId],
    queryFn: () => studentApi.getGroup(request.groupId),
  });

  const busy = isApproving || isRejecting;
  const student = request.student?.user;
  const submittedAt = new Date(request.createdAt).toLocaleString('uz-UZ', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="group relative overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:border-blue/20 hover:shadow-medium">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar size="lg">
            {student?.avatarUrl ? (
              <AvatarImage src={student.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback>{initials(student?.fullName)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 space-y-1.5">
            <h3 className="truncate font-display text-lg font-extrabold text-ink-strong">
              {student?.fullName || 'Nomaʼlum oʻquvchi'}
            </h3>
            {student?.email ? (
              <p className="truncate text-xs font-medium text-ink-faint">
                {student.email}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                <Layers className="h-3.5 w-3.5 text-purple" />
                {groupQuery.data?.name ?? '…'}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-faint">
                <Clock className="h-3.5 w-3.5" />
                {submittedAt}
              </span>
              <Badge variant="orange" size="sm">
                Kutilmoqda
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onReject}
            disabled={busy}
            loading={isRejecting}
            leftIcon={isRejecting ? undefined : <XCircle className="h-4 w-4" />}
          >
            Rad etish
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onApprove}
            disabled={busy}
            loading={isApproving}
            leftIcon={
              isApproving ? undefined : <CheckCircle2 className="h-4 w-4" />
            }
          >
            Tasdiqlash
          </Button>
        </div>
      </div>

      {request.message ? (
        <div className="mt-5 rounded-2xl border border-rim/50 bg-tint/50 p-4">
          <div className="flex gap-3">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue/40" />
            <p className="text-sm italic leading-relaxed text-ink-soft">
              “{request.message}”
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
