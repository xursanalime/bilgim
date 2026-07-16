'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Card — surface container. Variants: default | glass | outline | elevated.
// Plus header/title/description/content/footer subcomponents and a StatCard.
// ═════════════════════════════════════════════════════════════════

export const cardVariants = cva('rounded-3xl text-ink-strong', {
  variants: {
    variant: {
      default: 'border border-rim bg-canvas shadow-soft',
      glass: 'liquid-glass',
      outline: 'border border-rim bg-transparent',
      elevated: 'border border-rim bg-canvas shadow-large',
    },
    padding: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    },
  },
  defaultVariants: { variant: 'default', padding: 'md' },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, padding }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 pb-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-lg font-bold tracking-tight text-ink-strong', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-ink-soft', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-ink-soft', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 pt-4', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

// ─────────────────────────────────────────────────────────────────
// StatCard — KPI tile (icon + label + value + optional delta).
// ─────────────────────────────────────────────────────────────────

export interface StatCardProps extends Omit<CardProps, 'title'> {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** Numeric delta, e.g. +12% or -3%. Positive renders green, negative red. */
  delta?: { value: ReactNode; direction: 'up' | 'down' | 'neutral' };
  accent?: 'blue' | 'green' | 'orange' | 'red' | 'purple';
}

const ACCENT_TINT: Record<NonNullable<StatCardProps['accent']>, string> = {
  blue: 'bg-blue-tint text-blue',
  green: 'bg-green-tint text-green',
  orange: 'bg-orange-tint text-orange',
  red: 'bg-red-tint text-red',
  purple: 'bg-purple-tint text-purple',
};

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, label, value, icon, delta, accent = 'blue', ...props }, ref) => (
    <Card ref={ref} className={cn('flex flex-col gap-3', className)} {...props}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink-soft">{label}</span>
        {icon && (
          <span
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl',
              ACCENT_TINT[accent],
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold tracking-tight text-ink-strong">{value}</span>
        {delta && (
          <span
            className={cn(
              'mb-1 text-xs font-semibold',
              delta.direction === 'up' && 'text-green',
              delta.direction === 'down' && 'text-red',
              delta.direction === 'neutral' && 'text-ink-soft',
            )}
          >
            {delta.value}
          </span>
        )}
      </div>
    </Card>
  ),
);
StatCard.displayName = 'StatCard';
