'use client';

import { forwardRef, type ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Input, type InputProps } from './input';

// Re-export Input/Textarea so existing `../ui/form-field` consumers keep working.
export { Input, Textarea } from './input';
export type { InputProps, TextareaProps } from './input';

// ═════════════════════════════════════════════════════════════════
// Label
// ═════════════════════════════════════════════════════════════════

interface LabelProps {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}

export function Label({ htmlFor, children, required, className }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-sm font-semibold text-ink-strong', className)}
    >
      {children}
      {required && (
        <span className="ml-1 text-blue" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

// ═════════════════════════════════════════════════════════════════
// FormField (Label + Input + Error / helper text)
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
    const describedById = error
      ? `${id}-error`
      : helperText
        ? `${id}-helper`
        : undefined;

    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} required={required ?? false}>
          {label}
        </Label>
        <Input
          id={id}
          ref={ref}
          error={!!error}
          aria-describedby={describedById}
          {...inputProps}
        />
        {error ? (
          <p id={`${id}-error`} className="text-xs font-medium text-red-strong">
            {error}
          </p>
        ) : helperText ? (
          <p id={`${id}-helper`} className="text-xs text-ink-soft">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);
FormField.displayName = 'FormField';
