'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2, Play, ArrowLeft, RefreshCw, Lock } from 'lucide-react';

import { liveApi, JoinSessionResult } from '../../lib/api/live';
import { lessonsApi, groupsApi } from '../../lib/api/catalog';
import { getUserRole, getCurrentUser } from '../../lib/auth';

/** Host broadcasting UI (Live_Studio, task 3.1) — untouched, teacher-only. */
const LiveRoom = dynamic(
  () => import('../live-room/LiveRoom').then((m) => m.LiveRoom),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-blue" aria-hidden="true" />
      </div>
    ),
  },
);

/** Learner watching UI (Live_Viewer, task 3.2) — light, consumer-only. */
const LiveViewer = dynamic(
  () => import('../live-room/LiveViewer').then((m) => m.LiveViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-blue" aria-hidden="true" />
      </div>
    ),
  },
);

interface LiveSessionJoinProps {
  locale: string;
  lessonId: string;
}

/**
 * Mask an email for a forensic watermark fallback (e.g. `j••@mail.com`).
 *
 * Forensic integrity prefers the SERVER-derived label from the join ticket
 * (`data.watermark.label`, Req 3.5). This local fallback only guarantees the
 * watermark overlay is never absent when the backend has not yet surfaced the
 * label; it is intentionally PII-masked and never sent anywhere.
 */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'viewer';
  const head = user.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}

function resolveWatermarkLabel(data: JoinSessionResult): string {
  const serverLabel = data.watermark?.label?.trim();
  if (serverLabel) return serverLabel;

  // Fallback (see maskEmail): masked viewer identity + short session id.
  const user = getCurrentUser();
  const masked = user?.email ? maskEmail(user.email) : 'viewer';
  const short = data.session?.id?.slice(0, 4) ?? '';
  return short ? `${masked} • ${short}` : masked;
}

export function LiveSessionJoin({ locale, lessonId }: LiveSessionJoinProps) {
  const [data, setData] = useState<JoinSessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  // Deep link back to the lesson page so leaving/ending the broadcast returns
  // the user *into the lesson* (not the dashboard). Resolved once: lesson →
  // group → course. Falls back to the dashboard if resolution fails (e.g. a
  // viewer without catalog access).
  const lessonHrefRef = useRef<string | null>(null);
  const hasLeftRef = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const lesson = await lessonsApi.get(lessonId);
        const group = await groupsApi.get(lesson.groupId);
        if (active) {
          lessonHrefRef.current = `/${locale}/dashboard/courses/${group.courseId}/groups/${group.id}/lessons/${lessonId}`;
        }
      } catch {
        // Leave the fallback (dashboard) in place.
      }
    })();
    return () => {
      active = false;
    };
  }, [lessonId, locale]);

  const tryJoin = async (): Promise<boolean> => {
    try {
      const response = await liveApi.join(lessonId);
      setData(response);
      setError(null);
      return true;
    } catch (err: any) {
      const code = err?.statusCode ?? err?.status;
      if (code === 404) {
        // No live session in progress yet.
        setError('LIVE_NOT_STARTED');
      } else if (code === 403) {
        // APPROVED-only gating (Req 7.3): not enrolled / not approved.
        setError('NOT_APPROVED');
      } else {
        setError('Live efirga ulanishda xatolik yuz berdi.');
      }
      return false;
    }
  };

  useEffect(() => {
    const role = getUserRole();
    setIsTeacher(role === 'TEACHER');

    void tryJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // Student: auto-poll every 5s when session not started yet.
  useEffect(() => {
    if (error !== 'LIVE_NOT_STARTED' || isTeacher) return;

    pollRef.current = setInterval(async () => {
      setPollCount((c) => c + 1);
      const joined = await tryJoin();
      if (joined && pollRef.current) clearInterval(pollRef.current);
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, isTeacher]);

  const handleStart = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await liveApi.start(lessonId);
      await tryJoin();
    } catch {
      setError('Efirni boshlashda xatolik yuz berdi.');
    } finally {
      setIsStarting(false);
    }
  };

  // APPROVED-only gating: clear "not approved / not enrolled" state (Req 7.3).
  if (error === 'NOT_APPROVED') {
    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-center justify-center bg-surface p-6 text-ink-strong"
      >
        <div className="w-full max-w-md space-y-6 rounded-3xl border border-rim bg-canvas p-8 text-center shadow-sm">
          <div
            className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-tint text-orange"
            aria-hidden="true"
          >
            <Lock className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight">Bu darsga kira olmaysiz</h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              Jonli darsga faqat ushbu guruhga <strong>tasdiqlangan (APPROVED)</strong> talabalar
              qo&apos;shila oladi. Agar ariza yuborgan bo&apos;lsangiz, o&apos;qituvchi tasdig&apos;ini
              kuting yoki guruhga yozilishingizni tekshiring.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={() => router.push(`/${locale}/dashboard`)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-5 py-3 text-sm font-bold text-white outline-none transition-all hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.98]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Dashboardga qaytish
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Session not started.
  if (error === 'LIVE_NOT_STARTED') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen flex-col items-center justify-center bg-surface p-6 text-ink-strong"
      >
        <div className="w-full max-w-md space-y-8 text-center">
          <div
            className="mx-auto inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-tint text-blue"
            aria-hidden="true"
          >
            <Play className="h-10 w-10 fill-current" />
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold tracking-tight">Efir hali boshlanmagan</h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              {isTeacher
                ? 'Darsni boshlash uchun quyidagi tugmani bosing.'
                : "O'qituvchi efirni boshlaguncha avtomatik ulanasiz…"}
            </p>
            {!isTeacher && (
              <div className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-faint">
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span>Tekshirilyapti… ({pollCount})</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 pt-2">
            {isTeacher ? (
              <button
                type="button"
                disabled={isStarting}
                onClick={handleStart}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-5 py-4 font-bold text-white outline-none transition-all hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-base active:scale-[0.98] disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <>
                    <Play className="h-5 w-5 fill-current" aria-hidden="true" /> Efirni boshlash
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void tryJoin()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rim bg-canvas px-5 py-4 font-bold text-ink-strong outline-none transition-all hover:bg-tint focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-base active:scale-[0.98]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Qo&apos;lda yangilash
              </button>
            )}

            <button
              type="button"
              onClick={() => router.push(`/${locale}/dashboard`)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-ink-soft outline-none transition-colors hover:text-ink-strong focus-visible:ring-2 focus-visible:ring-blue"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Dashboardga qaytish
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Generic error.
  if (error) {
    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-center justify-center gap-6 bg-surface p-6 text-ink-strong"
      >
        <p className="max-w-md text-center text-lg font-semibold text-red">{error}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${locale}/dashboard`)}
            className="rounded-2xl border border-rim bg-canvas px-6 py-2.5 font-medium text-ink-strong outline-none transition-all hover:bg-tint focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            Dashboardga qaytish
          </button>
          <button
            type="button"
            onClick={() => void tryJoin()}
            className="rounded-2xl bg-blue px-6 py-2.5 font-medium text-white outline-none transition-all hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            Qayta urinish
          </button>
        </div>
      </div>
    );
  }

  // Loading.
  if (!data) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen flex-col items-center justify-center gap-4 bg-surface text-ink-strong"
      >
        <Loader2 className="h-8 w-8 animate-spin text-blue" aria-hidden="true" />
        <p className="text-sm text-ink-soft">Efirga ulanmoqda…</p>
      </div>
    );
  }

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';
  // Return into the lesson page after leaving/ending the broadcast. Guarded so
  // the duplicate invocation (explicit end + LiveKit onDisconnected) navigates
  // only once.
  const onLeave = () => {
    if (hasLeftRef.current) return;
    hasLeftRef.current = true;
    router.push(lessonHrefRef.current ?? `/${locale}/dashboard`);
  };

  // Learner → light, consumer-only Live_Viewer with forensic watermark (3.2).
  if (data.role === 'STUDENT') {
    return (
      <LiveViewer
        token={data.token}
        serverUrl={serverUrl}
        lessonId={lessonId}
        watermarkLabel={resolveWatermarkLabel(data)}
        locale={locale}
        onLeave={onLeave}
      />
    );
  }

  // Instructor (and admin auditor mapped to TEACHER) → host studio (3.1).
  return (
    <LiveRoom
      token={data.token}
      serverUrl={serverUrl}
      lessonId={lessonId}
      role={data.role}
      locale={locale}
      onLeave={onLeave}
    />
  );
}
