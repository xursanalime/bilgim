'use client';

import * as React from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  FocusLayout,
  CarouselLayout,
  ParticipantTile,
  useTracks,
  useChat,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import {
  Send,
  MessageSquare,
  LogOut,
  ScreenShare,
  Video as VideoIcon,
} from 'lucide-react';

import { WatermarkOverlay } from '../media/watermark-overlay';
import { useContentProtection } from '../../hooks/use-content-protection';
import { useScreenCaptureDetection } from '../../hooks/use-screen-capture-detection';
import { liveApi, LiveSessionWithSfu } from '../../lib/api/live';
import { ReconnectStatus, RecordingFinalizationNotice } from './recording-status';
import { StatusPill } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

/**
 * LiveViewer — the Learner's live-watching surface (Live_Viewer, Req 7.3).
 *
 * Consumer-only: a student NEVER publishes camera/mic/screen here — they only
 * subscribe to the instructor's stream, read the live chat, and send chat
 * messages. The host broadcasting UI (Live_Studio / `LiveRoom`) is a separate,
 * untouched component (task 3.1).
 *
 * This surface:
 *  - is built on the **light design system** tokens/primitives;
 *  - renders the instructor stream (screen-share focus when present, else the
 *    camera grid) with the **forensic `WatermarkOverlay`** layered above the
 *    video feed (Req 3.5);
 *  - exposes the live chat;
 *  - applies the content-protection + screen-capture deterrents already used by
 *    the room.
 *
 * APPROVED-only join (Req 7.3) is enforced upstream: the BFF `join` endpoint is
 * gated by `LessonAccessGuard` (owning teacher / APPROVED student / admin), so
 * a non-approved learner never receives a token to reach this component. The
 * "not approved / not enrolled" state is surfaced by `LiveSessionJoin`.
 *
 * Recording finalization, RECORDING_FAILED messaging and reconnect status are
 * surfaced via the shared `recording-status` subcomponents (task 3.3), mounted
 * additively below so the core stream/chat logic stays untouched.
 */
export interface LiveViewerProps {
  token: string;
  serverUrl: string;
  lessonId: string;
  /**
   * Server-derived, PII-masked per-viewer watermark label (Req 3.5). MUST come
   * from the authenticated join ticket — never client-constructed identity.
   */
  watermarkLabel: string;
  /** Active locale, threaded to the recording-ready deep link (task 3.3). */
  locale?: string | undefined;
  onLeave: () => void;
}

export function LiveViewer({
  token,
  serverUrl,
  lessonId,
  watermarkLabel,
  locale,
  onLeave,
}: LiveViewerProps) {
  const roomOptions = React.useMemo(
    () => ({
      adaptiveStream: true,
      dynacast: true,
    }),
    [],
  );

  return (
    <LiveKitRoom
      // A learner is consumer-only — never auto-publish camera/mic.
      video={false}
      audio={false}
      token={token}
      serverUrl={serverUrl}
      onDisconnected={onLeave}
      options={roomOptions}
      className="h-screen w-full"
    >
      <InnerViewer lessonId={lessonId} watermarkLabel={watermarkLabel} locale={locale} onLeave={onLeave} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

interface InnerViewerProps {
  lessonId: string;
  watermarkLabel: string;
  locale?: string | undefined;
  onLeave: () => void;
}

function InnerViewer({ lessonId, watermarkLabel, locale, onLeave }: InnerViewerProps) {
  // Anti-piracy deterrents (honest-limit: deterrent layer, real protection is
  // the forensic watermark below).
  useContentProtection();
  const { isCapturing, isHidden } = useScreenCaptureDetection();

  const [sessionData, setSessionData] = React.useState<LiveSessionWithSfu | null>(null);

  // Lightweight heartbeat for the live/recording indicator (Req 7.1 surfacing
  // of a recording indicator while LIVE; finalization is task 3.3).
  React.useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const d = await liveApi.getOne(lessonId);
        if (active) setSessionData(d);
      } catch {
        /* heartbeat is best-effort */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [lessonId]);

  const status = sessionData?.session?.status;
  const isRecording = status === 'LIVE';

  return (
    <div className="relative flex h-screen w-full flex-col bg-surface font-sans text-ink-strong">
      {/* Screen-capture / hidden-window deterrent — blanks the content. */}
      {(isCapturing || isHidden) && (
        <div
          role="alert"
          className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 bg-ink-strong p-6 text-center"
        >
          <p className="max-w-sm text-sm font-bold text-white">
            {isCapturing
              ? "Ekranni yozib olish aniqlandi — jonli dars vaqtincha to'xtatildi."
              : 'Oyna faol emas — himoyalangan kontent yashirildi.'}
          </p>
        </div>
      )}

      <ReconnectStatus theme="light" />

      {/* Recording finalization + RECORDING_FAILED messaging (R7.4 / R7.5),
          shared with the host studio for consistent copy. */}
      <RecordingFinalizationNotice
        lessonId={lessonId}
        status={status}
        role="STUDENT"
        theme="light"
        locale={locale}
      />

      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rim bg-canvas px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue text-white">
            <VideoIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-tight text-ink-strong">Jonli dars</span>
            <span className="text-[11px] font-medium text-ink-soft">BilgimAI Live</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRecording && (
            <StatusPill variant="red" size="sm" pulse>
              Yozib olinmoqda
            </StatusPill>
          )}
          <StatusPill variant="green" size="sm" pulse>
            Jonli efir
          </StatusPill>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onLeave}
            leftIcon={<LogOut className="h-4 w-4" aria-hidden="true" />}
          >
            Chiqish
          </Button>
        </div>
      </header>

      {/* Main: stream + chat */}
      <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        {/* Stream stage */}
        <section className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-rim bg-black shadow-sm">
          <ViewerStage />

          {/* Forensic watermark — layered ABOVE the video feed (Req 3.5). */}
          <WatermarkOverlay
            label={watermarkLabel}
            protectionNotice="Himoyalangan jonli dars — yozib olish va tarqatish kuzatiladi."
          />

          <div className="absolute bottom-3 left-3 z-10">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white backdrop-blur-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" aria-hidden="true" />
              Jonli efir
            </span>
          </div>
        </section>

        {/* Live chat */}
        <aside className="flex h-72 min-h-0 shrink-0 flex-col overflow-hidden rounded-3xl border border-rim bg-canvas shadow-sm lg:h-auto lg:w-80">
          <ViewerChat />
        </aside>
      </main>
    </div>
  );
}

/**
 * The instructor stream. Prefers the screen-share track (focus) and shows the
 * camera tiles in a carousel beneath it; otherwise renders the camera grid.
 */
function ViewerStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const screenTrack = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((t) => t.source !== Track.Source.ScreenShare);

  if (screenTrack) {
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div className="relative min-h-0 flex-[3] overflow-hidden rounded-2xl bg-black">
          <FocusLayout trackRef={screenTrack} />
          <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-blue/85 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white backdrop-blur-md">
            <ScreenShare className="h-3 w-3" aria-hidden="true" />
            Ekran ulashilmoqda
          </div>
        </div>
        {cameraTracks.length > 0 && (
          <div className="h-24 shrink-0">
            <CarouselLayout tracks={cameraTracks} className="h-full gap-2">
              <ParticipantTile className="overflow-hidden rounded-xl" />
            </CarouselLayout>
          </div>
        )}
      </div>
    );
  }

  if (cameraTracks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
          <VideoIcon className="h-7 w-7 text-white/50" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-white/60">
          O&apos;qituvchi efirni boshlashini kuting…
        </p>
      </div>
    );
  }

  return (
    <GridLayout tracks={tracks} className="h-full gap-2 p-2">
      <ParticipantTile className="overflow-hidden rounded-2xl" />
    </GridLayout>
  );
}

/** Light live-chat panel. Read + send via the room data channel (Req 7.3). */
function ViewerChat() {
  const { chatMessages, send } = useChat();
  const [input, setInput] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    try {
      await send(text);
      setInput('');
    } catch {
      /* surfaced via the disabled/again affordance; non-fatal */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-rim px-4 py-3">
        <MessageSquare className="h-4 w-4 text-ink-soft" aria-hidden="true" />
        <span className="text-sm font-bold text-ink-strong">Jonli chat</span>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-label="Jonli chat xabarlari"
        aria-live="polite"
        className="flex-1 space-y-4 overflow-y-auto p-4"
      >
        {chatMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-soft">
              <MessageSquare className="h-5 w-5 text-ink-faint" aria-hidden="true" />
            </div>
            <p className="text-xs font-bold text-ink-soft">Hali xabarlar yo&apos;q</p>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Savolingizni yozib, darsda ishtirok eting.
            </p>
          </div>
        ) : (
          chatMessages.map((m) => {
            const isMe = m.from?.isLocal;
            const sender = m.from?.name || m.from?.identity || 'Anonim';
            const time = new Date(m.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <div key={m.id} className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
                <div className="mb-1 flex items-baseline gap-2 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                    {sender}
                  </span>
                  <span className="text-[9px] font-medium text-ink-faint">{time}</span>
                </div>
                <div
                  className={cn(
                    'max-w-[90%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                    isMe
                      ? 'rounded-tr-none bg-blue text-white'
                      : 'rounded-tl-none border border-rim bg-tint text-ink-strong',
                  )}
                >
                  {m.message}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        className="shrink-0 border-t border-rim p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <div className="relative">
          <label htmlFor="live-viewer-chat-input" className="sr-only">
            Xabar yozing
          </label>
          <input
            id="live-viewer-chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Xabar yozing…"
            autoComplete="off"
            className="w-full rounded-2xl border border-rim bg-canvas px-4 py-2.5 pr-12 text-sm font-medium text-ink-strong outline-none transition-colors placeholder:text-ink-faint focus:border-blue/50 focus-visible:ring-2 focus-visible:ring-blue/40"
          />
          <button
            type="submit"
            aria-label="Xabarni yuborish"
            disabled={!input.trim()}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-blue text-white outline-none transition-all hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-90 disabled:opacity-40 disabled:active:scale-100"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default LiveViewer;
