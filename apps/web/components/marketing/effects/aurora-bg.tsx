'use client';

/**
 * AuroraBg — yumshoq harakatlanuvchi gradient blob lar fon.
 *
 * Bir nechta katta blur qilingan gradient sharlar sekin harakatlanadi,
 * fonni dinamik va atmosferik qiladi. Hero va featured seksiyalar uchun.
 */
export function AuroraBg({
  className = '',
  variant = 'electric',
}: {
  className?: string;
  variant?: 'electric' | 'green' | 'mixed';
}) {
  const palette = {
    electric: {
      a: 'rgba(80, 80, 220, 0.35)',
      b: 'rgba(120, 60, 200, 0.28)',
      c: 'rgba(40, 100, 220, 0.25)',
    },
    green: {
      a: 'rgba(0, 232, 122, 0.25)',
      b: 'rgba(0, 180, 100, 0.18)',
      c: 'rgba(60, 220, 140, 0.15)',
    },
    mixed: {
      a: 'rgba(80, 80, 220, 0.3)',
      b: 'rgba(0, 232, 122, 0.18)',
      c: 'rgba(120, 60, 200, 0.22)',
    },
  }[variant];

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div
        className="absolute -left-32 top-0 h-[500px] w-[500px] rounded-full blur-3xl"
        style={{
          background: palette.a,
          animation: 'aurora-1 18s ease-in-out infinite',
        }}
      />
      <div
        className="absolute -right-32 top-1/4 h-[600px] w-[600px] rounded-full blur-3xl"
        style={{
          background: palette.b,
          animation: 'aurora-2 22s ease-in-out infinite',
        }}
      />
      <div
        className="absolute left-1/3 bottom-0 h-[400px] w-[400px] rounded-full blur-3xl"
        style={{
          background: palette.c,
          animation: 'aurora-3 16s ease-in-out infinite',
        }}
      />

      <style jsx>{`
        @keyframes aurora-1 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(80px, 60px) scale(1.1);
          }
          66% {
            transform: translate(-40px, 100px) scale(0.95);
          }
        }
        @keyframes aurora-2 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(-100px, 40px) scale(1.15);
          }
          66% {
            transform: translate(60px, -60px) scale(0.9);
          }
        }
        @keyframes aurora-3 {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(-80px, -80px) scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}
