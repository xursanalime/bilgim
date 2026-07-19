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
import { Loader2, Video, Mic, MicOff, VideoOff, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

import { Whiteboard } from '../live/tabs/whiteboard-tab';
import { LiveTopBar } from '../live/live-top-bar';
import { LiveControlBar } from '../live/live-control-bar';
import { LiveSidebar } from '../live/live-sidebar';
import { liveApi, LiveSessionWithSfu } from '../../lib/api/live';

// DataChannel topic for hand-raise events
export const HAND_RAISE_TOPIC = 'hand-raise';
export const MIC_GRANT_TOPIC = 'mic-grant';

export interface LiveRoomProps {
  token: string;
  serverUrl: string;
  lessonId: string;
  role: 'TEACHER' | 'STUDENT';
  onLeave: () => void;
}

// --- Pre-join screen ---
interface PreJoinProps {
  onJoin: () => void;
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
    onJoin();
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0f] relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row gap-8 w-full max-w-5xl mx-auto items-center px-6 py-8">
        {/* Camera preview */}
        <div className="relative w-full max-w-xl aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/8 shadow-2xl shadow-black/50 flex-shrink-0">
          {canPublish ? (
            camOn ? (
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="h-20 w-20 rounded-full bg-white/10 flex items-center justify-center">
                  <VideoOff className="h-9 w-9 text-white/30" />
                </div>
                <p className="text-white/30 text-sm font-medium">Kamera o&apos;chirilgan</p>
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="h-20 w-20 rounded-full bg-blue/10 border border-blue/20 flex items-center justify-center">
                <Video className="h-9 w-9 text-blue/60" />
              </div>
              <p className="text-white/30 text-sm font-medium">Jonli darsga qo&apos;shilasiz</p>
            </div>
          )}

          {/* Bottom controls overlay */}
          {canPublish && (
            <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center gap-3">
              <button
                onClick={() => setMicOn(!micOn)}
                className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all backdrop-blur-sm border ${micOn ? 'bg-white/10 border-white/10 text-white hover:bg-white/20' : 'bg-red/20 border-red/30 text-red'}`}
              >
                {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </button>
              <button
                onClick={() => setCamOn(!camOn)}
                className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all backdrop-blur-sm border ${camOn ? 'bg-white/10 border-white/10 text-white hover:bg-white/20' : 'bg-red/20 border-red/30 text-red'}`}
              >
                {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </button>
            </div>
          )}

          {/* Live badge */}
          <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-red animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Jonli</span>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-6 w-full max-w-sm">
          {/* Logo + title */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-blue flex items-center justify-center shadow-lg shadow-blue/30">
                <Video className="h-4 w-4 text-white" />
              </div>
              <span className="text-white/40 text-sm font-semibold">BilgimAI Live</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">{lessonTitle || 'Jonli dars'}</h1>
            <p className="text-white/40 text-sm mt-2">
              {canPublish
                ? 'Qurilmangizni tekshirib, darsni boshlang.'
                : "O'qituvchi darsni boshlaguncha tayyor turing."}
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/8">
            <div className="h-8 w-8 rounded-lg bg-green/10 flex items-center justify-center">
              <Wifi className="h-4 w-4 text-green" />
            </div>
            <div>
              <p className="text-xs font-bold text-white/70">Aloqa holati</p>
              <p className="text-[10px] text-green font-semibold uppercase tracking-wider">Tayyor</p>
            </div>
          </div>

          {/* Join button */}
          <button
            onClick={handleJoin}
            className="w-full py-4 rounded-xl bg-blue hover:bg-blue/90 text-white font-bold text-base shadow-xl shadow-blue/25 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group"
          >
            <Video className="h-5 w-5 group-hover:scale-110 transition-transform" />
            Darsga kirish
          </button>

          <p className="text-center text-[11px] text-white/20">
            Kirish orqali siz platformaning foydalanish shartlarini qabul qilasiz
          </p>
        </div>
      </div>
    </div>
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
    <div className="absolute inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 text-white">
        {state === ConnectionState.Disconnected ? (
          <WifiOff className="h-10 w-10 text-red" />
        ) : (
          <Loader2 className="h-10 w-10 animate-spin text-blue" />
        )}
        <p className="font-bold text-lg">{labels[state] || 'Ulanmoqda...'}</p>
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

  const lessonTitle = sessionData?.session
    ? `Dars — ${sessionData.session.lessonId.slice(0, 8)}`
    : 'Jonli dars';

  return (
    <div className="h-screen w-full bg-[#0a0a0f] text-white overflow-hidden font-sans relative">
      <ConnectionOverlay />

      {/* Subtle ambient glow */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/3 w-[600px] h-[300px] bg-blue/3 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/3 w-[400px] h-[200px] bg-indigo-500/3 rounded-full blur-[80px]" />
        {/* Top & bottom fade */}
        <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-black/60 to-transparent" />
      </div>

      <LiveTopBar
        title={lessonTitle}
        teacherName={sessionData?.session?.status === 'LIVE' ? 'Jonli dars' : 'Yuklanmoqda...'}
        viewerCount={participants.length}
        isRecording={false}
        startedAt={sessionData?.session?.startedAt ?? null}
        raisedHandCount={raisedHands.size}
      />

      <main className="flex h-full flex-col pt-[72px] pb-[88px] relative z-20">
        <div className="flex flex-1 gap-3 h-full overflow-hidden px-3 py-2">

          {/* Main video/whiteboard stage */}
          <div className="flex-1 relative h-full rounded-2xl overflow-hidden border border-white/[0.06] bg-[#0d0d14] shadow-2xl">
            {showWhiteboard ? (
              <Whiteboard />
            ) : (
              <VideoLayout />
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
        onSetQuality={setQuality}
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
export function LiveRoom({ token, serverUrl, lessonId, role, onLeave }: LiveRoomProps) {
  const [joined, setJoined] = React.useState(false);

  if (!joined) {
    return <PreJoinScreen onJoin={() => setJoined(true)} canPublish={true} />;
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
