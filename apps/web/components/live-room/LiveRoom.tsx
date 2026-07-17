'use client';

import * as React from 'react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useParticipants,
  CarouselLayout,
  FocusLayout,
  useRoomContext,
  useTrackRefContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, ConnectionQuality, VideoPresets } from 'livekit-client';
import { Video, Mic, MicOff, VideoOff, AlertTriangle, Wifi, Hand } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Whiteboard } from '../live/tabs/whiteboard-tab';
import { LiveTopBar } from '../live/live-top-bar';
import { LiveControlBar } from '../live/live-control-bar';
import { LiveSidebar } from '../live/live-sidebar';
import { liveApi, LiveSessionWithSfu } from '../../lib/api/live';
import { lessonsApi } from '../../lib/api/catalog';
import { toast } from '../ui/toast';
import { ReconnectStatus, RecordingFinalizationNotice } from './recording-status';
import { useContentProtection } from '../../hooks/use-content-protection';
import { useScreenCaptureDetection } from '../../hooks/use-screen-capture-detection';
import { cn } from '../../lib/utils';

// DataChannel topic for hand-raise events
export const HAND_RAISE_TOPIC = 'hand-raise';
export const MIC_GRANT_TOPIC = 'mic-grant';

export interface LiveRoomProps {
  token: string;
  serverUrl: string;
  lessonId: string;
  role: 'TEACHER' | 'STUDENT';
  /** Active locale, threaded to the recording-ready deep link (task 3.3). */
  locale?: string | undefined;
  onLeave: () => void;
}

// --- Pre-join screen ---
interface PreJoinProps {
  onJoin: (opts: { mic: boolean; cam: boolean }) => void;
  lessonTitle?: string;
  canPublish: boolean;
}

function PreJoinScreen({ onJoin, lessonTitle, canPublish }: PreJoinProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [micOn, setMicOn] = React.useState(true);
  const [camOn, setCamOn] = React.useState(true);
  const [stream, setStream] = React.useState<MediaStream | null>(null);

  React.useEffect(() => {
    if (!canPublish) return; // student kamera preview ko'rmaydi
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (!active) { s.getTracks().forEach(t => t.stop()); return; }
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {});
    return () => {
      active = false;
      stream?.getTracks().forEach(t => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPublish]);

  const handleJoin = () => {
    stream?.getTracks().forEach(t => t.stop());
    // Lift the user's final mic/cam intent so the room connects already
    // publishing what they chose (instead of hardcoded defaults).
    onJoin({ mic: micOn, cam: camOn });
  };

  return (
    <div className="flex h-screen w-full bg-surface relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row gap-8 w-full max-w-5xl mx-auto items-center px-6 py-8">
        {/* Camera preview — stays dark; camera video reads best on a dark stage */}
        <div className="relative w-full max-w-xl aspect-video rounded-2xl overflow-hidden bg-ink-strong border border-rim shadow-medium flex-shrink-0">
          {canPublish ? (
            camOn ? (
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="h-20 w-20 rounded-full bg-white/10 flex items-center justify-center">
                  <VideoOff className="h-9 w-9 text-white/40" />
                </div>
                <p className="text-white/40 text-sm font-medium">Kamera o&apos;chirilgan</p>
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="h-20 w-20 rounded-full bg-blue/10 border border-blue/20 flex items-center justify-center">
                <Video className="h-9 w-9 text-blue/60" />
              </div>
              <p className="text-white/40 text-sm font-medium">Jonli darsga qo&apos;shilasiz</p>
            </div>
          )}

          {/* Bottom controls overlay (sits over dark video — keep translucent dark) */}
          {canPublish && (
            <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setMicOn(!micOn)}
                aria-pressed={micOn}
                aria-label={micOn ? "Mikrofonni o'chirish" : 'Mikrofonni yoqish'}
                className={`h-11 w-11 rounded-xl flex items-center justify-center outline-none transition-all backdrop-blur-sm border focus-visible:ring-2 focus-visible:ring-blue ${micOn ? 'bg-white/10 border-white/10 text-white hover:bg-white/20' : 'bg-red/20 border-red/30 text-red'}`}
              >
                {micOn ? <Mic className="h-5 w-5" aria-hidden="true" /> : <MicOff className="h-5 w-5" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => setCamOn(!camOn)}
                aria-pressed={camOn}
                aria-label={camOn ? "Kamerani o'chirish" : 'Kamerani yoqish'}
                className={`h-11 w-11 rounded-xl flex items-center justify-center outline-none transition-all backdrop-blur-sm border focus-visible:ring-2 focus-visible:ring-blue ${camOn ? 'bg-white/10 border-white/10 text-white hover:bg-white/20' : 'bg-red/20 border-red/30 text-red'}`}
              >
                {camOn ? <Video className="h-5 w-5" aria-hidden="true" /> : <VideoOff className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
          )}

          {/* Live badge (over dark video — keep translucent dark) */}
          <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" aria-hidden="true" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Jonli</span>
          </div>
        </div>

        {/* Right panel — light chrome */}
        <div className="flex flex-col gap-6 w-full max-w-sm">
          {/* Logo + title */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-blue flex items-center justify-center shadow-lg shadow-blue/30">
                <Video className="h-4 w-4 text-white" />
              </div>
              <span className="text-ink-soft text-sm font-semibold">BilgimAI Live</span>
            </div>
            <h1 className="text-3xl font-black text-ink-strong tracking-tight">{lessonTitle || 'Jonli dars'}</h1>
            <p className="text-ink-soft text-sm mt-2">
              {canPublish
                ? 'Qurilmangizni tekshirib, darsni boshlang.'
                : "O'qituvchi darsni boshlaguncha tayyor turing."}
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-canvas border border-rim shadow-soft">
            <div className="h-8 w-8 rounded-lg bg-blue/10 flex items-center justify-center border border-blue/20">
              <Wifi className="h-4 w-4 text-blue" />
            </div>
            <div>
              <p className="text-xs font-bold text-ink-strong">Aloqa holati</p>
              <p className="text-[10px] text-blue font-semibold uppercase tracking-wider">Tayyor</p>
            </div>
          </div>

          {/* Join button */}
          <button
            type="button"
            onClick={handleJoin}
            className="w-full py-4 rounded-xl bg-blue hover:bg-blue/90 text-white font-bold text-base shadow-xl shadow-blue/25 outline-none transition-all active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-base flex items-center justify-center gap-2 group"
          >
            <Video className="h-5 w-5 group-hover:scale-110 transition-transform" aria-hidden="true" />
            Darsga kirish
          </button>

          <p className="text-center text-[11px] text-ink-faint">
            Kirish orqali siz platformaning foydalanish shartlarini qabul qilasiz
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Custom Participant Tile with advanced indicators ---
interface CustomParticipantTileProps extends React.HTMLAttributes<HTMLDivElement> {
  raisedHands: Set<string>;
}

function CustomParticipantTile({ raisedHands, ...props }: CustomParticipantTileProps) {
  const trackRef = useTrackRefContext();
  const participant = trackRef.participant;

  const [connQuality, setConnQuality] = React.useState<ConnectionQuality>(participant.connectionQuality);
  const [isSpeaking, setIsSpeaking] = React.useState(participant.isSpeaking);
  const [isMicOn, setIsMicOn] = React.useState(participant.isMicrophoneEnabled);

  React.useEffect(() => {
    setConnQuality(participant.connectionQuality);
    setIsSpeaking(participant.isSpeaking);
    setIsMicOn(participant.isMicrophoneEnabled);

    const onQualityChange = (q: ConnectionQuality) => setConnQuality(q);
    const onIsSpeaking = (speaking: boolean) => setIsSpeaking(speaking);

    participant.on('connectionQualityChanged', onQualityChange);
    participant.on('isSpeakingChanged', onIsSpeaking);

    const onTrackMuted = () => setIsMicOn(participant.isMicrophoneEnabled);
    const onTrackUnmuted = () => setIsMicOn(participant.isMicrophoneEnabled);
    participant.on('trackMuted', onTrackMuted);
    participant.on('trackUnmuted', onTrackUnmuted);

    return () => {
      participant.off('connectionQualityChanged', onQualityChange);
      participant.off('isSpeakingChanged', onIsSpeaking);
      participant.off('trackMuted', onTrackMuted);
      participant.off('trackUnmuted', onTrackUnmuted);
    };
  }, [participant]);

  const handRaised = raisedHands.has(participant.identity);

  // Does this track ref carry a live, unmuted camera/screen publication? When
  // it does we must render the media ourselves — passing children to
  // <ParticipantTile> overrides its built-in video rendering, so without an
  // explicit <VideoTrack> the tile would show only the dark background +
  // overlays (the "black camera" bug).
  const hasVideo = Boolean(
    trackRef.publication &&
      !trackRef.publication.isMuted &&
      trackRef.publication.track,
  );

  const renderQualityIndicator = () => {
    let barsCount = 3;
    let colorClass = 'bg-blue';
    let label = 'Yaxshi';

    if (connQuality === ConnectionQuality.Excellent) {
      barsCount = 3;
      colorClass = 'bg-blue';
      label = 'Alo';
    } else if (connQuality === ConnectionQuality.Good) {
      barsCount = 2;
      colorClass = 'bg-indigo-400';
      label = 'Yaxshi';
    } else if (connQuality === ConnectionQuality.Poor) {
      barsCount = 1;
      colorClass = 'bg-amber-500 animate-pulse';
      label = 'Sust';
    } else {
      barsCount = 0;
      colorClass = 'bg-white/20';
      label = 'Noaniq';
    }

    // Overlay chips sit over dark video — keep translucent dark for legibility.
    return (
      <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md px-2 py-1 rounded-lg border border-white/5" title={`Aloqa sifati: ${label}`}>
        <div className="flex items-end gap-[2px] h-3">
          <span className={`w-[2.5px] h-1.5 rounded-[1px] ${barsCount >= 1 ? colorClass : 'bg-white/20'}`} />
          <span className={`w-[2.5px] h-2.5 rounded-[1px] ${barsCount >= 2 ? colorClass : 'bg-white/20'}`} />
          <span className={`w-[2.5px] h-3.5 rounded-[1px] ${barsCount >= 3 ? colorClass : 'bg-white/20'}`} />
        </div>
        <span className="text-[9px] font-bold text-white/60 tracking-wider uppercase">{label}</span>
      </div>
    );
  };

  return (
    <ParticipantTile
      {...props}
      className={cn(
        // Tile background stays a dark neutral — camera/screen video reads best on dark.
        "relative rounded-2xl overflow-hidden border transition-all duration-300 bg-ink-strong",
        isSpeaking ? "border-blue/50 shadow-[0_0_15px_rgba(59,130,246,0.25)]" : "border-white/5",
        props.className
      )}
    >
      {/* Media layer — render the actual camera/screen video. Passing children
          to <ParticipantTile> replaces its default media rendering, so we draw
          the video (or a placeholder when the camera is off) ourselves. Local
          camera is mirrored for a natural self-view. */}
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef as NonNullable<React.ComponentProps<typeof VideoTrack>['trackRef']>}
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            participant.isLocal &&
              trackRef.source === Track.Source.Camera &&
              'scale-x-[-1]',
          )}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-strong">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
            <span className="text-2xl font-black uppercase text-white/60">
              {(participant.name || participant.identity || '?').slice(0, 1)}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-white/40">
            <VideoOff className="h-4 w-4" aria-hidden="true" />
            Kamera o&apos;chirilgan
          </span>
        </div>
      )}

      {/* Absolute Overlays (over dark video — keep translucent dark) */}
      <div className="absolute inset-0 pointer-events-none z-10 p-3 flex flex-col justify-between">
        {/* Top bar indicators */}
        <div className="flex items-center justify-between w-full pointer-events-auto">
          {/* Connection quality */}
          {renderQualityIndicator()}

          {/* Raised hand indicator */}
          {handRaised && (
            <div className="flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 text-amber-400 px-2.5 py-1 rounded-lg backdrop-blur-md shadow-lg animate-bounce">
              <Hand className="h-3 w-3 fill-amber-400" />
              <span className="text-[9px] font-black uppercase tracking-wider">Qo&apos;l ko&apos;tarildi</span>
            </div>
          )}
        </div>

        {/* Bottom bar details */}
        <div className="flex items-center justify-between w-full pointer-events-auto mt-auto">
          {/* Participant name info */}
          <div className="flex items-center gap-2 bg-black/55 backdrop-blur-md border border-white/5 px-2.5 py-1 rounded-lg">
            <span className="text-[10px] font-extrabold text-white/90 tracking-wide max-w-[120px] truncate">
              {participant.name || participant.identity}
              {participant.isLocal && " (Siz)"}
            </span>
          </div>

          {/* Device status icons */}
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "h-6 w-6 rounded-md flex items-center justify-center backdrop-blur-md border",
              isMicOn ? "bg-white/10 border-white/10 text-white" : "bg-red/15 border-red/20 text-red"
            )}>
              {isMicOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            </div>
          </div>
        </div>
      </div>
    </ParticipantTile>
  );
}

// --- Inner room (needs LiveKitRoom context) ---
interface InnerRoomProps {
  lessonId: string;
  role: 'TEACHER' | 'STUDENT';
  locale?: string | undefined;
  onLeave: () => void;
}

function InnerRoom({ lessonId, role, locale, onLeave }: InnerRoomProps) {
  const isTeacher = role === 'TEACHER';

  useContentProtection();
  const { isCapturing, isHidden } = useScreenCaptureDetection();
  const [activeTab, setActiveTab] = React.useState<'chat' | 'participants' | 'whiteboard'>('chat');
  const [showSidebar, setShowSidebar] = React.useState(false);
  const [showWhiteboard, setShowWhiteboard] = React.useState(false);
  const [quality, setQuality] = React.useState<'360p' | '720p' | '1080p'>('720p');
  const [sessionData, setSessionData] = React.useState<LiveSessionWithSfu | null>(null);
  const [raisedHands, setRaisedHands] = React.useState<Set<string>>(new Set());
  // Student uchun: teacher mic ruxsat bergan identitylar
  const [micGranted, setMicGranted] = React.useState<Set<string>>(new Set());

  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const room = useRoomContext();

  // Real lesson title from the catalog API (room is inside QueryProvider).
  const { data: lesson } = useQuery({
    queryKey: ['catalog', 'lesson', lessonId],
    queryFn: () => lessonsApi.get(lessonId),
    staleTime: 5 * 60 * 1000,
  });

  const identity = localParticipant?.identity ?? '';
  const isHandRaised = raisedHands.has(identity);
  // Student uchun mic faqat teacher ruxsat berganida toggle qilsa bo'ladi
  const isMicAllowed = isTeacher || micGranted.has(identity);

  // Local participant connection quality (for warnings)
  const [localQuality, setLocalQuality] = React.useState<ConnectionQuality>(ConnectionQuality.Unknown);

  React.useEffect(() => {
    if (!localParticipant) return;
    setLocalQuality(localParticipant.connectionQuality);

    const handleLocalQuality = (q: ConnectionQuality) => {
      setLocalQuality(q);
    };

    localParticipant.on('connectionQualityChanged', handleLocalQuality);
    return () => {
      localParticipant.off('connectionQualityChanged', handleLocalQuality);
    };
  }, [localParticipant]);

  // Heartbeat — fetch session info every 30s
  React.useEffect(() => {
    let active = true;
    const fetch = async () => {
      try {
        const d = await liveApi.getOne(lessonId);
        if (active) setSessionData(d);
      } catch {}
    };
    fetch();
    const t = setInterval(fetch, 30000);
    return () => { active = false; clearInterval(t); };
  }, [lessonId]);

  // DataChannel: hand-raise, mic_grant va admin (mute/kick) eventlarini qabul qilish
  React.useEffect(() => {
    if (!room) return;
    const handler = (payload: Uint8Array, participant?: any) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));

        if (msg.topic === HAND_RAISE_TOPIC) {
          const id: string = participant?.identity ?? msg.identity;
          setRaisedHands(prev => {
            const next = new Set(prev);
            if (msg.raised) next.add(id);
            else next.delete(id);
            return next;
          });
        }

        if (msg.topic === MIC_GRANT_TOPIC) {
          // Teacher tomonidan yuborilgan ruxsat
          setMicGranted(prev => {
            const next = new Set(prev);
            if (msg.granted) next.add(msg.target);
            else {
              next.delete(msg.target);
              // Agar ruxsat olinsa va mic yoqiq bo'lsa — o'chir
              if (msg.target === identity) {
                localParticipant?.setMicrophoneEnabled(false);
              }
            }
            return next;
          });
        }

        // Teacher tomonidan yuborilgan admin buyruqlari (mute / kick).
        // Faqat menga (identity) qaratilgan buyruqlarni qabul qilamiz.
        if (msg.topic === 'admin' && msg.target === identity) {
          if (msg.action === 'mute') {
            localParticipant?.setMicrophoneEnabled(false);
          } else if (msg.action === 'kick') {
            // Roomdan uzilamiz; onDisconnected/onLeave qolganini boshqaradi.
            room.disconnect();
            onLeave();
          }
        }
      } catch {}
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room, identity, localParticipant, onLeave]);

  const toggleMic = async () => {
    if (!isMicAllowed) return; // ruxsat yo'q
    try {
      await localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch {
      toast.error('Mikrofonni yoqib boʻlmadi — brauzer ruxsatini tekshiring');
    }
  };
  const toggleCam = async () => {
    try {
      await localParticipant?.setCameraEnabled(!isCameraEnabled);
    } catch {
      toast.error('Kamerani yoqib boʻlmadi — brauzer ruxsatini tekshiring');
    }
  };
  const toggleScreen = async () => {
    if (!isTeacher) return; // screen share faqat teacher
    try {
      await localParticipant?.setScreenShareEnabled(!isScreenShareEnabled);
    } catch {
      toast.error('Ekranni ulashib boʻlmadi — brauzer ruxsatini tekshiring');
    }
  };

  // Teacher: efirni hamma uchun yakunlash. Backend sessiyani ENDED qiladi va
  // LiveKit room'ni yopadi (barcha ishtirokchilar uziladi). So'ng o'zimiz ham
  // chiqamiz. Faqat o'qituvchi uchun mavjud.
  const handleEndClass = async () => {
    if (!isTeacher) return;
    try {
      await liveApi.end(lessonId);
    } catch {
      toast.error("Darsni yakunlab boʻlmadi — qaytadan urinib koʻring");
      return;
    }
    try { room?.disconnect(); } catch {}
    onLeave();
  };

  const toggleHand = () => {
    const newRaised = !isHandRaised;
    setRaisedHands(prev => {
      const next = new Set(prev);
      if (newRaised) next.add(identity);
      else next.delete(identity);
      return next;
    });
    const msg = JSON.stringify({ topic: HAND_RAISE_TOPIC, raised: newRaised, identity });
    room?.localParticipant.publishData(new TextEncoder().encode(msg), { reliable: true });
  };

  // Teacher tomonidan student'ga mic ruxsat berish/olish
  const grantMic = (targetIdentity: string, grant: boolean) => {
    if (!isTeacher) return;
    setMicGranted(prev => {
      const next = new Set(prev);
      if (grant) next.add(targetIdentity);
      else next.delete(targetIdentity);
      return next;
    });
    const msg = JSON.stringify({ topic: MIC_GRANT_TOPIC, granted: grant, target: targetIdentity });
    room?.localParticipant.publishData(new TextEncoder().encode(msg), { reliable: true });
  };

  const lessonTitle = lesson?.title ?? 'Jonli dars';

  const sessionStatus = sessionData?.session?.status;
  // Platform live sessions are recorded while LIVE — surface a visible
  // recording indicator (R7.1). RECORDING_FAILED is surfaced separately (R7.5).
  const isRecording = sessionStatus === 'LIVE';

  return (
    <div className="h-screen w-full bg-surface text-ink-strong overflow-hidden font-sans relative">
      {/* Ekran yozib olinayotganda kontent yashiriladi */}
      {(isCapturing || isHidden) && (
        <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center bg-black">
          <svg className="mb-4 h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-center text-sm font-bold text-white">
            {isCapturing
              ? 'Ekranni yozib olish aniqlandi — jonli dars to\'xtatildi.'
              : 'Oyna faol emas — kontent himoyalangan.'}
          </p>
        </div>
      )}
      <ReconnectStatus theme="light" />

      {/* Recording finalization + RECORDING_FAILED messaging (R7.4 / R7.5),
          shared with the learner viewer for consistent copy. */}
      <RecordingFinalizationNotice
        lessonId={lessonId}
        status={sessionStatus}
        role={isTeacher ? 'TEACHER' : 'STUDENT'}
        theme="light"
        locale={locale}
      />

      {/* Subtle ambient glow */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/3 w-[600px] h-[300px] bg-blue/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/3 w-[400px] h-[200px] bg-purple/5 rounded-full blur-[80px]" />
      </div>

      <LiveTopBar
        title={lessonTitle}
        teacherName={sessionData?.session?.status === 'LIVE' ? 'Jonli dars' : 'Yuklanmoqda...'}
        viewerCount={participants.length}
        isRecording={isRecording}
        startedAt={sessionData?.session?.startedAt ?? null}
        raisedHandCount={raisedHands.size}
      />

      <main id="main-content" tabIndex={-1} className="flex h-full flex-col pt-[72px] pb-[88px] relative z-20">
        <div className="flex flex-1 gap-3 h-full overflow-hidden px-3 py-2">

          {/* Main video/whiteboard stage — dark neutral stage for video legibility */}
          <div className="flex-1 relative h-full rounded-2xl overflow-hidden border border-rim bg-ink-strong shadow-medium">
            {showWhiteboard ? (
              <Whiteboard />
            ) : (
              <VideoLayout raisedHands={raisedHands} />
            )}

            {/* Student connection quality warning alert overlay */}
            {!isTeacher && localQuality === ConnectionQuality.Poor && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-amber-500/90 backdrop-blur-md border border-amber-400/20 p-3.5 rounded-xl shadow-[0_15px_40px_rgba(0,0,0,0.5)] animate-in fade-in slide-in-from-top-4 duration-300 max-w-sm">
                <AlertTriangle className="h-5 w-5 text-black shrink-0 animate-pulse" />
                <div className="flex flex-col text-left">
                  <p className="text-xs font-black text-black">Internet aloqangiz sust</p>
                  <p className="text-[10px] text-black/80 font-bold leading-normal">Jonli efirda qotishlarni kamaytirish uchun kamerangizni o&apos;chirib qo&apos;yishingizni tavsiya qilamiz.</p>
                </div>
              </div>
            )}

            {!showWhiteboard && (
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 z-10">
                <span className="h-1.5 w-1.5 rounded-full bg-green animate-pulse" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/70">Jonli efir</span>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <LiveSidebar
            isOpen={showSidebar}
            onClose={() => setShowSidebar(false)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            raisedHands={raisedHands}
            micGranted={micGranted}
            isTeacher={isTeacher}
            onGrantMic={grantMic}
          />
        </div>
      </main>

      <LiveControlBar
        isMicOn={isMicrophoneEnabled}
        isCamOn={isCameraEnabled}
        isScreenSharing={isScreenShareEnabled}
        isHandRaised={isHandRaised}
        isSidebarOpen={showSidebar}
        activeTab={activeTab}
        quality={quality}
        isTeacher={isTeacher}
        isMicAllowed={isMicAllowed}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleScreen={toggleScreen}
        onToggleHand={toggleHand}
        onToggleSidebar={() => setShowSidebar(v => !v)}
        onToggleWhiteboard={() => setShowWhiteboard(v => !v)}
        isWhiteboardOn={showWhiteboard}
        onLeave={onLeave}
        onEndClass={isTeacher ? handleEndClass : undefined}
        onSetQuality={setQuality}
      />

      <RoomAudioRenderer />
    </div>
  );
}

// --- Video grid ---
interface VideoLayoutProps {
  raisedHands: Set<string>;
}

function VideoLayout({ raisedHands }: VideoLayoutProps) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const screenTrack = tracks.find(t => t.source === Track.Source.ScreenShare);

  if (screenTrack) {
    return (
      <div className="flex flex-col h-full gap-2 p-2">
        {/* Screen-share focus area stays a dark neutral for video legibility */}
        <div className="flex-[3] relative rounded-2xl overflow-hidden bg-black border border-white/5">
          <FocusLayout trackRef={screenTrack} />
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-blue/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest text-white shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Ekran ulashilmoqda
          </div>
        </div>
        <div className="h-24">
          <CarouselLayout tracks={tracks.filter(t => t.source !== Track.Source.ScreenShare)} className="h-full gap-2">
            <CustomParticipantTile raisedHands={raisedHands} className="rounded-xl overflow-hidden border border-white/10" />
          </CarouselLayout>
        </div>
      </div>
    );
  }

  return (
    <GridLayout tracks={tracks} className="h-full p-2 gap-2">
      <CustomParticipantTile raisedHands={raisedHands} className="rounded-2xl overflow-hidden border border-white/5 bg-ink-strong" />
    </GridLayout>
  );
}

// --- Public LiveRoom entry point ---
export function LiveRoom({ token, serverUrl, lessonId, role, locale, onLeave }: LiveRoomProps) {
  const [joined, setJoined] = React.useState(false);
  // User's pre-join device intent, lifted from PreJoinScreen so the room
  // connects already publishing what the user chose.
  const [micChoice, setMicChoice] = React.useState(false);
  const [camChoice, setCamChoice] = React.useState(false);

  const roomOptions = React.useMemo(() => {
    return {
      adaptiveStream: true,
      dynacast: true,
      videoPublishDefaults: {
        simulcast: true,
        videoCodec: 'vp8' as const,
        backupCodec: true,
        videoEncoding: {
          maxBitrate: role === 'TEACHER' ? 2_000_000 : 600_000,
          maxFramerate: role === 'TEACHER' ? 30 : 15,
        }
      },
      audioPublishDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    };
  }, [role]);

  if (!joined) {
    return (
      <PreJoinScreen
        onJoin={({ mic, cam }) => {
          setMicChoice(mic);
          setCamChoice(cam);
          setJoined(true);
        }}
        canPublish={true}
      />
    );
  }

  return (
    <LiveKitRoom
      video={camChoice}
      audio={micChoice}
      token={token}
      serverUrl={serverUrl}
      onDisconnected={onLeave}
      options={roomOptions}
      className="h-screen w-full"
    >
      <InnerRoom lessonId={lessonId} role={role} locale={locale} onLeave={onLeave} />
    </LiveKitRoom>
  );
}
