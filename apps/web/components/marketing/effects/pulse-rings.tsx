'use client';

/**
 * PulseRings — Huly.io stilidagi konsentrik pulsatsiyali halqalar.
 *
 * Markazdan tashqariga doiraviy "audio wave" effekti tarqaladi.
 * Live efir, real-time chat va notification kabi seksiyalarda ishlatiladi.
 */
export function PulseRings({
  count = 4,
  color = 'rgba(0, 232, 122, 0.5)',
  duration = 4,
  size = 600,
}: {
  count?: number;
  color?: string;
  duration?: number;
  size?: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: size, height: size }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
          style={{
            width: '100%',
            height: '100%',
            borderColor: color,
            animation: `pulse-ring ${duration}s ease-out ${(i * duration) / count}s infinite`,
            opacity: 0,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes pulse-ring {
          0% {
            transform: translate(-50%, -50%) scale(0.3);
            opacity: 0;
            border-width: 2px;
          }
          20% {
            opacity: 0.8;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.2);
            opacity: 0;
            border-width: 1px;
          }
        }
      `}</style>
    </div>
  );
}
