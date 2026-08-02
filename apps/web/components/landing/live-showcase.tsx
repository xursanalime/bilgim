'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  MicOff,
  PhoneOff,
  ScreenShare,
  Video,
  Users,
  MessageSquare,
  BellRing,
  Smartphone,
  ShieldCheck,
  Hand,
  Heart,
} from 'lucide-react';
import { SectionHeader } from './features-bento';

/**
 * LiveShowcase — class video stage with real participant videos.
 *
 * Layout:
 *   - Section header (eyebrow, title, subtitle)
 *   - VideoStage CENTERED (single column, breathing room around it)
 *   - 4 floating "rooms" hovering near the corners of the stage
 *   - 6 feature pills below
 *
 * All videos load from Mixkit (https://mixkit.co/free-stock-video/),
 * which is licensed for free commercial use without attribution. The
 * `<SmartVideo>` helper plays each clip muted, looping, and pauses
 * when the stage scrolls out of view. The poster is shown until the
 * video buffers — and stays as a fallback if the network blocks the
 * MP4.
 */
export function LiveShowcase() {
  return (
    <section className="relative isolate overflow-hidden py-20 sm:py-28">
      {/* Soft pastel ambient backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[10%] top-[10%] h-[50vh] w-[40vw] rounded-full bg-blue/10 blur-[140px]" />
        <div className="absolute right-[10%] top-[20%] h-[40vh] w-[35vw] rounded-full bg-purple/8 blur-[140px]" />
      </div>

      <div className="container-page relative">
        <SectionHeader
          eyebrow="Jonli darslar"
          title={
            <>
              Sinfdek tajriba.{' '}
              <span className="italic text-hero-gradient">Onlayn.</span>
            </>
          }
          subtitle="500 talabagacha bir vaqtda. Toza video va ovoz bilan. Har bir dars avtomatik yozib olinadi — keyin qaytib ko'rsa bo'ladi."
        />

        {/* Stage — centered video with corner floaters */}
        <div className="relative mx-auto mt-14 w-full max-w-5xl sm:mt-16">
          <PulseRings />

          {/* Floaters position relative to the stage so they sit at its corners */}
          <FloatingRoom
            position="top-left"
            label="Speaking Club"
            sublabel="3 ishtirokchi"
            avatars={[
              'from-blue-400 to-blue-600',
              'from-blue-400 to-blue-600',
            ]}
            delay={0.6}
          />
          <FloatingRoom
            position="top-right"
            label="O'qituvchilar uchrashuvi"
            sublabel="Hozir efirda"
            avatars={[
              'from-orange-400 to-orange-600',
              'from-purple-400 to-purple-600',
            ]}
            delay={0.75}
          />
          <FloatingRoom
            position="bottom-left"
            label="IELTS Writing"
            sublabel="Bugun 14:00"
            avatars={[
              'from-purple-400 to-purple-600',
              'from-orange-400 to-orange-600',
            ]}
            delay={0.9}
          />
          <FloatingRoom
            position="bottom-right"
            label="Umumiy yig'ilish"
            sublabel="42 ishtirokchi"
            avatars={[
              'from-blue-400 to-blue-600',
              'from-blue-400 to-blue-600',
            ]}
            delay={1.05}
          />

          {/* The actual centered video card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.8, ease: [0.25, 0.4, 0.25, 1] }}
            className="relative z-20 mx-auto w-full max-w-[760px]"
          >
            <VideoStage />
          </motion.div>
        </div>

        {/* Bottom feature pills */}
        <div className="mx-auto mt-10 max-w-4xl">
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Pill icon={<Video className="h-3.5 w-3.5" />}>Avtomatik yozib olish</Pill>
            <Pill icon={<Users className="h-3.5 w-3.5" />}>500 ta ishtirokchi</Pill>
            <Pill icon={<MessageSquare className="h-3.5 w-3.5" />}>Chat va savol-javob</Pill>
            <Pill icon={<BellRing className="h-3.5 w-3.5" />}>Eslatma yuborish</Pill>
            <Pill icon={<Smartphone className="h-3.5 w-3.5" />}>Telefon va kompyuterda</Pill>
            <Pill icon={<ShieldCheck className="h-3.5 w-3.5" />}>Xavfsiz aloqa</Pill>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────

function PulseRings() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: 1100, height: 700 }}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: '100%',
            height: '100%',
            border: '1.5px solid rgba(0, 113, 227, 0.10)',
            animation: `pulse-ring 5.5s cubic-bezier(0, 0, 0.3, 1) ${i * 1.3}s infinite`,
            opacity: 0,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes pulse-ring {
          0% {
            transform: translate(-50%, -50%) scale(0.3);
            opacity: 0;
          }
          15% {
            opacity: 0.8;
          }
          100% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// VideoStage — main centered card with real teacher video + 3 students
// ─────────────────────────────────────────────────────────────────

function VideoStage() {
  return (
    <div
      className="liquid-glass-strong relative overflow-hidden rounded-[2rem]"
      style={{
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.04), 0 60px 120px -30px rgba(0, 113, 227, 0.2), 0 30px 80px -20px rgba(175, 82, 222, 0.15)',
      }}
    >
      {/* Window header */}
      <div className="flex items-center justify-between border-b border-rim bg-canvas/85 px-5 py-3.5 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red" />
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-red">
            Efirda
          </span>
          <span className="text-sm font-semibold text-ink-strong">
            Ingliz tili · 5-sinf
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 sm:inline-flex">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-blue">
              HD
            </span>
          </span>
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-ink-soft">
            <Users className="h-3.5 w-3.5" /> 42
          </div>
        </div>
      </div>

      {/* Video stage */}
      <div className="relative aspect-[16/10] bg-gradient-to-br from-blue-tint via-canvas to-purple-tint">
        {/* Teacher video — the speaker */}
        <SmartVideo
          sources={[
            '/videos/teacher.mp4',
            'https://assets.mixkit.co/videos/5940/5940-720.mp4',
          ]}
          poster={TEACHER_POSTER}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Soft vignette + bottom darkness */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/15" />

        {/* Speaking indicator (top-left) */}
        <SpeakingIndicator />

        {/* Live captions */}
        <CaptionStrip />

        {/* Floating reactions */}
        <FloatingReactions />

        {/* Right participant strip — three real student videos */}
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          {PARTICIPANTS.map((p, i) => (
            <ParticipantThumb
              key={p.name}
              {...p}
              delay={0.4 + i * 0.12}
              isSpeaking={i === 0}
            />
          ))}
        </div>

        {/* Bottom controls */}
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2">
          <ControlBtn variant="muted" label="Ekran ulashish">
            <ScreenShare className="h-4 w-4" />
          </ControlBtn>
          <ControlBtn variant="muted" label="Mikrofon o'chiq">
            <MicOff className="h-4 w-4" />
          </ControlBtn>
          <ControlBtn variant="end" label="Tugatish">
            <PhoneOff className="h-4 w-4" />
          </ControlBtn>
          <ControlBtn variant="muted" label="Video">
            <Video className="h-4 w-4" />
          </ControlBtn>
          <ControlBtn variant="muted" label="To'liq ekran">
            <Maximize2 className="h-4 w-4" />
          </ControlBtn>
        </div>
      </div>
    </div>
  );
}

const TEACHER_POSTER =
  'https://images.unsplash.com/photo-1580894732444-8ecded7900cd?auto=format&fit=crop&w=1200&q=85';

// ─────────────────────────────────────────────────────────────────

function SpeakingIndicator() {
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-md">
      <span className="text-[10px] font-bold text-white">Sevara opa</span>
      <div className="flex items-end gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-0.5 rounded-full bg-teal"
            style={{
              height: '8px',
              animation: `voice-bar 0.9s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <style jsx>{`
        @keyframes voice-bar {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

const CAPTIONS = [
  'Bugun biz past tense haqida gaplashamiz...',
  "Past tense — bo'lib o'tgan vaqtda harakatni ifodalaydi.",
  'Misol uchun: I went to school yesterday.',
];

function CaptionStrip() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const interval = window.setInterval(() => {
      setIdx((i) => (i + 1) % CAPTIONS.length);
    }, 4500);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-x-6 bottom-16 flex justify-center">
      <motion.div
        key={idx}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.5 }}
        className="rounded-xl bg-black/65 px-3.5 py-2 text-center backdrop-blur-md"
      >
        <p className="text-xs font-medium text-white sm:text-sm">
          {CAPTIONS[idx]}
        </p>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function FloatingReactions() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[
        { Icon: Heart, color: 'text-red', delay: 0, left: '20%' },
        { Icon: Hand, color: 'text-orange', delay: 1.5, left: '35%' },
        { Icon: Heart, color: 'text-red', delay: 2.8, left: '60%' },
        { Icon: Hand, color: 'text-orange', delay: 4.2, left: '80%' },
      ].map(({ Icon, color, delay, left }, i) => (
        <span
          key={i}
          className={`absolute bottom-20 ${color}`}
          style={{
            left,
            animation: `reaction-float 5s linear ${delay}s infinite`,
            opacity: 0,
          }}
        >
          <Icon
            className="h-5 w-5 drop-shadow-lg"
            fill="currentColor"
            strokeWidth={0}
          />
        </span>
      ))}
      <style jsx>{`
        @keyframes reaction-float {
          0% {
            transform: translateY(0) scale(0.4);
            opacity: 0;
          }
          15% {
            opacity: 1;
            transform: translateY(-30px) scale(1);
          }
          100% {
            transform: translateY(-280px) scale(0.7);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Participants — three students with real video feeds + photo posters
// ─────────────────────────────────────────────────────────────────

interface Participant {
  name: string;
  poster: string;
  /** Mixkit MP4 URL list, fallback if first fails. */
  sources: string[];
}

const PARTICIPANTS: Participant[] = [
  {
    name: 'Olim',
    poster:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
    sources: [
      '/videos/student-1.mp4',
      'https://assets.mixkit.co/videos/4834/4834-720.mp4',
    ],
  },
  {
    name: 'Diyora',
    poster:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&q=80',
    sources: [
      '/videos/student-2.mp4',
      'https://assets.mixkit.co/videos/4844/4844-720.mp4',
    ],
  },
  {
    name: 'Sardor',
    poster:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
    sources: [
      '/videos/student-3.mp4',
      'https://assets.mixkit.co/videos/41272/41272-720.mp4',
    ],
  },
];

function ParticipantThumb({
  name,
  poster,
  sources,
  delay,
  isSpeaking,
}: Participant & { delay: number; isSpeaking?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className={`relative h-16 w-24 overflow-hidden rounded-xl border-2 ${
        isSpeaking ? 'border-blue shadow-blue-soft' : 'border-white/80 shadow-soft'
      }`}
    >
      <SmartVideo
        sources={sources}
        poster={poster}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-0.5">
        <p className="truncate text-[9px] font-bold text-white">{name}</p>
      </div>
      {isSpeaking && (
        <div className="absolute right-1 top-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal" />
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SmartVideo — robust video loader with poster fallback
// ─────────────────────────────────────────────────────────────────

function SmartVideo({
  sources,
  poster,
  className = '',
}: {
  sources: string[];
  poster: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [errored, setErrored] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Try to start playback on mount; pause when off-screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      el.pause();
      return;
    }

    // Eagerly try to play (muted autoplay is allowed by browsers).
    el.play().catch(() => {
      // Autoplay was blocked — poster will remain.
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [activeIdx]);

  const handleError = () => {
    if (activeIdx < sources.length - 1) {
      setActiveIdx((i) => i + 1);
      setPlaying(false);
    } else {
      setErrored(true);
    }
  };

  return (
    <>
      {/* Poster sits behind the video. It remains visible while the
          stream buffers and stays as the permanent fallback if the
          video fails to load. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={poster} alt="" className={className} aria-hidden />

      {!errored && (
        <video
          key={sources[activeIdx]}
          ref={ref}
          src={sources[activeIdx]}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onCanPlay={() => setPlaying(true)}
          onError={handleError}
          className={`${className} ${playing ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// FloatingRoom — secondary class previews orbiting the main stage
// ─────────────────────────────────────────────────────────────────

function FloatingRoom({
  position,
  label,
  sublabel,
  avatars,
  delay,
}: {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  label: string;
  sublabel: string;
  avatars: string[];
  delay: number;
}) {
  const positionClass = {
    'top-left': '-top-6 left-0 sm:-top-4 sm:-left-8 lg:-left-12',
    'top-right': '-top-6 right-0 sm:-top-4 sm:-right-8 lg:-right-12',
    'bottom-left': '-bottom-6 left-0 sm:-bottom-4 sm:-left-8 lg:-left-12',
    'bottom-right': '-bottom-6 right-0 sm:-bottom-4 sm:-right-8 lg:-right-12',
  }[position];

  const dur = 5 + (delay * 1.2) % 2;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 20 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay }}
      className={`absolute z-10 hidden lg:block ${positionClass}`}
      style={{
        animation: `float-medium ${dur}s cubic-bezier(0.45, 0, 0.55, 1) ${delay}s infinite`,
      }}
    >
      <div className="liquid-glass-strong rounded-2xl px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1.5">
            {avatars.map((g, i) => (
              <span
                key={i}
                className={`h-6 w-6 rounded-full border-2 border-canvas bg-gradient-to-br ${g}`}
              />
            ))}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold leading-tight text-ink-strong">
              {label}
            </p>
            <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-ink-soft">
              {sublabel}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────

function ControlBtn({
  children,
  variant,
  label,
}: {
  children: React.ReactNode;
  variant: 'muted' | 'end';
  label: string;
}) {
  return (
    <button
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-md transition-all hover:scale-105 ${
        variant === 'end'
          ? 'bg-red text-white shadow-[0_8px_24px_-8px_rgba(255,59,48,0.6)]'
          : 'bg-black/45 text-white hover:bg-black/60'
      }`}
    >
      {children}
    </button>
  );
}

function Pill({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-rim bg-canvas px-4 py-2 text-xs font-medium text-ink-soft transition-all hover:-translate-y-0.5 hover:border-blue/30 hover:bg-blue-tint hover:text-blue shadow-soft">
      <span className="text-blue">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
