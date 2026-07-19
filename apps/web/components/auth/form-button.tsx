'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface FormButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean | undefined;
  variant?: 'primary' | 'secondary' | 'ghost' | undefined;
  fullWidth?: boolean | undefined;
  leadingIcon?: ReactNode | undefined;
}

/**
 * FormButton — primary submit button with a built-in loading spinner.
 * Disabled while loading to prevent double-submission.
 *
 * Uses CSS transitions (active:scale, hover:bg) instead of framer-motion
 * because the form components are heavy enough already and we want a
 * predictable button that plays nicely with native form semantics.
 */
export function FormButton({
  children,
  loading = false,
  disabled,
  variant = 'primary',
  fullWidth = true,
  leadingIcon,
  className,
  ...props
}: FormButtonProps) {
  const isDisabled = disabled || loading;

  const variantClasses =
    variant === 'primary'
      ? 'bg-forest-800 text-pomelo-100 shadow-lg shadow-forest-800/15 hover:bg-forest-700'
      : variant === 'secondary'
        ? 'border border-forest-800/15 bg-white text-forest-800 hover:bg-pomelo-100'
        : 'text-forest-800 hover:bg-forest-800/5';

  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-bold transition-all duration-200',
        'hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0',
        fullWidth && 'w-full',
        variantClasses,
        className,
      )}
    >
      {loading ? (
        <Spinner />
      ) : leadingIcon ? (
        <span className="flex h-4 w-4 items-center justify-center">{leadingIcon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Yuklanmoqda"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
      />
    </svg>
  );
}
