'use client';

import { motion } from 'framer-motion';
import { PulseRings } from './effects/pulse-rings';
import { AuroraBg } from './effects/aurora-bg';

/**
 * LiveShowcase — Huly virtual office stilida live efir seksiyasi.
 *
 * Markazda jonli efir mockup, atrofida pulsatsiyalanuvchi halqalar.
 * Chap/o'ng tomonda float qiluvchi kichik kartochkalar.
 *
 * Bilgim konteksti: o'qituvchining live darsi, o'ng tomonda
 * ishtirokchilar paneli, atrofda boshqa darslar/guruhlar.
 */
export function LiveShowcase() {
  return (
    <section className="relative isolate overflow-hidden bg-ink py-24 sm:py-32">
      {/* Soft aurora background */}
      <AuroraBg variant="electric" />

      {/* Section header */}
      <div className="relative mx-auto mb-16 max-w-3xl px-4 text-center sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
            <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
            Jonli efir
          </span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mt-5 text-balance font-extrabold tracking-tight text-cream"
          style={{
            fontSize: 'clamp(2.25rem, 5vw, 4rem)',
            letterSpacing: '-0.04em',
          }}
        >
          Sinfda bo&apos;lgandek.{' '}
          <span className="text-accent2-500">Lekin onlayn.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mt-5 max-w-2xl text-balance text-base text-cream-dim sm:text-lg"
        >
          Yuqori sifatli video va audio bilan jonli darslar. mediasoup SFU
          texnologiyasi orqali 500+ talabaga bir vaqtda. Avtomatik yozib olinadi.
        </motion.p>
      </div>

      {/* Stage with mockup + pulses + floating cards */}
      <div className="relative mx-auto h-[620px] max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Pulse rings (behind mockup) */}
        <div className="absolute inset-0 flex items-center justify-center">
          <PulseRings
            count={5}
            color="rgba(120, 140, 255, 0.45)"
            duration={5}
            size={780}
          />
        </div>

        {/* Glow ground */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-blue-500/10 blur-3xl" />

        {/* Floating side cards — left */}
        <SideCard
          className="absolute left-0 top-[18%] hidden md:block"
          icon="🎓"
          label="Math · 5-sinf"
          status="Hozir efirda"
          dot="#00E87A"
          delay={0.6}
        />
        <SideCard
          className="absolute left-[8%] top-[55%] hidden md:block"
          icon="📚"
          label="English Speaking"
          status="2 daqiqa"
          dot="#5BA8FF"
          delay={0.8}
        />

        {/* Floating side cards — right */}
        <SideCard
          className="absolute right-0 top-[14%] hidden md:block"
          icon="🎤"
          label="Lounge"
          status="O'qituvchilar"
          dot="#A78BFA"
          delay={0.7}
        />
        <SideCard
          className="absolute right-[8%] top-[60%] hidden md:block"
          icon="✏️"
          label="Design Week"
          status="14:00 da"
          dot="#FFB454"
          delay={0.9}
        />

        {/* Center video mockup */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="absolute left-1/2 top-1/2 w-full max-w-[680px] -translate-x-1/2 -translate-y-1/2"
        >
          <div
            className="relative overflow-hidden rounded-3xl border border-white/[0.1] bg-ink-surface/80 backdrop-blur-xl"
            style={{
              boxShadow:
                '0 0 0 1px rgba(255,255,255,0.05), 0 50px 120px -30px rgba(80,100,255,0.4), 0 0 80px -20px rgba(0,232,122,0.15)',
            }}
          >
            {/* Window header */}
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-cream">
                  LIVE
                </span>
                <span className="ml-2 text-sm font-semibold text-cream">
                  English Speaking · 5-sinf
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-cream-dim">
                <UserIcon /> 42
              </div>
            </div>

            {/* Main video area */}
            <div className="relative aspect-[16/9] bg-gradient-to-br from-blue-900/40 via-purple-900/30 to-ink-surface">
              {/* Decorative gradient orbs */}
              <div className="absolute left-[20%] top-[15%] h-32 w-32 rounded-full bg-blue-500/30 blur-3xl" />
              <div className="absolute right-[25%] bottom-[20%] h-40 w-40 rounded-full bg-purple-500/25 blur-3xl" />

              {/* Teacher avatar (placeholder) */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="relative">
                  <div className="absolute inset-0 -m-2 animate-pulse rounded-full bg-accent2-500/30 blur-md" />
                  <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-accent2-500 to-accent2-700 text-5xl font-extrabold text-ink shadow-2xl">
                    A
                  </div>
                </div>
                <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
                  Aziza · O&apos;qituvchi
                </p>
              </div>

              {/* Participant thumbnails (right side) */}
              <div className="absolute right-3 top-3 flex flex-col gap-2">
                {[
                  { name: 'Olim', color: 'from-pink-500 to-orange-500' },
                  { name: 'Diyora', color: 'from-blue-500 to-cyan-500' },
                  { name: 'Sardor', color: 'from-purple-500 to-pink-500' },
                  { name: 'Madina', color: 'from-emerald-500 to-blue-500' },
                ].map((p, i) => (
                  <motion.div
                    key={p.name}
                    initial={{ opacity: 0, x: 30 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      duration: 0.4,
                      delay: 0.4 + i * 0.1,
                    }}
                    className="relative h-14 w-20 overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br shadow-lg"
                  >
                    <div
                      className={`absolute inset-0 bg-gradient-to-br ${p.color}`}
                    />
                    <div className="absolute bottom-1 left-1.5 text-[9px] font-bold text-white/90">
                      {p.name}
                    </div>
                    {i === 0 && (
                      <div className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent2-500 shadow-[0_0_6px_rgba(0,232,122,0.8)]" />
                    )}
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Bottom controls */}
            <div className="flex items-center justify-between border-t border-white/[0.07] bg-ink/60 px-5 py-3">
              <div className="flex items-center gap-2">
                <ControlButton active>
                  <MicIcon />
                </ControlButton>
                <ControlButton active>
                  <VideoIcon />
                </ControlButton>
                <ControlButton>
                  <ScreenShareIcon />
                </ControlButton>
                <ControlButton>
                  <ChatIcon />
                </ControlButton>
              </div>

              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-cream-dim">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent2-500" />
                Recording
              </div>

              <button
                className="rounded-full bg-red-500 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-red-600"
                style={{ boxShadow: '0 4px 14px -2px rgba(239,68,68,0.5)' }}
              >
                Tugatish
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom feature pills */}
      <div className="relative mx-auto mt-12 max-w-4xl px-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <FeaturePill icon="📹">HLS yozish</FeaturePill>
          <FeaturePill icon="🎯">500+ ishtirokchi</FeaturePill>
          <FeaturePill icon="💬">Real-time chat</FeaturePill>
          <FeaturePill icon="🔔">Avtomatik xabarnoma</FeaturePill>
          <FeaturePill icon="📱">PC, mobil, planshet</FeaturePill>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────

function SideCard({
  icon,
  label,
  status,
  dot,
  className = '',
  delay = 0,
}: {
  icon: string;
  label: string;
  status: string;
  dot: string;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay }}
      className={className}
      style={{
        animation: `floaty ${5 + Math.random() * 3}s ease-in-out ${delay}s infinite`,
      }}
    >
      <div
        className="flex items-center gap-3 rounded-2xl border border-white/[0.1] bg-ink-surface/70 px-4 py-3 backdrop-blur-md"
        style={{
          boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 20px 50px -20px ${dot}66`,
        }}
      >
        <span className="text-2xl">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-cream">{label}</p>
          <p className="flex items-center gap-1.5 text-[10px] text-cream-dim">
            <span
              className="h-1 w-1 rounded-full"
              style={{ background: dot, boxShadow: `0 0 6px ${dot}` }}
            />
            {status}
          </p>
        </div>
      </div>
      <style jsx>{`
        @keyframes floaty {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-12px);
          }
        }
      `}</style>
    </motion.div>
  );
}

function ControlButton({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
        active
          ? 'bg-accent2-500/20 text-accent2-500 ring-1 ring-accent2-500/40'
          : 'bg-white/[0.04] text-cream-dim hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  );
}

function FeaturePill({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-medium text-cream-dim backdrop-blur-sm transition-all hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-cream">
      <span>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="m17 8 5-5" />
      <path d="M17 3h5v5" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
