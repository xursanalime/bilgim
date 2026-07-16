'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// EmptyState — low-level presentational primitive (icon + title +
// description + optional action slot). The higher-level
// "empty-with-CTA / error-with-retry" state components (task 0.4)
// compose THIS primitive; keep it dumb and unopinionated.
// ═════════════════════════════════════════════════════════════════

export const emptyStateVariants = cva(
  'flex flex-col items-center justify-center text-center',
  {
    variants: {
      size: {
        sm: 'gap-2 py-8',
        md: 'gap-3 py-12',
        lg: 'gap-4 py-20',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof emptyStateVariants> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Action slot (e.g. a Button). Rendered below the description. */
  action?: ReactNode;
}

export function EmptyState({
  className,
  size,
  icon,
  title,
  description,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ size }), className)} {...props}>
      {icon && (
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-ink-faint"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-ink-strong">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-ink-soft">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
