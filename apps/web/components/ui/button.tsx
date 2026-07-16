'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Button — Bilgim Design System v2.0 (Apple Liquid Glass)
//
// Variants:  primary | secondary | outline | ghost | danger
// Sizes:     sm | md | lg | icon
//
// A11y: native <button>, visible focus-visible ring, aria-busy while
// loading, disabled is announced. Motion (active:scale) is gated by
// the global prefers-reduced-motion rule in globals.css.
// ═════════════════════════════════════════════════════════════════

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
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
      },
      size: {
        sm: 'px-4 py-2 text-sm',
        md: 'px-5 py-2.5 text-sm',
        lg: 'px-7 py-3.5 text-base',
        icon: 'h-10 w-10 p-0',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'fullWidth'> {
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  /** Render as the child element (e.g. a Next.js <Link>) via Radix Slot. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isButton = !asChild;

    return (
      <Comp
        ref={ref}
        {...(isButton ? { disabled: disabled || loading, 'aria-busy': loading } : {})}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        {...props}
      >
        {loading && isButton ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
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
      </Comp>
    );
  },
);
Button.displayName = 'Button';
