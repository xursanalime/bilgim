'use client';

/**
 * AuroraBackdrop — light, airy ambient mesh.
 * Aurora Dawn palette: sky + lavender + mint.
 */
export function AuroraBackdrop({
  variant = 'hero',
  className = '',
}: {
  variant?: 'hero' | 'subtle' | 'warm' | 'cool';
  className?: string;
}) {
  const palette = {
    hero: {
      a: 'rgba(91, 168, 255, 0.28)', // sky
      b: 'rgba(196, 181, 253, 0.22)', // lavender
      c: 'rgba(134, 239, 172, 0.18)', // mint
    },
    subtle: {
      a: 'rgba(91, 168, 255, 0.12)',
      b: 'rgba(196, 181, 253, 0.10)',
      c: 'rgba(134, 239, 172, 0.10)',
    },
    warm: {
      a: 'rgba(252, 211, 77, 0.18)', // gold
      b: 'rgba(253, 164, 175, 0.18)', // peach
      c: 'rgba(196, 181, 253, 0.14)', // lavender
    },
    cool: {
      a: 'rgba(91, 168, 255, 0.25)',
      b: 'rgba(196, 181, 253, 0.20)',
      c: 'rgba(134, 239, 172, 0.18)',
    },
  }[variant];

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div
        className="absolute -left-[15%] -top-[10%] h-[60vh] w-[55vw] rounded-full blur-[120px]"
        style={{
          background: palette.a,
          animation: 'aurora-orb-a 22s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        }}
      />
      <div
        className="absolute -right-[10%] top-[5%] h-[55vh] w-[50vw] rounded-full blur-[120px]"
        style={{
          background: palette.b,
          animation: 'aurora-orb-b 26s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        }}
      />
      <div
        className="absolute bottom-[-15%] left-1/3 h-[50vh] w-[55vw] rounded-full blur-[120px]"
        style={{
          background: palette.c,
          animation: 'aurora-orb-c 30s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        }}
      />

      {/* Soft noise */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.04] mix-blend-overlay"
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="noiseFilter">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>

      <style jsx>{`
        @keyframes aurora-orb-a {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(8%, 6%) scale(1.08);
          }
          66% {
            transform: translate(-4%, 10%) scale(0.94);
          }
        }
        @keyframes aurora-orb-b {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(-10%, 4%) scale(1.12);
          }
          66% {
            transform: translate(6%, -6%) scale(0.9);
          }
        }
        @keyframes aurora-orb-c {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(-8%, -8%) scale(1.15);
          }
        }
      `}</style>
    </div>
  );
}
