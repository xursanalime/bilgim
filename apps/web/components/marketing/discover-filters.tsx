'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface DiscoverFiltersProps {
  locale: string;
  initialQuery: string;
}

/**
 * Filter UI for the public teacher catalog (`/[locale]/discover`).
 *
 * The page is a Server Component that reads filters from `searchParams`,
 * so this client component's only job is to update the URL when the user
 * submits the form. The Server Component re-runs and the page re-renders
 * with the new results.
 *
 * EduBridge is English-only, so there is no subject/specialty filter — the
 * search is a simple name/headline query.
 */
export function DiscoverFilters({
  locale,
  initialQuery,
}: DiscoverFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);

  const submit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const params = new URLSearchParams();
    const trimmedQ = query.trim();
    if (trimmedQ.length >= 2) params.set('q', trimmedQ);
    const qs = params.toString();
    startTransition(() => {
      router.push(`/${locale}/discover${qs ? `?${qs}` : ''}`);
    });
  };

  const reset = () => {
    setQuery('');
    startTransition(() => {
      router.push(`/${locale}/discover`);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-rim bg-canvas p-4 shadow-soft sm:flex-row sm:items-center"
    >
      {/* Search input */}
      <label className="relative flex-1">
        <span className="sr-only">Qidirish</span>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ustoz ismi yoki sarlavhasi"
          aria-label="Qidirish"
          className="w-full rounded-2xl border border-rim bg-tint py-2.5 pl-12 pr-4 text-sm text-ink-strong placeholder-ink-faint outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_16px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? 'Yuklanmoqda...' : 'Qidirish'}
        </button>
        {initialQuery && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-blue/20 hover:text-blue"
          >
            Tozalash
          </button>
        )}
      </div>
    </form>
  );
}
