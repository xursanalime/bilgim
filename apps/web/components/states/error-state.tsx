'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { Button } from '../ui/button';

/**
 * Error state with a retry affordance (R20.3 / R20.4 — surface
 * actionable errors, no silent failures). Composes the `Button`
 * primitive for the retry action.
 *
 * Accessibility: rendered as `role="alert"` so assistive technology
 * announces the failure as soon as it appears.
 */
export interface ErrorStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Decorative icon shown above the title. */
  icon?: ReactNode;
  /** Short headline describing the failure. */
  title?: ReactNode;
  /** Human-readable error message (already mapped to localized copy). */
  message?: ReactNode;
  /** Label for the retry button. */
  retryLabel?: string;
  /** Invoked when the user presses retry. When omitted, no button renders. */
  onRetry?: () => void;
}

export function ErrorState({
  icon,
  title = 'Something went wrong',
  message,
  retryLabel = 'Try again',
  onRetry,
  className = '',
  ...rest
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex min-h-[260px] flex-col items-center justify-center rounded-3xl border border-red/30 bg-red/5 p-10 text-center ${className}`}
      {...rest}
    >
      {icon ? (
        <div className="mb-4 text-red" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-bold text-ink-strong">{title}</h3>
      {message ? (
        <p className="mt-2 max-w-md text-sm text-ink-soft">{message}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-6">
          <Button type="button" variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
