'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Skeleton — low-level loading placeholder. Pulse is gated by the
// global prefers-reduced-motion rule. Variants: text | circle | rect.
// (Higher-level "loading state" components live in task 0.4.)
// ═════════════════════════════════════════════════════════════════

export const skeletonVariants = cva('animate-pulse bg-soft', {
  variants: {
    variant: {
      text: 'h-4 w-full rounded-md',
      circle: 'rounded-full',
      rect: 'rounded-2xl',
    },
  },
  defaultVariants: { variant: 'rect' },
});

export interface SkeletonProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {}

export function Skeleton({ className, variant, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(skeletonVariants({ variant }), className)}
      {...props}
    />
  );
}
