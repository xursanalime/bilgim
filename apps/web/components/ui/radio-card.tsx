'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// RadioCard — a selectable card backed by a native radio <input> for
// full keyboard + screen-reader support. Group several with the same
// `name`. The visible card reflects state via `peer-checked`.
// ═════════════════════════════════════════════════════════════════

export interface RadioCardProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}

export const RadioCard = forwardRef<HTMLInputElement, RadioCardProps>(
  ({ className, label, description, icon, id, disabled, ...props }, ref) => {
    return (
      <label
        htmlFor={id}
        className={cn(
          'relative block cursor-pointer',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <input
          ref={ref}
          id={id}
          type="radio"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <div
          className={cn(
            'flex items-start gap-3 rounded-2xl border border-rim bg-canvas p-4 transition-all',
            'hover:border-rim-2',
            'peer-checked:border-blue peer-checked:bg-blue-tint peer-checked:shadow-blue-soft',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-blue peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
            'peer-checked:[&_.radio-ring]:border-blue peer-checked:[&_.radio-dot]:opacity-100',
            className,
          )}
        >
          {icon && <span className="mt-0.5 shrink-0 text-blue">{icon}</span>}
          <span className="flex-1">
            <span className="block text-sm font-semibold text-ink-strong">{label}</span>
            {description && (
              <span className="mt-0.5 block text-xs text-ink-soft">{description}</span>
            )}
          </span>
          <span
            className="radio-ring mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-rim transition-colors"
            aria-hidden="true"
          >
            <span className="radio-dot h-2.5 w-2.5 rounded-full bg-blue opacity-0 transition-opacity" />
          </span>
        </div>
      </label>
    );
  },
);
RadioCard.displayName = 'RadioCard';
