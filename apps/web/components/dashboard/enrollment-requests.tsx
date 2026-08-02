'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  UserCheck, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  MessageSquare, 
  Layers, 
  User, 
  ChevronRight,
  AlertCircle
} from 'lucide-react';

import { enrollmentApi, type EnrollmentRequest } from '../../lib/api/enrollment';
import { studentApi } from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

/**
 * EnrollmentRequests — teacher inbox of pending join requests.
 */
export function EnrollmentRequests() {
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ['teacher', 'enrollment-requests'],
    queryFn: () => enrollmentApi.pendingRequests(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => enrollmentApi.approveRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['teacher', 'enrollment-requests'],
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => enrollmentApi.rejectRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['teacher', 'enrollment-requests'],
      });
    },
  });

  const requests = requestsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12">
      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        {/* Aurora glow */}
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
                Guruhlaringizga qoʻshilish istagida boʻlgan talabalarning arizalarini koʻrib chiqing va tasdiqlang.
              </p>
            </div>
          </div>

          {!requestsQuery.isLoading && requests.length > 0 && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/5 text-blue">
                <Clock className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Kutilmoqda</p>
                <p className="text-sm font-black text-ink-strong">{requests.length} ta soʻrov</p>
              </div>
            </div>
          )}
        </div>
      </header>

      {requestsQuery.isError && (
        <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {requestsQuery.error instanceof ApiClientError
            ? requestsQuery.error.message
            : "Soʻrovlarni yuklab boʻlmadi."}
        </div>
      )}

      {requestsQuery.isLoading ? (
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 w-full animate-pulse rounded-3xl bg-white border border-rim" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-rim bg-white p-12 text-center shadow-soft">
          <div className="relative mb-6">
            <div className="absolute -inset-4 rounded-full bg-blue/5 blur-xl animate-pulse" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue/10 text-blue shadow-sm">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          </div>
          <h2 className="font-display text-xl font-extrabold text-ink-strong">
            Hozircha soʻrovlar yoʻq
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
            Talabalar guruhga qoʻshilish uchun soʻrov yuborganida, ular shu yerda paydo boʻladi.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((req) => (
            <RequestRow
              key={req.id}
              request={req}
              onApprove={() => approveMutation.mutate(req.id)}
              onReject={() => rejectMutation.mutate(req.id)}
              isApproving={
                approveMutation.isPending &&
                approveMutation.variables === req.id
              }
              isRejecting={
                rejectMutation.isPending && rejectMutation.variables === req.id
              }
            />
          ))}
        </div>
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
  const groupQuery = useQuery({
    queryKey: ['catalog', 'group', request.groupId],
    queryFn: () => studentApi.getGroup(request.groupId),
  });

  const busy = isApproving || isRejecting;
  const student = request.student?.user;

  return (
    <div className="group relative overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all duration-300 hover:shadow-medium hover:border-blue/20">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-tint border border-rim transition-colors group-hover:border-blue/20">
            {student?.avatarUrl ? (
              <img src={student.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <User className="h-7 w-7 text-ink-faint" />
            )}
            <div className="absolute inset-0 bg-blue/5 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <div className="min-w-0 space-y-1">
            <h3 className="font-display text-lg font-extrabold text-ink-strong group-hover:text-blue transition-colors">
              {student?.fullName || 'Nomaʼlum talaba'}
            </h3>
            
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
                <Layers className="h-3.5 w-3.5 text-purple" />
                <span>{groupQuery.data?.name || '...'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink-faint">
                <Clock className="h-3.5 w-3.5" />
                <span>{new Date(request.createdAt).toLocaleDateString('uz-UZ', { 
                  month: 'short', 
                  day: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rim bg-white px-5 text-sm font-bold text-ink-soft transition-all hover:bg-red-tint hover:text-red hover:border-red/20 active:scale-[0.98] disabled:opacity-60"
          >
            {isRejecting ? (
              <span className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-red border-t-transparent" />
                Rad etilmoqda
              </span>
            ) : (
              <>
                <XCircle className="h-4.5 w-4.5" />
                Rad etish
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-blue px-6 text-sm font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
          >
            {isApproving ? (
              <span className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Tasdiqlanmoqda
              </span>
            ) : (
              <>
                <CheckCircle2 className="h-4.5 w-4.5" />
                Tasdiqlash
              </>
            )}
          </button>
        </div>
      </div>

      {request.message && (
        <div className="mt-5 rounded-2xl bg-tint/50 border border-rim/50 p-4 transition-colors group-hover:bg-blue-tint/30 group-hover:border-blue/10">
          <div className="flex gap-3">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue/40" />
            <p className="text-sm leading-relaxed text-ink-soft italic">
              “{request.message}”
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
