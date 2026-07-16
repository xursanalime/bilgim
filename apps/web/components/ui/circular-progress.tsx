'use client';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// CircularProgress — SVG ring progress indicator (role="progressbar").
// Used for inline upload progress (see messages/message-thread).
// `progress` is 0–100. Determinate; pass no progress for a spinner.
// ═════════════════════════════════════════════════════════════════

export interface CircularProgressProps {
  /** 0–100. */
  progress?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  color?: string;
  label?: string;
}

export function CircularProgress({
  progress = 0,
  size = 40,
  strokeWidth = 4,
  className,
  color = 'rgb(var(--blue))',
  label,
}: CircularProgressProps) {
  const clamped = Math.min(100, Math.max(0, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('-rotate-90', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label ?? 'Yuklanmoqda'}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgb(255 255 255 / 0.25)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
}
