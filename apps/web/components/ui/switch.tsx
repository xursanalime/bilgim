'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, useState } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Switch — accessible toggle (role="switch", aria-checked).
// Operable with Space/Enter (native <button>). Controlled or
// uncontrolled-via-onCheckedChange. Motion gated globally.
// ═════════════════════════════════════════════════════════════════

const switchTrack = cva(
  'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'h-5 w-9',
        md: 'h-6 w-11',
      },
      checked: {
        true: 'bg-blue',
        false: 'bg-soft',
      },
    },
    defaultVariants: { size: 'md', checked: false },
  },
);

const switchThumb = cva(
  'pointer-events-none inline-block rounded-full bg-white shadow-sm ring-0 transition-transform',
  {
    variants: {
      size: {
        sm: 'h-4 w-4',
        md: 'h-5 w-5',
      },
      checked: { true: '', false: 'translate-x-0' },
    },
    compoundVariants: [
      { size: 'sm', checked: true, class: 'translate-x-4' },
      { size: 'md', checked: true, class: 'translate-x-5' },
    ],
    defaultVariants: { size: 'md', checked: false },
  },
);

export interface SwitchProps
  extends Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      'onChange' | 'type' | 'value'
    >,
    Pick<VariantProps<typeof switchTrack>, 'size'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    { className, checked, defaultChecked, onCheckedChange, size = 'md', disabled, ...props },
    ref,
  ) => {
    // Controlled if `checked` is provided; otherwise track internally.
    const isControlled = checked !== undefined;
    const [internal, setInternal] = useState<boolean>(defaultChecked ?? false);
    const value = isControlled ? checked : internal;

    const toggle = () => {
      if (disabled) return;
      const next = !value;
      if (!isControlled) setInternal(next);
      onCheckedChange?.(next);
    };

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={toggle}
        className={cn(switchTrack({ size, checked: value }), className)}
        {...props}
      >
        <span className={cn(switchThumb({ size, checked: value }), !value && 'ml-0.5')} />
      </button>
    );
  },
);
Switch.displayName = 'Switch';
