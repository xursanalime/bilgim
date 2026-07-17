'use client';

import * as React from 'react';
import Link from 'next/link';
import { useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { liveApi, type LessonRecording, type LiveSession } from '../../lib/api/live';

/**
 * Shared live-room status surfaces (frontend-redesign task 3.3).
 *
 * This module owns three closely-related concerns that span BOTH the host
 * studio (`LiveRoom`, dark) and the learner viewer (`LiveViewer`, light), so
 * the messaging stays consistent across the two surfaces:
 *
 *  1. Recording finalization surfacing — once a session ENDs, reflect that the
 *     recording is being finalized and, once ready, point the user at the
 *     lesson recordings for on-demand viewing (Req 7.4 → 6.2).
 *  2. RECORDING_FAILED messaging — clear, honest copy with role-appropriate
 *     guidance/next steps (Req 7.5).
 *  3. Reconnect status — resilient, non-blocking reconnection banner plus a
 *     blocking overlay only when the connection is actually lost (Req 7.6).
 *
 * Both components are theme-aware (`theme: 'dark' | 'light'`) so they read
 * correctly on either surface without pulling in the light-only design
 * primitives (which would clash with the studio's dark canvas). They are
 * mounted ADDITIVELY by `LiveRoom` / `LiveViewer`; they own none of the core
 * stream/chat logic.
 */

type Theme = 'dark' | 'light';

// ─────────────────────────────────────────────────────────────────
// Reconnect status (Req 7.6)
// ─────────────────────────────────────────────────────────────────

export interface ReconnectStatusProps {
  theme: Theme;
}

/**
 * ReconnectStatus — surfaces LiveKit connection state consistently on both
 * surfaces.
 *
 * Resilience model (Req 7.6): a brief network drop puts the room into
 * `Reconnecting`, which LiveKit recovers from automatically. We therefore show
 * a NON-blocking top banner during reconnection (the stream stays visible and
 * resumes on recovery) rather than blanking the screen, and confirm with a
 * transient "reconnected" banner. Only a true `Disconnected` state — or the
 * very first `Connecting` — shows a blocking overlay, since at that point there
 * is nothing to watch.
 */
export function ReconnectStatus({ theme }: ReconnectStatusProps) {
  const state = useConnectionState();
  const [justReconnected, setJustReconnected] = React.useState(false);
  const prevState = React.useRef<ConnectionState>(state);

  React.useEffect(() => {
    const wasReconnecting =
      prevState.current === ConnectionState.Reconnecting ||
      prevState.current === ConnectionState.SignalReconnecting;

    if (wasReconnecting && state === ConnectionState.Connected) {
      setJustReconnected(true);
      const t = setTimeout(() => setJustReconnected(false), 4000);
      prevState.current = state;
      return () => clearTimeout(t);
    }

    prevState.current = state;
    return undefined;
  }, [state]);

  const isReconnecting =
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting;
  const isConnecting = state === ConnectionState.Connecting;
  const isDisconnected = state === ConnectionState.Disconnected;

  // Blocking overlay — only when there is genuinely nothing to show.
  if (isConnecting || isDisconnected) {
    const dark = theme === 'dark';
    return (
      <div
        role={isDisconnected ? 'alert' : 'status'}
        aria-live="polite"
        className={[
          'absolute inset-0 z-[300] flex items-center justify-center backdrop-blur-sm',
          dark ? 'bg-black/70' : 'bg-surface/80',
        ].join(' ')}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          {isDisconnected ? (
            <WifiOff className="h-10 w-10 text-red" aria-hidden="true" />
          ) : (
            <Loader2 className="h-10 w-10 animate-spin text-blue" aria-hidden="true" />
          )}
          <p
            className={[
              'text-lg font-bold',
              dark ? 'text-white' : 'text-ink-strong',
            ].join(' ')}
          >
            {isDisconnected ? 'Aloqa uzildi' : 'Ulanmoqda…'}
          </p>
          <p
            className={[
              'max-w-xs text-xs font-medium leading-relaxed',
              dark ? 'text-white/60' : 'text-ink-soft',
            ].join(' ')}
          >
            {isDisconnected
              ? 'Internet aloqangiz uzilgan ko\u2018rinadi. Tarmoqni tekshiring — aloqa tiklanganda efirga qayta qo\u2018shilishingiz mumkin.'
              : 'Jonli efirga ulanmoqda, biroz kuting…'}
          </p>
        </div>
      </div>
    );
  }

  // Non-blocking reconnecting banner — the stream stays visible underneath.
  if (isReconnecting) {
    return (
      <StatusBanner
        theme={theme}
        tone="warn"
        icon={<RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />}
        title="Qayta ulanmoqda…"
        message="Aloqada qisqa uzilish bo\u2018ldi. Efir avtomatik tiklanmoqda."
        role="status"
      />
    );
  }

  // Transient confirmation once the connection recovers.
  if (justReconnected) {
    return (
      <StatusBanner
        theme={theme}
        tone="ok"
        icon={<Wifi className="h-4 w-4" aria-hidden="true" />}
        title="Aloqa tiklandi"
        message="Jonli efir davom etmoqda."
        role="status"
      />
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
// Recording finalization + RECORDING_FAILED (Req 7.4 / 7.5)
// ─────────────────────────────────────────────────────────────────

export interface RecordingFinalizationNoticeProps {
  lessonId: string;
  /**
   * Current live-session status, sourced from the parent surface's existing
   * heartbeat poll (`liveApi.getOne`) so we do not duplicate session polling.
   */
  status: LiveSession['status'] | undefined;
  role: 'TEACHER' | 'STUDENT';
  theme: Theme;
  /**
   * Active locale, used to build the in-app link to the lesson's on-demand
   * recordings (`/{locale}/lessons/{lessonId}`). When absent, the notice still
   * renders but omits the deep link.
   */
  locale?: string | undefined;
}

type FinalizePhase = 'processing' | 'ready' | 'failed';

/**
 * RecordingFinalizationNotice — reflects what happens to the session recording
 * after the session leaves the LIVE state.
 *
 * - `ENDED`: the recording is being finalized. We poll the lesson recordings
 *   (`liveApi.listRecordings`) to upgrade the notice from "processing" to
 *   "ready" (with a link to watch on demand) or "failed" if finalize failed.
 * - `RECORDING_FAILED`: the session row landed in the failed state directly —
 *   surface the honest failure message + role-appropriate guidance immediately.
 *
 * BACKEND ASSUMPTION: finalization status is derived from the lesson's
 * `Recording` rows via `GET /live/lessons/:lessonId/recordings` (documented on
 * `liveApi.listRecordings`). A row reaches `READY` with a non-null `assetId`
 * when the protected MediaAsset is playable; `FAILED` (assetId null) mirrors a
 * RECORDING_FAILED finalize. There is intentionally no separate per-session
 * status endpoint — if one is added later, only `resolvePhase` below changes.
 */
export function RecordingFinalizationNotice({
  lessonId,
  status,
  role,
  theme,
  locale,
}: RecordingFinalizationNoticeProps) {
  const isEnded = status === 'ENDED';
  const isFailedStatus = status === 'RECORDING_FAILED';
  const isTerminal = isEnded || isFailedStatus;

  const [recordings, setRecordings] = React.useState<LessonRecording[] | null>(null);

  // Poll recordings only once the session has reached a terminal state, and
  // stop as soon as it resolves to ready/failed (best-effort, non-fatal).
  React.useEffect(() => {
    if (!isTerminal) {
      setRecordings(null);
      return undefined;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const rows = await liveApi.listRecordings(lessonId);
        if (!active) return;
        setRecordings(rows);
        const resolved = rows.some(
          (r) => (r.status === 'READY' && r.assetId) || r.status === 'FAILED',
        );
        if (resolved && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        /* finalization polling is best-effort; keep the last known notice */
      }
    };

    void poll();
    timer = setInterval(() => void poll(), 10000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [isTerminal, lessonId]);

  if (!isTerminal) return null;

  const phase = resolvePhase(isFailedStatus, recordings);

  if (phase === 'failed') {
    const message =
      role === 'TEACHER'
        ? 'Bu darsning yozuvi saqlanmadi. Talabalar uchun jonli efir ishlashda davom etadi. Yozuvni qayta yoqish uchun darsni qaytadan boshlashingiz mumkin — agar muammo takrorlansa, qo\u2018llab-quvvatlash xizmatiga murojaat qiling.'
        : 'Bu jonli darsning yozuvini tayyorlab bo\u2018lmadi, shuning uchun u keyinroq mavjud bo\u2018lmasligi mumkin. Iltimos, o\u2018qituvchingizga murojaat qiling.';
    return (
      <RecordingBanner
        theme={theme}
        tone="error"
        icon={<AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />}
        title="Yozib olish amalga oshmadi"
        message={message}
      />
    );
  }

  if (phase === 'ready') {
    const href = locale ? `/${locale}/lessons/${lessonId}` : null;
    return (
      <RecordingBanner
        theme={theme}
        tone="ok"
        icon={<CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />}
        title="Yozuv tayyor"
        message={
          role === 'TEACHER'
            ? 'Darsning yozuvi tayyorlandi va dars sahifasida talabalar uchun ko\u2018rish mumkin.'
            : 'Darsning yozuvi tayyorlandi. Uni dars sahifasida xohlagan vaqtingizda ko\u2018rishingiz mumkin.'
        }
        action={
          href ? (
            <Link
              href={href}
              className={[
                'mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue',
                theme === 'dark'
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-blue text-white hover:bg-blue-600',
              ].join(' ')}
            >
              Yozuvni ochish
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : null
        }
      />
    );
  }

  // processing
  return (
    <RecordingBanner
      theme={theme}
      tone="info"
      icon={<Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />}
      title="Yozuv tayyorlanmoqda"
      message="Jonli dars tugadi. Yozuv tayyorlanmoqda va tayyor bo\u2018lgach dars sahifasida ko\u2018rinadi."
    />
  );
}

function resolvePhase(
  isFailedStatus: boolean,
  recordings: LessonRecording[] | null,
): FinalizePhase {
  if (recordings && recordings.length > 0) {
    if (recordings.some((r) => r.status === 'READY' && r.assetId)) return 'ready';
    if (recordings.some((r) => r.status === 'FAILED')) return 'failed';
    // Rows exist but none ready/failed yet → still finalizing.
    return isFailedStatus ? 'failed' : 'processing';
  }
  // No rows surfaced yet: trust the session status. RECORDING_FAILED → failed,
  // ENDED → still finalizing.
  return isFailedStatus ? 'failed' : 'processing';
}

// ─────────────────────────────────────────────────────────────────
// Presentational primitives (theme-aware, no light-only deps)
// ─────────────────────────────────────────────────────────────────

interface StatusBannerProps {
  theme: Theme;
  tone: 'warn' | 'ok';
  icon: React.ReactNode;
  title: string;
  message: string;
  role: 'status' | 'alert';
}

/** Compact top-center pill for transient connection messaging. */
function StatusBanner({ theme, tone, icon, title, message, role }: StatusBannerProps) {
  const dark = theme === 'dark';
  const tones: Record<StatusBannerProps['tone'], string> = dark
    ? {
        warn: 'bg-amber-500/90 border-amber-400/30 text-black',
        ok: 'bg-green/90 border-green/30 text-white',
      }
    : {
        warn: 'border-orange/30 bg-orange-tint text-orange',
        ok: 'border-green/30 bg-green-tint text-green',
      };

  return (
    <div
      role={role}
      aria-live="polite"
      className={[
        'absolute top-4 left-1/2 z-[320] -translate-x-1/2 flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 shadow-2xl backdrop-blur-md max-w-[90vw]',
        tones[tone],
      ].join(' ')}
    >
      {icon}
      <div className="flex flex-col text-left leading-tight">
        <span className="text-xs font-black">{title}</span>
        <span className="text-[11px] font-semibold opacity-80">{message}</span>
      </div>
    </div>
  );
}

interface RecordingBannerProps {
  theme: Theme;
  tone: 'info' | 'ok' | 'error';
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}

/** Larger top-center card for recording finalization messaging. */
function RecordingBanner({
  theme,
  tone,
  icon,
  title,
  message,
  action,
}: RecordingBannerProps) {
  const dark = theme === 'dark';
  const tones: Record<RecordingBannerProps['tone'], string> = dark
    ? {
        info: 'bg-blue/15 border-blue/30 text-blue',
        ok: 'bg-green/15 border-green/30 text-green',
        error: 'bg-red/15 border-red/30 text-red',
      }
    : {
        info: 'border-blue/30 bg-blue-tint text-blue',
        ok: 'border-green/30 bg-green-tint text-green',
        error: 'border-red/30 bg-red-tint text-red',
      };

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={[
        'absolute top-20 left-1/2 z-[310] -translate-x-1/2 flex w-[min(28rem,90vw)] items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl',
        tones[tone],
      ].join(' ')}
    >
      {icon}
      <div className="flex flex-col text-left">
        <p
          className={[
            'text-sm font-black',
            dark ? 'text-white' : 'text-ink-strong',
          ].join(' ')}
        >
          {title}
        </p>
        <p
          className={[
            'mt-0.5 text-[11px] font-medium leading-relaxed',
            dark ? 'text-white/70' : 'text-ink-soft',
          ].join(' ')}
        >
          {message}
        </p>
        {action}
      </div>
    </div>
  );
}
