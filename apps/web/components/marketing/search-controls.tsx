'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';

export type SearchTab = 'teachers' | 'courses';

interface SearchControlsProps {
  locale: string;
  tab: SearchTab;
  initialQuery: string;
  initialFilters: {
    level?: string;
    priceMin?: string;
    priceMax?: string;
  };
}

/**
 * Search controls for the public `/search` page (Task 25.5).
 *
 * The marketing route is rendered by a Server Component. This client
 * island owns:
 *   - A debounced text input (350ms) — types into `?q=...` so SSR runs
 *     once user stops typing.
 *   - The tab switcher (Teachers | Courses) — flips `?tab=...`.
 *   - The filter sidebar (level, min/max price) — only applied to
 *     courses. EduBridge is English-only, so there is no subject filter.
 *   - "Filtrlarni tozalash" CTA wired to the empty-state reset link.
 *
 * Why client-only: filters need to update the URL on user input. The
 * Server Component re-runs from the URL change, so this component never
 * fetches data itself.
 */
export function SearchControls({
  locale,
  tab,
  initialQuery,
  initialFilters,
}: SearchControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [level, setLevel] = useState(initialFilters.level ?? '');
  const [priceMin, setPriceMin] = useState(initialFilters.priceMin ?? '');
  const [priceMax, setPriceMax] = useState(initialFilters.priceMax ?? '');

  // Debounce the search query so we don't re-render the server tree on
  // every keystroke. We push the URL update through a transition to keep
  // the input responsive while React streams the new SSR payload.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef(initialQuery);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (query.trim() === lastPushedRef.current.trim()) return;
      lastPushedRef.current = query;
      pushUrl({ q: query });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const buildHref = useMemo(
    () =>
      (override: Record<string, string | undefined> = {}) => {
        const params = new URLSearchParams();
        const trimmedQ = (override.q ?? query).trim();
        const tabValue = (override.tab as SearchTab | undefined) ?? tab;
        const lvl = (override.level ?? level).trim();
        const pmin = (override.priceMin ?? priceMin).trim();
        const pmax = (override.priceMax ?? priceMax).trim();

        if (tabValue !== 'teachers') params.set('tab', tabValue);
        if (trimmedQ.length >= 2) params.set('q', trimmedQ);
        if (tabValue === 'courses') {
          if (lvl) params.set('level', lvl);
          if (pmin) params.set('priceMin', pmin);
          if (pmax) params.set('priceMax', pmax);
        }
        const qs = params.toString();
        return `/${locale}/search${qs ? `?${qs}` : ''}`;
      },
    [locale, tab, query, level, priceMin, priceMax],
  );

  const pushUrl = (override: Record<string, string | undefined> = {}) => {
    startTransition(() => {
      router.push(buildHref(override));
    });
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    pushUrl();
  };

  const handleReset = () => {
    setQuery('');
    setLevel('');
    setPriceMin('');
    setPriceMax('');
    startTransition(() => {
      router.push(`/${locale}/search`);
    });
  };

  const handleTabSwitch = (next: SearchTab) => {
    startTransition(() => {
      router.push(buildHref({ tab: next }));
    });
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Tabs + search */}
      <form onSubmit={handleSubmit} className="flex-1 space-y-4">
        <div
          role="tablist"
          aria-label="Discovery tab"
          className="inline-flex rounded-2xl border border-white/[0.07] bg-ink-surface p-1 text-sm"
        >
          <TabButton
            active={tab === 'teachers'}
            onClick={() => handleTabSwitch('teachers')}
          >
            Ustozlar
          </TabButton>
          <TabButton
            active={tab === 'courses'}
            onClick={() => handleTabSwitch('courses')}
          >
            Kurslar
          </TabButton>
        </div>

        <label className="relative block">
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
            placeholder={
              tab === 'teachers'
                ? "Ustoz ismi yoki sarlavhasi (kamida 2 belgi)"
                : 'Kurs nomi yoki tavsifi (kamida 2 belgi)'
            }
            aria-label="Qidirish"
            className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.04] py-3 pl-12 pr-4 text-sm text-cream placeholder-cream-dim/60 outline-none transition-colors focus:border-accent2-500/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-accent2-500/20"
          />
          {pending && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-cream-dim/70">
              Yangilanmoqda...
            </span>
          )}
        </label>
      </form>

      {/* Filter sidebar — only courses have filters (level / price).
          EduBridge is English-only, so there is no subject filter. */}
      {tab === 'courses' && (
        <aside className="w-full shrink-0 rounded-2xl border border-white/[0.07] bg-ink-surface/80 p-5 backdrop-blur-sm lg:w-80">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-cream-dim">
            Filtrlar
          </h2>
          <div className="mt-4 space-y-4">
            <FilterField label="Daraja (level)">
              <input
                type="text"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                onBlur={() => pushUrl()}
                placeholder="A1 / B2 / C1..."
                className="w-full rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-xs text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:ring-2 focus:ring-accent2-500/20"
              />
            </FilterField>
            <div className="grid grid-cols-2 gap-3">
              <FilterField label="Min narx (UZS)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  onBlur={() => pushUrl()}
                  placeholder="0"
                  className="w-full rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-xs text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:ring-2 focus:ring-accent2-500/20"
                />
              </FilterField>
              <FilterField label="Max narx (UZS)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  onBlur={() => pushUrl()}
                  placeholder="999000"
                  className="w-full rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-xs text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:ring-2 focus:ring-accent2-500/20"
                />
              </FilterField>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => pushUrl()}
                disabled={pending}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-accent2-500 px-4 py-2 text-xs font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-colors hover:bg-accent2-400 disabled:opacity-60"
              >
                Qo&apos;llash
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={pending}
                className="inline-flex items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-cream-dim transition-colors hover:border-white/[0.15] hover:text-cream"
              >
                Tozalash
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'inline-flex items-center justify-center rounded-xl bg-accent2-500 px-4 py-2 text-sm font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)]'
          : 'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-cream-dim transition-colors hover:text-cream'
      }
    >
      {children}
    </button>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
        {label}
      </span>
      {children}
    </label>
  );
}
