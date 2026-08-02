'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { liveApi, JoinSessionResult } from '../../lib/api/live';
import { Loader2, Play, ArrowLeft, RefreshCw, Radio, AlertTriangle, Video, VideoOff } from 'lucide-react';
import { getUserRole } from '../../lib/auth';
import { LiveStage, LiveWordmark, LiveCard } from './live-visual-kit';

const LiveRoom = dynamic(
  () => import('../live-room/LiveRoom').then(m => m.LiveRoom),
  {
    ssr: false,
    loading: () => (
      <Scene>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue" />
        </div>
      </Scene>
    ),
  }
);

interface LiveSessionJoinProps {
  locale: string;
  lessonId: string;
  /** Where "Orqaga" / leaving the call should return to — the lesson's group page when known, dashboard otherwise. */
  groupId?: string | undefined;
  courseId?: string | undefined;
}

/** Ambient stage shared by every pre-room state. */
function Scene({ children }: { children: React.ReactNode }) {
  return (
    <LiveStage>
      <div className="flex h-full w-full flex-col items-center justify-center px-6">{children}</div>
    </LiveStage>
  );
}

function Wordmark() {
  return <LiveWordmark className="mb-8" />;
}

function formatClockTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('uz-UZ', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function GlassCard({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <LiveCard tone={tone} className="w-full max-w-md">
      <div className="p-9">{children}</div>
    </LiveCard>
  );
}

/** Teacher-only prompt shown right before starting a broadcast: record or not? */
function RecordPromptDialog({
  onChoose,
  onCancel,
  isSubmitting,
}: {
  onChoose: (record: boolean) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-tint-strong/40 backdrop-blur-sm"
        onClick={isSubmitting ? undefined : onCancel}
      />
      <LiveCard className="relative w-full max-w-sm animate-in fade-in zoom-in-95 duration-150">
        <div className="p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-tint">
            <Video className="h-7 w-7 text-red" />
          </div>
          <h2 className="text-lg font-black tracking-tight text-ink-strong">
            Darsni yozib olaylikmi?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Yozib olingan dars avtomatik ravishda yuqori sifatda saqlanadi va tugagach dars materiallariga qo&apos;shiladi.
          </p>
          <div className="mt-7 flex flex-col gap-2.5">
            <button
              disabled={isSubmitting}
              onClick={() => onChoose(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue py-3.5 font-bold text-white shadow-[0_8px_24px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  <Video className="h-5 w-5" /> Ha, yozib olinsin
                </>
              )}
            </button>
            <button
              disabled={isSubmitting}
              onClick={() => onChoose(false)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rim bg-canvas py-3.5 font-bold text-ink-strong transition-all hover:bg-tint active:scale-[0.98] disabled:opacity-60"
            >
              <VideoOff className="h-5 w-5" /> Yo&apos;q, yozib olinmasin
            </button>
          </div>
        </div>
      </LiveCard>
    </div>
  );
}

export function LiveSessionJoin({ locale, lessonId, groupId, courseId }: LiveSessionJoinProps) {
  const [data, setData] = useState<JoinSessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const [showRecordPrompt, setShowRecordPrompt] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const returnUrl = groupId && courseId
    ? `/${locale}/dashboard/courses/${courseId}/groups/${groupId}`
    : groupId
      ? `/${locale}/groups/${groupId}`
      : `/${locale}/dashboard`;

  const tryJoin = async (): Promise<boolean> => {
    try {
      const response = await liveApi.join(lessonId);
      setData(response);
      setError(null);
      setOpensAt(null);
      return true;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.status === 404) {
        setError('LIVE_NOT_STARTED');
        // Backend envelope: ApiClientError.details = { code, message, details: { opensAt }, traceId }
        const nestedOpensAt = err?.details?.details?.opensAt;
        setOpensAt(typeof nestedOpensAt === 'string' ? nestedOpensAt : null);
      } else {
        setError('Live efirga ulanishda xatolik yuz berdi.');
      }
      return false;
    }
  };

  useEffect(() => {
    const role = getUserRole();
    setIsTeacher(role === 'TEACHER');

    tryJoin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // The `bilgim_user` cookie (and thus getUserRole()) can change without
  // this component remounting — e.g. this tab was opened before login
  // completed, or the user logged in as a different account in another
  // tab and switched back here. Re-sync on focus/visibility so a stale
  // "student" view doesn't hide the teacher's start control.
  useEffect(() => {
    const resync = () => setIsTeacher(getUserRole() === 'TEACHER');
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
  }, []);

  // Student: auto-poll every 5s when session not started yet
  useEffect(() => {
    if (error !== 'LIVE_NOT_STARTED' || isTeacher) return;

    pollRef.current = setInterval(async () => {
      setPollCount(c => c + 1);
      const joined = await tryJoin();
      if (joined && pollRef.current) clearInterval(pollRef.current);
    }, 5000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, isTeacher]);

  const handleStart = async (record: boolean) => {
    setIsStarting(true);
    setError(null);
    try {
      await liveApi.start(lessonId, record);
      await tryJoin();
      setShowRecordPrompt(false);
    } catch {
      setError("Efirni boshlashda xatolik yuz berdi.");
      setShowRecordPrompt(false);
    } finally {
      setIsStarting(false);
    }
  };

  // Session not started
  if (error === 'LIVE_NOT_STARTED') {
    return (
      <Scene>
        <Wordmark />
        <GlassCard>
          <div className="flex flex-col items-center text-center">
            {/* Broadcast signal icon with pulsing rings */}
            <div className="relative mb-7 flex h-20 w-20 items-center justify-center">
              <span className="signal-ring absolute inset-0 rounded-full border-2 border-blue/30" />
              <span className="signal-ring absolute inset-0 rounded-full border-2 border-blue/30" style={{ animationDelay: '0.8s' }} />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-blue shadow-[0_8px_24px_-6px_rgba(0,113,227,0.5)]">
                <Radio className="h-9 w-9 text-white" />
              </div>
            </div>

            <h2 className="text-2xl font-black tracking-tight text-ink-strong">Efir hali boshlanmagan</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {isTeacher
                ? 'Darsni boshlash uchun quyidagi tugmani bosing.'
                : opensAt
                  ? `Darsga ${formatClockTime(opensAt)}dan boshlab kirishingiz mumkin bo'ladi — o'qituvchi hali efirni boshlamagan bo'lsa ham kutish xonasida tayyorlanib turasiz.`
                  : "O'qituvchi efirni boshlaguncha avtomatik ulanasiz..."}
            </p>

            {!isTeacher && (
              <div className="mt-5 flex items-center gap-2 rounded-full border border-rim bg-tint px-4 py-2 text-xs font-medium text-ink-soft">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue" />
                </span>
                <span>Tekshirilyapti ({pollCount})</span>
              </div>
            )}

            <div className="mt-8 flex w-full flex-col gap-3">
              {isTeacher ? (
                <button
                  disabled={isStarting}
                  onClick={() => setShowRecordPrompt(true)}
                  className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-blue py-4 font-bold text-white shadow-[0_8px_24px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
                >
                  {isStarting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Play className="h-5 w-5 fill-current" /> Efirni boshlash
                    </>
                  )}
                  {!isStarting && (
                    <span className="shimmer-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-white/25 blur-md" />
                  )}
                </button>
              ) : (
                <button
                  onClick={() => tryJoin()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rim bg-canvas py-4 font-bold text-ink-strong transition-all hover:bg-tint active:scale-[0.98]"
                >
                  <RefreshCw className="h-4 w-4" /> Qo&apos;lda yangilash
                </button>
              )}

              <button
                onClick={() => router.push(returnUrl)}
                className="flex w-full items-center justify-center gap-2 py-2.5 text-sm font-medium text-ink-faint transition-colors hover:text-ink-strong"
              >
                <ArrowLeft className="h-4 w-4" /> {groupId ? 'Guruhga qaytish' : 'Dashboardga qaytish'}
              </button>
            </div>
          </div>
        </GlassCard>
        {showRecordPrompt && (
          <RecordPromptDialog
            isSubmitting={isStarting}
            onChoose={handleStart}
            onCancel={() => setShowRecordPrompt(false)}
          />
        )}
      </Scene>
    );
  }

  // Generic error
  if (error) {
    return (
      <Scene>
        <Wordmark />
        <GlassCard tone="danger">
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-tint ring-1 ring-inset ring-red/20">
              <AlertTriangle className="h-7 w-7 text-red" />
            </div>
            <p className="text-base font-semibold text-ink-strong">{error}</p>
            <div className="mt-7 flex w-full gap-3">
              <button
                onClick={() => router.push(returnUrl)}
                className="flex-1 rounded-2xl border border-rim bg-canvas py-3 font-medium text-ink-strong transition-all hover:bg-tint active:scale-[0.98]"
              >
                {groupId ? 'Guruh' : 'Dashboard'}
              </button>
              <button
                onClick={() => tryJoin()}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue py-3 font-bold text-white shadow-[0_8px_24px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
              >
                <RefreshCw className="h-4 w-4" /> Qayta urinish
              </button>
            </div>
          </div>
        </GlassCard>
      </Scene>
    );
  }

  // Loading
  if (!data) {
    return (
      <Scene>
        <div className="flex flex-col items-center gap-5">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="signal-ring absolute inset-0 rounded-full border-2 border-blue/30" />
            <Loader2 className="h-8 w-8 animate-spin text-blue" />
          </div>
          <p className="text-sm font-medium text-ink-soft">Efirga ulanmoqda...</p>
        </div>
      </Scene>
    );
  }

  return (
    <LiveRoom
      token={data.token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880'}
      lessonId={lessonId}
      role={data.role}
      returnLabel={groupId ? 'Guruhga qaytish' : 'Dashboardga qaytish'}
      onLeave={() => router.push(returnUrl)}
    />
  );
}
