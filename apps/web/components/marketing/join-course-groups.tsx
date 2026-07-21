'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { isAuthenticated } from '../../lib/auth';
import { discoveryApi, type DiscoveryGroupSummary } from '../../lib/api/discovery';
import { enrollmentApi, type EnrollmentRequest } from '../../lib/api/enrollment';
import { ApiClientError } from '../../lib/api-client';

interface JoinCourseGroupsProps {
  locale: string;
  courseId: string;
}

type JoinState =
  | { kind: 'idle' }
  | { kind: 'submitting'; groupId: string }
  | { kind: 'done'; groupId: string }
  | { kind: 'error'; groupId: string; message: string };

/**
 * JoinCourseGroups — auth-aware group picker + "Qo'shilish" action for the
 * public course detail page.
 *
 * Behaviour:
 *   - Not signed in → each button routes to /login?callbackUrl=...
 *   - Signed in (student) → submits POST /enrollment/requests for the group
 *     and shows a "so'rov yuborildi" state. The teacher then approves it.
 *   - Already requested/approved groups reflect their status.
 *
 * Groups are loaded client-side from the public discovery endpoint so the
 * server component stays cacheable.
 */
export function JoinCourseGroups({ locale, courseId }: JoinCourseGroupsProps) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [groups, setGroups] = useState<DiscoveryGroupSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requestsByGroup, setRequestsByGroup] = useState<
    Record<string, EnrollmentRequest['status']>
  >({});
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'idle' });

  useEffect(() => {
    const signedIn = isAuthenticated();
    setAuthed(signedIn);

    discoveryApi
      .getCourseGroups(courseId)
      .then(setGroups)
      .catch(() => setLoadError("Guruhlarni yuklab bo'lmadi."));

    // If signed in as a student, fetch existing requests to reflect state.
    if (signedIn) {
      enrollmentApi
        .myRequests()
        .then((reqs) => {
          const map: Record<string, EnrollmentRequest['status']> = {};
          for (const r of reqs) map[r.groupId] = r.status;
          setRequestsByGroup(map);
        })
        .catch(() => {
          // Non-fatal: teacher tokens or transient errors just leave the
          // map empty so buttons show the default "join" action.
        });
    }
  }, [courseId]);

  const handleJoin = async (groupId: string) => {
    if (!isAuthenticated()) {
      const callback = `/${locale}/courses/${courseId}`;
      router.push(`/${locale}/login?callbackUrl=${encodeURIComponent(callback)}`);
      return;
    }
    setJoinState({ kind: 'submitting', groupId });
    try {
      await enrollmentApi.createRequest(groupId);
      setRequestsByGroup((prev) => ({ ...prev, [groupId]: 'PENDING_APPROVAL' }));
      setJoinState({ kind: 'done', groupId });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "So'rov yuborishda xatolik yuz berdi.";
      setJoinState({ kind: 'error', groupId, message });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-3xl border border-rim bg-canvas p-6 text-sm text-ink-soft shadow-soft">
        {loadError}
      </div>
    );
  }

  if (groups === null) {
    return (
      <div className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
        <div className="h-5 w-24 animate-pulse rounded-full bg-soft" />
        <div className="mt-4 h-16 animate-pulse rounded-2xl bg-soft" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-3xl border border-rim bg-canvas p-6 shadow-soft">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
          Guruhlar
        </h2>
        <p className="mt-3 text-sm text-ink-soft">
          Hozircha ochiq guruhlar yo&apos;q. Tez orada qo&apos;shiladi.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-blue/15 bg-blue-tint p-6 shadow-soft">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue">
        Guruhga qo&apos;shilish
      </h2>
      <p className="mt-2 text-xs text-ink-soft">
        {authed
          ? "Guruhni tanlang va qo'shilish so'rovini yuboring. Ustoz tasdiqlagach darslar ochiladi."
          : "Qo'shilish uchun avval tizimga kiring."}
      </p>

      <ul className="mt-5 space-y-3">
        {groups.map((g) => {
          const status = requestsByGroup[g.id];
          const isSubmitting =
            joinState.kind === 'submitting' && joinState.groupId === g.id;
          const justDone =
            joinState.kind === 'done' && joinState.groupId === g.id;
          const error =
            joinState.kind === 'error' && joinState.groupId === g.id
              ? joinState.message
              : null;

          return (
            <li
              key={g.id}
              className="rounded-2xl border border-rim bg-canvas p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink-strong">
                    {g.name}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                    {g.priceUzs > 0
                      ? `${formatUzs(g.priceUzs)} so'm`
                      : 'Bepul'}
                    {g.startsOn
                      ? ` · ${new Date(g.startsOn).toLocaleDateString('uz-UZ')}`
                      : ''}
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <JoinButton
                  status={status}
                  isSubmitting={isSubmitting}
                  justDone={justDone}
                  onClick={() => handleJoin(g.id)}
                />
                {error && <p className="mt-2 text-xs font-semibold text-red">{error}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function JoinButton({
  status,
  isSubmitting,
  justDone,
  onClick,
}: {
  status?: EnrollmentRequest['status'] | undefined;
  isSubmitting: boolean;
  justDone: boolean;
  onClick: () => void;
}) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-2xl border border-green/20 bg-green-tint px-4 py-2.5 text-sm font-bold text-green">
        ✓ Qo&apos;shilgansiz
      </span>
    );
  }
  if (justDone || status === 'PENDING_APPROVAL') {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-soft">
        So&apos;rov yuborildi · Tasdiq kutilmoqda
      </span>
    );
  }
  if (status === 'REJECTED') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-blue-600 disabled:opacity-60"
      >
        {isSubmitting ? 'Yuborilmoqda…' : 'Qayta urinish'}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isSubmitting}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_16px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
    >
      {isSubmitting ? 'Yuborilmoqda…' : "Qo'shilish so'rovi"}
    </button>
  );
}

function formatUzs(value: number): string {
  return new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(
    value,
  );
}
