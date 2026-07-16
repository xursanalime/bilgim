'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// ProgressBar — determinate linear progress (role="progressbar" with
// aria-valuenow/min/max). Indeterminate mode for unknown durations.
// ═════════════════════════════════════════════════════════════════

const trackVariants = cva('relative w-full overflow-hidden rounded-full bg-soft', {
  variants: {
    size: { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' },
  },
  defaultVariants: { size: 'md' },
});

const barColor = cva('h-full rounded-full transition-[width] duration-300 ease-out', {
  variants: {
    color: {
      blue: 'bg-blue',
      green: 'bg-green',
      orange: 'bg-orange',
      red: 'bg-red',
      purple: 'bg-purple',
    },
  },
  defaultVariants: { color: 'blue' },
});

export interface ProgressBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'color'>,
    VariantProps<typeof trackVariants>,
    VariantProps<typeof barColor> {
  /** 0–100. Omit (or pass null) for indeterminate. */
  value?: number | null;
  label?: string;
}

export function ProgressBar({
  className,
  value,
  size,
  color,
  label,
  ...props
}: ProgressBarProps) {
  const indeterminate = value == null;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-label={label}
      className={cn(trackVariants({ size }), className)}
      {...props}
    >
      {indeterminate ? (
        <div className={cn(barColor({ color }), 'absolute inset-y-0 w-2/5 animate-marquee')} />
      ) : (
        <div className={cn(barColor({ color }))} style={{ width: `${clamped}%` }} />
      )}
    </div>
  );
}
