'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Input / Textarea — Apple Liquid Glass light + dark
//
// Variants: state (default | error) · size (sm | md | lg)
// A11y: visible focus ring (focus-visible), aria-invalid wired to the
// error state, disabled styling. Tokens are theme-aware.
// ═════════════════════════════════════════════════════════════════

export const inputVariants = cva(
  'w-full rounded-2xl border bg-tint text-ink-strong placeholder-ink-faint outline-none transition-all focus:bg-canvas focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      state: {
        default: 'border-rim focus:border-blue/60 focus:ring-blue/10',
        error: 'border-red/60 focus:border-red focus:ring-red/10',
      },
      inputSize: {
        sm: 'px-3 py-2 text-sm',
        md: 'px-4 py-3 text-base',
        lg: 'px-5 py-3.5 text-base',
      },
    },
    defaultVariants: {
      state: 'default',
      inputSize: 'md',
    },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  error?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, state, inputSize, leftIcon, rightIcon, ...props }, ref) => {
    const resolvedState = error ? 'error' : (state ?? 'default');
    const classes = inputVariants({ state: resolvedState, inputSize });

    if (leftIcon || rightIcon) {
      return (
        <div className="relative">
          {leftIcon && (
            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            aria-invalid={error || undefined}
            className={cn(classes, leftIcon && 'pl-12', rightIcon && 'pr-12', className)}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint">
              {rightIcon}
            </div>
          )}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(classes, className)}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

// ═════════════════════════════════════════════════════════════════
// Textarea
// ═════════════════════════════════════════════════════════════════

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    Pick<VariantProps<typeof inputVariants>, 'inputSize'> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, inputSize, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(
          inputVariants({ state: error ? 'error' : 'default', inputSize }),
          'min-h-[96px] resize-y',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
