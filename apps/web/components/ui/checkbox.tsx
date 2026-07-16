'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Check, Minus } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Checkbox — native <input type="checkbox"> (a11y-first) with a styled
// visual layer driven by `peer-checked` so it works controlled AND
// uncontrolled. Supports indeterminate. Keyboard: Space toggles
// natively; focus-visible ring on the visual box.
// ═════════════════════════════════════════════════════════════════

const boxVariants = cva(
  'pointer-events-none flex items-center justify-center rounded-md border border-rim bg-canvas text-white transition-colors peer-checked:border-blue peer-checked:bg-blue peer-focus-visible:ring-2 peer-focus-visible:ring-blue peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50 peer-checked:[&_.cb-check]:opacity-100',
  {
    variants: {
      size: {
        sm: 'h-4 w-4',
        md: 'h-5 w-5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>,
    VariantProps<typeof boxVariants> {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, size = 'md', indeterminate = false, ...props }, ref) => {
    const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
    return (
      <span className="relative inline-flex">
        <input
          ref={(node) => {
            if (node) node.indeterminate = indeterminate;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          type="checkbox"
          aria-checked={indeterminate ? 'mixed' : undefined}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span
          className={cn(
            boxVariants({ size }),
            indeterminate && 'border-blue bg-blue',
            className,
          )}
          aria-hidden="true"
        >
          {indeterminate ? (
            <Minus className={iconSize} strokeWidth={3} />
          ) : (
            <Check className={cn('cb-check opacity-0', iconSize)} strokeWidth={3} />
          )}
        </span>
      </span>
    );
  },
);
Checkbox.displayName = 'Checkbox';
