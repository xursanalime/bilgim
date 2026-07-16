'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { Button } from '../ui/button';

/**
 * Empty-state with an optional primary call-to-action (R20.3 — every
 * data-backed view defines an empty state). Composes the `Button`
 * primitive for the CTA so the action inherits design-system styling,
 * focus rings, and reduced-motion behavior.
 */
export interface EmptyStateAction {
  /** Visible CTA label. */
  label: string;
  /** Handler invoked on click. */
  onClick?: () => void;
  /** Disable the CTA (e.g. while a prerequisite resolves). */
  disabled?: boolean;
}

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Decorative icon shown above the title. */
  icon?: ReactNode;
  /** Short headline describing why the view is empty. */
  title: ReactNode;
  /** Supporting copy guiding the user toward the next step. */
  description?: ReactNode;
  /** Primary call-to-action rendered as a `Button`. */
  action?: EmptyStateAction;
  /** Extra content rendered below the CTA (e.g. secondary links). */
  children?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  className = '',
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={`flex min-h-[260px] flex-col items-center justify-center rounded-3xl border border-dashed border-rim bg-canvas p-10 text-center ${className}`}
      {...rest}
    >
      {icon ? (
        <div className="mb-4 text-ink-soft" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-bold text-ink-strong">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-ink-soft">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-6">
          <Button
            type="button"
            variant="primary"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
