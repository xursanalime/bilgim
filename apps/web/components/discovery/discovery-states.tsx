import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState, ErrorState } from '../states';

/**
 * Discovery result-state wrappers (Req 15.2 — every data view keeps
 * loading/empty/error/success states).
 *
 * These compose the shared design-system primitives from
 * `components/states` (task 0.4 `EmptyState`/`ErrorState`) so the public
 * discovery surface stays visually consistent with the rest of the app.
 * The discovery pages are Server Components, so instead of the primitives'
 * `onClick`/`onRetry` callbacks (client-only) these wrappers render plain
 * `next/link` navigation for the reset/retry affordances.
 */

const SearchIcon = (
  <svg
    className="h-6 w-6"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function DiscoveryEmptyState({
  title = 'Hech narsa topilmadi',
  description,
  resetHref,
  resetLabel = 'Filtrlarni tozalash',
  icon = SearchIcon,
}: {
  title?: ReactNode;
  description?: ReactNode;
  resetHref?: string;
  resetLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} description={description}>
      {resetHref ? (
        <Link
          href={resetHref}
          className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-5 py-2.5 text-sm font-semibold text-blue transition-colors hover:bg-blue-tint"
        >
          {resetLabel}
        </Link>
      ) : null}
    </EmptyState>
  );
}

export function DiscoveryErrorState({
  title = 'Xatolik yuz berdi',
  message,
  retryHref,
  retryLabel = "Qayta urinib ko'rish",
}: {
  title?: ReactNode;
  message?: ReactNode;
  retryHref?: string;
  retryLabel?: string;
}) {
  return (
    <div className="space-y-4">
      <ErrorState title={title} message={message} />
      {retryHref ? (
        <div className="text-center">
          <Link
            href={retryHref}
            className="inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-5 py-2.5 text-sm font-semibold text-ink-strong transition-colors hover:bg-tint"
          >
            {retryLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
