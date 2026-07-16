'use client';

import type { HTMLAttributes } from 'react';

import { Skeleton } from '../ui/skeleton';

/**
 * Reusable loading state built on the low-level `Skeleton` primitive
 * (`components/ui/skeleton`). Covers the data-backed view shapes the
 * redesign uses (R20.3): list rows, cards, tables, and full pages.
 *
 * Accessibility: the wrapper is a polite live region (`role="status"`,
 * `aria-busy`) with an off-screen label so assistive tech announces the
 * loading state instead of reading decorative skeleton bars.
 */
export type LoadingStateVariant = 'list' | 'card' | 'table' | 'page';

export interface LoadingStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Visual shape to mimic while data loads. */
  variant?: LoadingStateVariant;
  /** How many repeated skeleton units to render (rows / cards). */
  count?: number;
  /** Off-screen text announced to assistive technology. */
  label?: string;
}

export function LoadingState({
  variant = 'list',
  count = 3,
  label = 'Loading…',
  className = '',
  ...rest
}: LoadingStateProps) {
  const items = Math.max(1, count);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`w-full ${className}`}
      {...rest}
    >
      <span className="sr-only">{label}</span>
      {variant === 'list' && <ListSkeleton count={items} />}
      {variant === 'card' && <CardSkeleton count={items} />}
      {variant === 'table' && <TableSkeleton rows={items} />}
      {variant === 'page' && <PageSkeleton />}
    </div>
  );
}

function ListSkeleton({ count }: { count: number }) {
  return (
    <ul className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-rim p-4"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-4 rounded-3xl border border-rim p-5">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-rim" aria-hidden="true">
      <div className="flex items-center gap-4 border-b border-rim bg-tint p-4">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/4" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-rim p-4 last:border-b-0">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-3xl" />
    </div>
  );
}
