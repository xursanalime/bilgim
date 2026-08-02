'use client';

import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare,
  Users, Hand, PhoneOff, Settings, PenLine, X, ChevronDown, StopCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  useMediaDeviceSelect,
  useRoomContext,
} from '@livekit/components-react';
import { Track, VideoPresets, LocalVideoTrack } from 'livekit-client';

interface LiveControlBarProps {
  isMicOn: boolean;
  isCamOn: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  isSidebarOpen: boolean;
  isWhiteboardOn: boolean;
  isTeacher: boolean;
  isMicAllowed: boolean;
  activeTab: string;
  quality: string;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreen: () => void;
  onToggleHand: () => void;
  onToggleSidebar: () => void;
  onToggleWhiteboard: () => void;
  onLeave: () => void;
  /** Teacher-only: ends the session for every participant (vs. `onLeave`, which only disconnects the caller). */
  onEndBroadcast?: (() => void | Promise<void>) | undefined;
  onSetQuality: (q: '360p' | '720p' | '1080p') => void;
}

const QUALITY_PRESETS = {
  '360p': VideoPresets.h360,
  '720p': VideoPresets.h720,
  '1080p': VideoPresets.h1080,
} as const;

export function LiveControlBar({
  isMicOn, isCamOn, isScreenSharing, isHandRaised,
  isSidebarOpen, isWhiteboardOn, isTeacher, isMicAllowed, activeTab, quality,
  onToggleMic, onToggleCam, onToggleScreen, onToggleHand,
  onToggleSidebar, onToggleWhiteboard, onLeave, onEndBroadcast, onSetQuality,
}: LiveControlBarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const room = useRoomContext();

  const { devices: videoDevices, activeDeviceId: activeCam, setActiveMediaDevice: setActiveCam } =
    useMediaDeviceSelect({ kind: 'videoinput' });
  const { devices: audioDevices, activeDeviceId: activeMic, setActiveMediaDevice: setActiveMic } =
    useMediaDeviceSelect({ kind: 'audioinput' });
  const { devices: audioOutputDevices, activeDeviceId: activeSpeaker, setActiveMediaDevice: setActiveSpeaker } =
    useMediaDeviceSelect({ kind: 'audiooutput' });

  // Close settings on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        settingsRef.current && !settingsRef.current.contains(target) &&
        (!settingsPanelRef.current || !settingsPanelRef.current.contains(target))
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleQuality = async (q: '360p' | '720p' | '1080p') => {
    onSetQuality(q);
    // Recapture at the new resolution — this is what actually drives
    // simulcast layer selection; there is no such thing as a
    // "setPublishingQuality" API on the track.
    const camTrack = room?.localParticipant?.getTrackPublication(Track.Source.Camera)?.track;
    if (camTrack instanceof LocalVideoTrack) {
      try {
        await camTrack.restartTrack({ resolution: QUALITY_PRESETS[q].resolution });
      } catch {}
    }
  };

  return (
    <div className="fixed bottom-2 left-1/2 z-[200] w-[calc(100vw-1rem)] -translate-x-1/2 overflow-x-auto sm:bottom-4 sm:w-auto">
      <div className="mx-auto flex w-fit items-center gap-1 rounded-2xl border border-rim bg-white p-1.5 shadow-soft sm:gap-2 sm:p-2">

        {/* Mic + Camera — hammaga ko'rinadi, mic uchun ruxsat tekshiriladi */}
        <div className="flex items-center gap-1 border-r border-rim px-1 sm:gap-2 sm:px-2">
          <ControlBtn
            onClick={onToggleMic}
            active={isMicOn}
            danger={!isMicOn}
            disabled={!isMicAllowed}
            icon={isMicOn ? Mic : MicOff}
            label={!isMicAllowed ? "Teacher ruxsat bermagan" : isMicOn ? "Mikrofonni o'chirish" : 'Mikrofonni yoqish'}
          />
          <ControlBtn
            onClick={onToggleCam}
            active={isCamOn}
            danger={!isCamOn}
            icon={isCamOn ? Video : VideoOff}
            label={isCamOn ? "Kamerani o'chirish" : 'Kamerani yoqish'}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 px-1 sm:gap-2 sm:px-2">
          {isTeacher && (
            <ControlBtn onClick={onToggleScreen} active={isScreenSharing}
              icon={MonitorUp} label="Ekran ulashish" />
          )}
          {!isTeacher && (
            <ControlBtn
              onClick={onToggleHand}
              active={isHandRaised}
              icon={Hand}
              label={isHandRaised ? "Qo'lni tushirish" : "Qo'l ko'tarish"}
              pulse={isHandRaised}
              pulseColor="orange"
            />
          )}
          {isTeacher && (
            <ControlBtn onClick={onToggleWhiteboard} active={isWhiteboardOn}
              icon={PenLine} label="Doska" />
          )}
          <ControlBtn
            onClick={onToggleSidebar}
            active={isSidebarOpen}
            icon={activeTab === 'participants' ? Users : MessageSquare}
            label="Panel"
          />
        </div>

        {/* Settings + Leave */}
        <div className="flex items-center gap-1 border-l border-rim px-1 sm:gap-2 sm:px-2" ref={settingsRef}>
          <div className="relative">
            <ControlBtn onClick={() => setShowSettings(v => !v)} icon={Settings}
              label="Sozlamalar" active={showSettings} />

            {showSettings && typeof document !== 'undefined' && createPortal(
              <div
                ref={settingsPanelRef}
                className="fixed bottom-20 left-1/2 z-[210] w-[85vw] max-w-80 -translate-x-1/2 rounded-[2rem] border border-rim bg-white p-5 shadow-soft animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200 sm:bottom-24"
              >
                {/* Quality */}
                <Section label="Video sifati">
                  <div className="flex bg-tint rounded-xl p-1 gap-1">
                    {(['360p', '720p', '1080p'] as const).map(q => (
                      <button
                        key={q}
                        onClick={() => handleQuality(q)}
                        className={cn(
                          'flex-1 py-2 text-[10px] font-black rounded-lg transition-all',
                          quality === q ? 'bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]' : 'text-ink-soft hover:text-ink-strong hover:bg-white'
                        )}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </Section>

                {/* Camera */}
                {videoDevices.length > 0 && (
                  <Section label="Kamera">
                    <DeviceSelect
                      devices={videoDevices}
                      activeId={activeCam}
                      onChange={(id) => setActiveCam(id)}
                    />
                  </Section>
                )}

                {/* Microphone */}
                {audioDevices.length > 0 && (
                  <Section label="Mikrofon">
                    <DeviceSelect
                      devices={audioDevices}
                      activeId={activeMic}
                      onChange={(id) => setActiveMic(id)}
                    />
                  </Section>
                )}

                {/* Speaker */}
                {audioOutputDevices.length > 0 && (
                  <Section label="Dinamik">
                    <DeviceSelect
                      devices={audioOutputDevices}
                      activeId={activeSpeaker}
                      onChange={(id) => setActiveSpeaker(id)}
                    />
                  </Section>
                )}
              </div>,
              document.body
            )}
          </div>

          {isTeacher && onEndBroadcast && (
            <button
              onClick={onEndBroadcast}
              title="Efirni yakunlash"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red/30 bg-red-tint text-red transition-all hover:bg-red/15 active:scale-95 sm:h-10 sm:w-10"
              aria-label="Efirni barchaga yakunlash"
            >
              <StopCircle className="h-5 w-5" />
            </button>
          )}

          <button
            onClick={onLeave}
            className="flex h-9 w-12 shrink-0 items-center justify-center rounded-xl bg-red text-white transition-all hover:opacity-90 active:scale-95 shadow-md shadow-red/30 group sm:h-10 sm:w-16"
            aria-label="Darsni tark etish"
          >
            <PhoneOff className="h-4 w-4 group-hover:rotate-[135deg] transition-transform duration-500" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function ControlBtn({
  onClick, active, icon: Icon, danger, label, pulse, pulseColor = 'blue', disabled,
}: {
  onClick: () => void;
  active?: boolean;
  icon: any;
  danger?: boolean;
  label: string;
  pulse?: boolean;
  pulseColor?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={label}
      disabled={disabled}
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 active:scale-90 sm:h-10 sm:w-10',
        disabled
          ? 'bg-tint text-ink-ghost cursor-not-allowed'
          : danger
            ? 'bg-red-tint text-red hover:bg-red/15'
            : active
              ? 'bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]'
              : 'bg-tint text-ink-soft hover:bg-black/[0.06] hover:text-ink-strong'
      )}
    >
      <Icon className="h-5 w-5" />
      {pulse && !disabled && (
        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange" />
        </span>
      )}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 mb-4 last:mb-0">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-ink-faint px-1">{label}</p>
      {children}
    </div>
  );
}

function DeviceSelect({
  devices, activeId, onChange,
}: {
  devices: MediaDeviceInfo[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={activeId}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-tint border border-rim rounded-xl px-4 py-2.5 text-xs text-ink-strong outline-none focus:border-blue/50 appearance-none cursor-pointer"
      >
        {devices.map(d => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Qurilma ${d.deviceId.slice(0, 5)}`}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none" />
    </div>
  );
}
