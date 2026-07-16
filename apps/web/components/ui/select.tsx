'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Select — native <select> for maximum a11y (keyboard + screen reader),
// styled to match the design system. cva variants for state + size.
// ═════════════════════════════════════════════════════════════════

export const selectVariants = cva(
  'w-full appearance-none rounded-2xl border bg-tint pr-10 text-ink-strong outline-none transition-all focus:bg-canvas focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      state: {
        default: 'border-rim focus:border-blue/60 focus:ring-blue/10',
        error: 'border-red/60 focus:border-red focus:ring-red/10',
      },
      selectSize: {
        sm: 'py-2 pl-3 text-sm',
        md: 'py-3 pl-4 text-base',
        lg: 'py-3.5 pl-5 text-base',
      },
    },
    defaultVariants: {
      state: 'default',
      selectSize: 'md',
    },
  },
);

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>,
    VariantProps<typeof selectVariants> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, state, selectSize, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={error || undefined}
          className={cn(
            selectVariants({ state: error ? 'error' : (state ?? 'default'), selectSize }),
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          aria-hidden="true"
        />
      </div>
    );
  },
);
Select.displayName = 'Select';
