'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  leadingIcon?: ReactNode | undefined;
  trailingIcon?: ReactNode | undefined;
  /** Hide the visible label (still rendered for screen readers). */
  hideLabel?: boolean | undefined;
}

/**
 * FormInput — rounded-2xl input with label, optional leading icon and
 * accessible error message wired via `aria-describedby`.
 *
 * On error: red border + subtle horizontal shake (Framer Motion).
 */
export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  function FormInput(
    {
      label,
      error,
      hint,
      leadingIcon,
      trailingIcon,
      hideLabel = false,
      id,
      className,
      ...props
    },
    ref,
  ) {
    const generatedId = id ?? props.name ?? label.replace(/\s+/g, '-').toLowerCase();
    const errorId = `${generatedId}-error`;
    const hintId = `${generatedId}-hint`;
    const describedBy =
      [error ? errorId : null, hint ? hintId : null]
        .filter(Boolean)
        .join(' ') || undefined;

    return (
      <div className="w-full">
        <label
          htmlFor={generatedId}
          className={cn(
            'mb-1.5 block text-sm font-semibold text-forest-700',
            hideLabel && 'sr-only',
          )}
        >
          {label}
        </label>

        <motion.div
          animate={
            error
              ? { x: [-4, 4, -3, 3, -1, 1, 0] }
              : { x: 0 }
          }
          transition={{ duration: 0.35 }}
          className={cn(
            'relative flex items-center rounded-2xl border bg-white transition-shadow',
            'focus-within:ring-2',
            error
              ? 'border-red-500/70 focus-within:ring-red-500/15'
              : 'border-forest-800/15 focus-within:border-forest-800 focus-within:ring-forest-800/15',
          )}
        >
          {leadingIcon ? (
            <span className="pointer-events-none absolute left-4 flex h-5 w-5 items-center justify-center text-forest-700/60">
              {leadingIcon}
            </span>
          ) : null}

          <input
            ref={ref}
            id={generatedId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              'w-full rounded-2xl bg-transparent px-4 py-3 text-sm text-forest-900 placeholder:text-forest-700/40 focus:outline-none',
              leadingIcon && 'pl-11',
              trailingIcon && 'pr-11',
              className,
            )}
            {...props}
          />

          {trailingIcon ? (
            <span className="absolute right-2 flex items-center">{trailingIcon}</span>
          ) : null}
        </motion.div>

        <AnimatePresence initial={false}>
          {error ? (
            <motion.p
              key="error"
              id={errorId}
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="mt-1.5 text-xs font-medium text-red-600"
            >
              {error}
            </motion.p>
          ) : hint ? (
            <p id={hintId} className="mt-1.5 text-xs text-forest-700/60">
              {hint}
            </p>
          ) : null}
        </AnimatePresence>
      </div>
    );
  },
);
