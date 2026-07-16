'use client';

import { Check } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// Stepper — multi-step progress indicator (e.g. onboarding, wizards).
// Renders an ordered list with the current step marked via
// aria-current="step". Horizontal (default) or vertical orientation.
// ═════════════════════════════════════════════════════════════════

export interface Step {
  label: ReactNode;
  description?: ReactNode;
}

export interface StepperProps extends HTMLAttributes<HTMLOListElement> {
  steps: Step[];
  /** Zero-based index of the active step. */
  current: number;
  orientation?: 'horizontal' | 'vertical';
}

export function Stepper({
  steps,
  current,
  orientation = 'horizontal',
  className,
  ...props
}: StepperProps) {
  const isVertical = orientation === 'vertical';
  return (
    <ol
      className={cn(
        'flex',
        isVertical ? 'flex-col gap-4' : 'items-center gap-2',
        className,
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const completed = index < current;
        const active = index === current;
        const isLast = index === steps.length - 1;
        return (
          <li
            key={index}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex',
              isVertical ? 'items-start gap-3' : 'flex-1 items-center gap-3',
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors',
                completed && 'border-blue bg-blue text-white',
                active && 'border-blue bg-blue-tint text-blue',
                !completed && !active && 'border-rim bg-canvas text-ink-faint',
              )}
            >
              {completed ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{index + 1}</span>
              )}
            </span>
            <span className={cn('flex flex-col', !isVertical && 'min-w-0')}>
              <span
                className={cn(
                  'text-sm font-semibold',
                  active || completed ? 'text-ink-strong' : 'text-ink-soft',
                )}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="text-xs text-ink-soft">{step.description}</span>
              )}
            </span>
            {!isLast && !isVertical && (
              <span
                className={cn(
                  'h-0.5 flex-1 rounded-full transition-colors',
                  completed ? 'bg-blue' : 'bg-soft',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
