'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<Variant, string> = {
  primary:
    'bg-blue text-white shadow-[0_0_0_1px_rgba(0,113,227,0.4),0_8px_24px_-8px_rgba(0,113,227,0.5)] hover:bg-blue-600 hover:shadow-[0_0_0_1px_rgba(0,113,227,0.6),0_12px_32px_-8px_rgba(0,113,227,0.7)] active:scale-[0.98] disabled:opacity-60',
  secondary:
    'border border-rim bg-canvas text-ink-strong hover:border-rim-2 hover:bg-tint active:scale-[0.98] disabled:opacity-50',
  outline:
    'border border-blue/40 bg-transparent text-blue hover:border-blue/70 hover:bg-blue-tint active:scale-[0.98] disabled:opacity-50',
  ghost:
    'text-ink-soft hover:bg-black/[0.04] hover:text-ink-strong disabled:opacity-50',
  danger:
    'bg-red text-white shadow-md shadow-red/30 hover:opacity-90 active:scale-[0.98] disabled:opacity-50',
};

const SIZE_STYLES: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-all duration-200 disabled:cursor-not-allowed ${
          VARIANT_STYLES[variant]
        } ${SIZE_STYLES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <span>Iltimos kuting...</span>
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';
