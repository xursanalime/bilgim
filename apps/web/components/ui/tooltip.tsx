'use client';

import {
  cloneElement,
  useId,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Tooltip — lightweight, dependency-free, accessible tooltip.
// Shows on hover AND keyboard focus, hides on blur / Escape, and wires
// `aria-describedby` so screen readers announce the content. The
// tooltip text is non-interactive (role="tooltip").
//
// Usage:
//   <Tooltip content="Delete">
//     <button aria-label="Delete">...</button>
//   </Tooltip>
// ═════════════════════════════════════════════════════════════════

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  className?: string;
}

const SIDE_CLASSES: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
};

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  };

  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onKeyDown,
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-50 w-max max-w-xs rounded-lg bg-ink-strong px-2.5 py-1.5 text-xs font-medium text-white shadow-medium animate-in fade-in-0 zoom-in-95',
            SIDE_CLASSES[side],
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
