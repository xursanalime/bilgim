'use client';

import * as React from 'react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useParticipants,
  useConnectionState,
  CarouselLayout,
  FocusLayout,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, ConnectionState, DataPacket_Kind } from 'livekit-client';
import { Loader2, Video, Mic, MicOff, VideoOff, AlertTriangle, Wifi, WifiOff, Clock } from 'lucide-react';

import { Whiteboard } from '../live/tabs/whiteboard-tab';
import { LiveTopBar } from '../live/live-top-bar';
import { LiveControlBar } from '../live/live-control-bar';
import { LiveSidebar } from '../live/live-sidebar';
import { liveApi, LiveSessionWithSfu } from '../../lib/api/live';
import { LiveStage, LiveWordmark, LiveBackButton, LiveCard } from '../live/live-visual-kit';
import { ConfirmDialog } from '../ui/confirm-dialog';

// DataChannel topic for hand-raise events
export const HAND_RAISE_TOPIC = 'hand-raise';
export const MIC_GRANT_TOPIC = 'mic-grant';

export interface LiveRoomProps {
  token: string;
  serverUrl: string;
  lessonId: string;
  role: 'TEACHER' | 'STUDENT';
  onLeave: () => void;
  returnLabel?: string;
}

// --- Pre-join screen ---
interface PreJoinProps {
  onJoin: () => void;
  onLeave: () => void;
  returnLabel: string;
  lessonTitle?: string;
  canPublish: boolean;
}

function PreJoinScreen({ onJoin, onLeave, returnLabel, lessonTitle, canPublish }: PreJoinProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [micOn, setMicOn] = React.useState(true);
  const [camOn, setCamOn] = React.useState(true);
  const [stream, setStream] = React.useState<MediaStream | null>(null);

  React.useEffect(() => {
    if (!canPublish) return; // student kamera preview ko'rmaydi
    let active = true;
    let localStream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (!active) { s.getTracks().forEach(t => t.stop()); return; }
        localStream = s;
        setStream(s);
      })
      .catch(() => {});
    return () => {
      active = false;
      localStream?.getTracks().forEach(t => t.stop());
    };
  }, [canPublish]);

  // <video> stays mounted across camOn toggles — only (re)bind the stream here,
  // so turning the camera off and back on doesn't leave the element without a
  // srcObject (it used to be conditionally unmounted, which dropped the feed).
  React.useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  React.useEffect(() => {
    stream?.getVideoTracks().forEach(t => { t.enabled = camOn; });
  }, [camOn, stream]);

  const handleJoin = () => {
    stream?.getTracks().forEach(t => t.stop());
    onJoin();
  };

  return (
    <LiveStage>
      <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-6 py-8">
        <div className="flex w-full max-w-5xl items-center justify-between">
          <LiveBackButton onClick={onLeave} label={returnLabel} />
          <LiveWordmark />
        </div>

        <LiveCard className="w-full max-w-5xl">
          <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center">
            {/* Camera preview — stays dark; this is the one surface in the
                platform that's legitimately dark (see globals.css's LiveKit
                dark-room override), everything else here is the light chrome. */}
            <div className="relative aspect-video w-full max-w-xl shrink-0 overflow-hidden rounded-2xl border border-rim bg-black/60 shadow-lg">
              {canPublish ? (
                <div className="relative h-full w-full">
                  <video ref={videoRef} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
                  {!camOn && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0f]">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
                        <VideoOff className="h-9 w-9 text-white/30" />
                      </div>
                      <p className="text-sm font-medium text-white/30">Kamera o&apos;chirilgan</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border border-blue/20 bg-blue/10">
                    <Video className="h-9 w-9 text-blue/60" />
                  </div>
                  <p className="text-sm font-medium text-white/30">Jonli darsga qo&apos;shilasiz</p>
                </div>
              )}

              {/* Bottom controls overlay */}
              {canPublish && (
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/80 to-transparent p-5">
                  <button
                    onClick={() => setMicOn(!micOn)}
                    className={`flex h-11 w-11 items-center justify-center rounded-xl border backdrop-blur-sm transition-all ${micOn ? 'border-white/10 bg-white/10 text-white hover:bg-white/20' : 'border-red/30 bg-red/20 text-red'}`}
                  >
                    {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                  </button>
                  <button
                    onClick={() => setCamOn(!camOn)}
                    className={`flex h-11 w-11 items-center justify-center rounded-xl border backdrop-blur-sm transition-all ${camOn ? 'border-white/10 bg-white/10 text-white hover:bg-white/20' : 'border-red/30 bg-red/20 text-red'}`}
                  >
                    {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                  </button>
                </div>
              )}

              {/* Live badge */}
              <div className="absolute top-4 left-4 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Jonli</span>
              </div>
            </div>

            {/* Right panel */}
            <div className="flex w-full max-w-sm flex-col gap-6">
              <div className="space-y-1">
                <h1 className="text-3xl font-black tracking-tight text-ink-strong">{lessonTitle || 'Jonli dars'}</h1>
                <p className="mt-2 text-sm text-ink-soft">
                  {canPublish
                    ? 'Qurilmangizni tekshirib, darsni boshlang.'
                    : "O'qituvchi darsni boshlaguncha tayyor turing."}
                </p>
              </div>

              {/* Status */}
              <div className="flex items-center gap-3 rounded-xl border border-rim bg-tint p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-tint">
                  <Wifi className="h-4 w-4 text-green" />
                </div>
                <div>
                  <p className="text-xs font-bold text-ink-strong">Aloqa holati</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-green">Tayyor</p>
                </div>
              </div>

              {/* Join button */}
              <button
                onClick={handleJoin}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-blue py-4 text-base font-bold text-white shadow-[0_8px_24px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98]"
              >
                <Video className="h-5 w-5 transition-transform group-hover:scale-110" />
                Darsga kirish
                <span className="shimmer-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-white/25 blur-md" />
              </button>

              <p className="text-center text-[11px] text-ink-faint">
                Kirish orqali siz platformaning foydalanish shartlarini qabul qilasiz
              </p>
            </div>
          </div>
        </LiveCard>
      </div>
    </LiveStage>
  );
}

// --- Connection state overlay ---
function ConnectionOverlay() {
  const state = useConnectionState();
  if (state === ConnectionState.Connected) return null;

  const labels: Record<string, string> = {
    [ConnectionState.Connecting]: 'Ulanmoqda...',
    [ConnectionState.Reconnecting]: 'Qayta ulanmoqda...',
    [ConnectionState.Disconnected]: 'Aloqa uzildi',
  };

  return (
    <div className="absolute inset-0 z-[300] flex items-center justify-center bg-ink-strong/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-rim bg-white px-10 py-8 shadow-soft">
        {state === ConnectionState.Disconnected ? (
          <WifiOff className="h-10 w-10 text-red" />
        ) : (
          <Loader2 className="h-10 w-10 animate-spin text-blue" />
        )}
        <p className="font-bold text-lg text-ink-strong">{labels[state] || 'Ulanmoqda...'}</p>
      </div>
    </div>
  );
}

// --- Inner room (needs LiveKitRoom context) ---
interface InnerRoomProps {
  lessonId: string;
  role: 'TEACHER' | 'STUDENT';
  onLeave: () => void;
}

function InnerRoom({ lessonId, role, onLeave }: InnerRoomProps) {
  const isTeacher = role === 'TEACHER';
  const [activeTab, setActiveTab] = React.useState<'chat' | 'participants' | 'whiteboard'>('chat');
  const [showSidebar, setShowSidebar] = React.useState(false);
  const [showWhiteboard, setShowWhiteboard] = React.useState(false);
  const [quality, setQuality] = React.useState<'360p' | '720p' | '1080p'>('720p');
  const [sessionData, setSessionData] = React.useState<LiveSessionWithSfu | null>(null);
  const [showEndConfirm, setShowEndConfirm] = React.useState(false);
  const [raisedHands, setRaisedHands] = React.useState<Set<string>>(new Set());
  // Student uchun: teacher mic ruxsat bergan identitylar
  const [micGranted, setMicGranted] = React.useState<Set<string>>(new Set());

  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const room = useRoomContext();

  const identity = localParticipant?.identity ?? '';
  const isHandRaised = raisedHands.has(identity);
  // Student uchun mic faqat teacher ruxsat berganida toggle qilsa bo'ladi
  const isMicAllowed = isTeacher || micGranted.has(identity);

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

  // DataChannel: hand-raise va mic_grant eventlarini qabul qilish
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
      } catch {}
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room, identity, localParticipant]);

  const confirmEndBroadcast = async () => {
    setShowEndConfirm(false);
    try {
      await liveApi.end(lessonId);
    } finally {
      onLeave();
    }
  };

  const toggleMic = () => {
    if (!isMicAllowed) return; // ruxsat yo'q
    localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled);
  };
  const toggleCam = () => localParticipant?.setCameraEnabled(!isCameraEnabled);
  const toggleScreen = () => {
    if (!isTeacher) return; // screen share faqat teacher
    localParticipant?.setScreenShareEnabled(!isScreenShareEnabled);
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

  const lessonTitle = sessionData?.lessonTitle || 'Jonli dars';
  const isWaiting = sessionData?.session?.status === 'SCHEDULED';

  return (
    <div className="h-screen w-full bg-[rgb(var(--bg-base))] text-ink-strong overflow-hidden font-sans relative">
      <ConnectionOverlay />

      <LiveTopBar
        title={lessonTitle}
        teacherName={isWaiting ? 'Kutilmoqda...' : sessionData?.session?.status === 'LIVE' ? 'Jonli dars' : 'Yuklanmoqda...'}
        viewerCount={participants.length}
        isRecording={sessionData?.session?.status === 'LIVE'}
        startedAt={sessionData?.session?.startedAt ?? null}
        isWaiting={isWaiting}
        raisedHandCount={raisedHands.size}
      />

      <main className="flex h-full flex-col pt-[104px] pb-[76px] relative z-20 sm:pt-[72px] sm:pb-[88px]">
        <div className="flex flex-1 gap-0 md:gap-4 h-full overflow-hidden px-2 py-2 sm:px-4 sm:py-3">

          {/* Main video/whiteboard stage — a white platform-style card (border-rim +
              shadow-soft) framing the video, which stays dark (#111118) since that's
              the one legitimate dark surface already used platform-wide. */}
          <div className="flex-1 h-full rounded-[1.75rem] border border-rim bg-white p-2 shadow-soft">
            <div className="relative h-full w-full overflow-hidden rounded-[1.25rem] bg-[#111118]">
              {showWhiteboard ? (
                <Whiteboard />
              ) : (
                <VideoLayout />
              )}
              {!showWhiteboard && (
                <div className={`absolute bottom-3 left-3 flex items-center gap-1.5 backdrop-blur-md px-2.5 py-1 rounded-full border z-10 ${isWaiting ? 'bg-orange/20 border-orange/30' : 'bg-black/60 border-white/10'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isWaiting ? 'bg-orange' : 'bg-green animate-pulse'}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${isWaiting ? 'text-orange' : 'text-white/70'}`}>
                    {isWaiting ? 'Kutish xonasi' : 'Jonli efir'}
                  </span>
                </div>
              )}
              {!showWhiteboard && isWaiting && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
                  <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-black/60 px-10 py-8 text-center backdrop-blur-md">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange/20">
                      <Clock className="h-7 w-7 text-orange" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-white">O&apos;qituvchi hali kirmadi</p>
                      <p className="mt-1.5 max-w-xs text-sm text-white/60">
                        Kamerangiz va mikrofoningizni tekshirib turing — o&apos;qituvchi efirni boshlashi bilan avtomatik ravishda jonli efir boshlanadi.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
        onEndBroadcast={isTeacher ? () => setShowEndConfirm(true) : undefined}
        onSetQuality={setQuality}
      />

      <ConfirmDialog
        open={showEndConfirm}
        title="Efirni yakunlash"
        message="Efirni barcha ishtirokchilar uchun yakunlaysizmi? Bu amalni bekor qilib bo'lmaydi."
        confirmLabel="Ha, yakunlash"
        cancelLabel="Bekor qilish"
        tone="danger"
        onConfirm={confirmEndBroadcast}
        onCancel={() => setShowEndConfirm(false)}
      />

      <RoomAudioRenderer />
    </div>
  );
}

// --- Video grid ---
function VideoLayout() {
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
        <div className="flex-[3] relative rounded-2xl overflow-hidden bg-black border border-white/5">
          <FocusLayout trackRef={screenTrack} />
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-blue/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest text-white shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Ekran ulashilmoqda
          </div>
        </div>
        <div className="h-24">
          <CarouselLayout tracks={tracks.filter(t => t.source !== Track.Source.ScreenShare)} className="h-full gap-2">
            <ParticipantTile className="rounded-xl overflow-hidden border border-white/10" />
          </CarouselLayout>
        </div>
      </div>
    );
  }

  return (
    <GridLayout tracks={tracks} className="h-full p-2 gap-2">
      <ParticipantTile className="rounded-2xl overflow-hidden border border-white/5 bg-[#111118]" />
    </GridLayout>
  );
}

// --- Public LiveRoom entry point ---
export function LiveRoom({ token, serverUrl, lessonId, role, onLeave, returnLabel = 'Dashboardga qaytish' }: LiveRoomProps) {
  const [joined, setJoined] = React.useState(false);

  if (!joined) {
    return <PreJoinScreen onJoin={() => setJoined(true)} onLeave={onLeave} returnLabel={returnLabel} canPublish={true} />;
  }

  return (
    <LiveKitRoom
      video={true}
      audio={false}
      token={token}
      serverUrl={serverUrl}
      onDisconnected={onLeave}
      className="h-screen w-full"
    >
      <InnerRoom lessonId={lessonId} role={role} onLeave={onLeave} />
    </LiveKitRoom>
  );
}
