'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Badge — compact label. Variants map to the brand/semantic palette.
// StatusPill adds a leading dot for live/status indication.
// ═════════════════════════════════════════════════════════════════

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
  {
    variants: {
      variant: {
        neutral: 'bg-soft text-ink-soft',
        blue: 'bg-blue-tint text-blue',
        green: 'bg-green-tint text-green',
        orange: 'bg-orange-tint text-orange',
        red: 'bg-red-tint text-red',
        purple: 'bg-purple-tint text-purple',
        outline: 'border border-rim text-ink-soft',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

// ─────────────────────────────────────────────────────────────────
// StatusPill — Badge with a status dot. `pulse` for live indicators.
// ─────────────────────────────────────────────────────────────────

const DOT_COLOR: Record<NonNullable<BadgeProps['variant']>, string> = {
  neutral: 'bg-ink-faint',
  blue: 'bg-blue',
  green: 'bg-green',
  orange: 'bg-orange',
  red: 'bg-red',
  purple: 'bg-purple',
  outline: 'bg-ink-faint',
};

export interface StatusPillProps extends BadgeProps {
  pulse?: boolean;
}

export function StatusPill({
  className,
  variant = 'neutral',
  size,
  pulse = false,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {pulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              DOT_COLOR[variant ?? 'neutral'],
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            DOT_COLOR[variant ?? 'neutral'],
          )}
        />
      </span>
      {children}
    </span>
  );
}
