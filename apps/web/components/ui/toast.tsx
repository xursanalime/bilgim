'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Toast — thin wrapper over `sonner`. Mount <Toaster /> once near the
// app root, then call `toast(...)`, `toast.success(...)`, etc. Styled
// to the design system; theme-aware via the `theme` prop.
// ═════════════════════════════════════════════════════════════════

export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export function Toaster({ className, toastOptions, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      position="top-right"
      className={cn('toaster group', className)}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast:
            'group rounded-2xl border border-rim bg-canvas text-ink-strong shadow-large',
          title: 'font-semibold text-ink-strong',
          description: 'text-ink-soft',
          actionButton: 'rounded-lg bg-blue text-white',
          cancelButton: 'rounded-lg bg-tint text-ink-soft',
          error: 'border-red/30',
          success: 'border-green/30',
          warning: 'border-orange/30',
          info: 'border-blue/30',
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}

export { toast };
