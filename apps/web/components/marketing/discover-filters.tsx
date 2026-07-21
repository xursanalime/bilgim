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
      className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-ink-surface/80 p-4 backdrop-blur-sm sm:flex-row sm:items-center"
    >
      {/* Search input */}
      <label className="relative flex-1">
        <span className="sr-only">Qidirish</span>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-dim">
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
          className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.04] py-2.5 pl-12 pr-4 text-sm text-cream placeholder-cream-dim/60 outline-none transition-colors focus:border-accent2-500/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-accent2-500/20"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink shadow-[0_0_0_1px_rgba(0,232,122,0.4),0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-all hover:bg-accent2-400 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? 'Yuklanmoqda...' : 'Qidirish'}
        </button>
        {initialQuery && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-cream-dim transition-colors hover:border-white/[0.15] hover:text-cream"
          >
            Tozalash
          </button>
        )}
      </div>
    </form>
  );
}
