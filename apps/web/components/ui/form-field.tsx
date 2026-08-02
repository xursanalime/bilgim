'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

// ═════════════════════════════════════════════════════════════════
// Input — Aurora light theme (Apple Liquid Glass)
// ═════════════════════════════════════════════════════════════════

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, leftIcon, rightIcon, ...props }, ref) => {
    const baseStyle =
      'w-full rounded-2xl border bg-tint px-4 py-3 text-base text-ink-strong placeholder-ink-faint outline-none transition-all focus:bg-canvas focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50';
    const stateStyle = error
      ? 'border-red/60 focus:border-red focus:ring-red/10'
      : 'border-rim focus:border-blue/60 focus:ring-blue/10';

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
            className={`${baseStyle} ${stateStyle} ${
              leftIcon ? 'pl-12' : ''
            } ${rightIcon ? 'pr-12' : ''} ${className}`}
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
        className={`${baseStyle} ${stateStyle} ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

// ═════════════════════════════════════════════════════════════════
// Label
// ═════════════════════════════════════════════════════════════════

interface LabelProps {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
}

export function Label({ htmlFor, children, required }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-semibold text-ink-strong"
    >
      {children}
      {required && <span className="ml-1 text-blue">*</span>}
    </label>
  );
}

// ═════════════════════════════════════════════════════════════════
// FormField (Label + Input + Error)
// ═════════════════════════════════════════════════════════════════

interface FormFieldProps extends Omit<InputProps, 'id' | 'error'> {
  id: string;
  label: string;
  error?: string | undefined;
  required?: boolean | undefined;
  helperText?: string | undefined;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ id, label, error, required, helperText, ...inputProps }, ref) => {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} required={required ?? false}>
          {label}
        </Label>
        <Input id={id} ref={ref} error={!!error} {...inputProps} />
        {error ? (
          <p className="text-xs font-medium text-red">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-ink-soft">{helperText}</p>
        ) : null}
      </div>
    );
  },
);
FormField.displayName = 'FormField';
