'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  CEFR_LEVELS,
  EXAM_TRACKS,
  type CefrLevel,
} from '../discovery/facets';

export type SearchTab = 'teachers' | 'courses';

interface SearchControlsProps {
  locale: string;
  tab: SearchTab;
  initialQuery: string;
  /** Selected CEFR levels (multi-select, Req 15.2). */
  initialCefr: CefrLevel[];
  /** Selected Exam_Track slug (Req 15.2). */
  initialExamTrack?: string;
  initialFilters: {
    priceMin?: string;
    priceMax?: string;
  };
}

/**
 * Search controls for the public `/search` page (Req 15.2).
 *
 * The marketing route is a Server Component. This client island owns:
 *   - A debounced text input (350ms) — types into `?q=...`.
 *   - The tab switcher (Ustozlar | Kurslar) — flips `?tab=...`.
 *   - The **CEFR level** multi-select (A1–C2) — repeated `?cefrLevel=` params.
 *   - The **Exam_Track** select (e.g. IELTS) — `?examTrack=slug`.
 *   - Course-only min/max price band.
 *
 * English-only refocus: the legacy free-text "level" / specialty facets
 * are gone, replaced by CEFR + Exam_Track. Both facets apply to teachers
 * and courses; price applies to courses only. The Server Component
 * re-runs from the URL change, so this component never fetches data.
 */
export function SearchControls({
  locale,
  tab,
  initialQuery,
  initialCefr,
  initialExamTrack,
  initialFilters,
}: SearchControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [cefr, setCefr] = useState<CefrLevel[]>(initialCefr);
  const [examTrack, setExamTrack] = useState(initialExamTrack ?? '');
  const [priceMin, setPriceMin] = useState(initialFilters.priceMin ?? '');
  const [priceMax, setPriceMax] = useState(initialFilters.priceMax ?? '');

  // Debounce the search query so we don't re-render the server tree on
  // every keystroke.
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
      (override: {
        q?: string;
        tab?: SearchTab;
        cefr?: CefrLevel[];
        examTrack?: string;
        priceMin?: string;
        priceMax?: string;
      } = {}) => {
        const params = new URLSearchParams();
        const trimmedQ = (override.q ?? query).trim();
        const tabValue = override.tab ?? tab;
        const cefrValue = override.cefr ?? cefr;
        const trackValue = (override.examTrack ?? examTrack).trim();
        const pmin = (override.priceMin ?? priceMin).trim();
        const pmax = (override.priceMax ?? priceMax).trim();

        if (tabValue !== 'teachers') params.set('tab', tabValue);
        if (trimmedQ.length >= 2) params.set('q', trimmedQ);
        for (const level of cefrValue) params.append('cefrLevel', level);
        if (trackValue) params.set('examTrack', trackValue);
        if (tabValue === 'courses') {
          if (pmin) params.set('priceMin', pmin);
          if (pmax) params.set('priceMax', pmax);
        }
        const qs = params.toString();
        return `/${locale}/search${qs ? `?${qs}` : ''}`;
      },
    [locale, tab, query, cefr, examTrack, priceMin, priceMax],
  );

  const pushUrl = (
    override: Parameters<typeof buildHref>[0] = {},
  ) => {
    startTransition(() => {
      router.push(buildHref(override));
    });
  };

  const toggleCefr = (level: CefrLevel) => {
    const next = cefr.includes(level)
      ? cefr.filter((l) => l !== level)
      : [...cefr, level];
    setCefr(next);
    pushUrl({ cefr: next });
  };

  const handleExamTrack = (slug: string) => {
    setExamTrack(slug);
    pushUrl({ examTrack: slug });
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    pushUrl();
  };

  const handleReset = () => {
    setQuery('');
    setCefr([]);
    setExamTrack('');
    setPriceMin('');
    setPriceMax('');
    lastPushedRef.current = '';
    startTransition(() => {
      router.push(`/${locale}/search${tab === 'courses' ? '?tab=courses' : ''}`);
    });
  };

  const handleTabSwitch = (next: SearchTab) => {
    startTransition(() => {
      router.push(buildHref({ tab: next }));
    });
  };

  // Roving arrow-key navigation for the tablist composite widget (Req 6.1).
  // Tab enters the group once; Arrow keys move focus between tabs, Home/End
  // jump to the edges. Activation stays on Enter/Space (native button).
  const tablistRef = useRef<HTMLDivElement>(null);
  const handleTablistKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        [],
    );
    if (tabs.length === 0) return;
    const current = tabs.findIndex((t) => t === document.activeElement);
    let nextIndex = current;
    if (e.key === 'ArrowRight') nextIndex = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft')
      nextIndex = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    e.preventDefault();
    tabs[nextIndex]?.focus();
  };

  const hasActiveFilters =
    cefr.length > 0 || !!examTrack || !!priceMin || !!priceMax || !!query;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Tabs + search */}
      <form onSubmit={handleSubmit} className="flex-1 space-y-4">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Discovery tab"
          onKeyDown={handleTablistKeyDown}
          className="inline-flex rounded-2xl border border-rim bg-tint p-1 text-sm"
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
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
            <svg
              className="h-5 w-5"
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
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === 'teachers'
                ? 'Ustoz ismi yoki sarlavhasi (kamida 2 belgi)'
                : 'Kurs nomi yoki tavsifi (kamida 2 belgi)'
            }
            aria-label="Qidirish"
            className="w-full rounded-2xl border border-rim bg-canvas py-3 pl-12 pr-4 text-sm text-ink-strong placeholder-ink-faint outline-none transition-colors focus:border-blue/50 focus:ring-2 focus:ring-blue/15"
          />
          {pending && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
              Yangilanmoqda...
            </span>
          )}
        </label>
      </form>

      {/* Filter sidebar — CEFR level + Exam_Track for both tabs; price for
          courses only. */}
      <aside className="w-full shrink-0 rounded-3xl border border-rim bg-canvas p-5 shadow-sm lg:w-80">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
            Filtrlar
          </h2>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleReset}
              disabled={pending}
              className="text-xs font-semibold text-blue transition-colors hover:text-blue-700 disabled:opacity-60"
            >
              Tozalash
            </button>
          )}
        </div>

        <div className="mt-4 space-y-5">
          <FilterField label="Daraja (CEFR)">
            <div className="flex flex-wrap gap-1.5">
              {CEFR_LEVELS.map((level) => {
                const active = cefr.includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleCefr(level)}
                    disabled={pending}
                    className={
                      active
                        ? 'inline-flex items-center rounded-xl border border-blue bg-blue px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-60'
                        : 'inline-flex items-center rounded-xl border border-rim bg-tint px-3 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-blue/40 hover:text-blue disabled:opacity-60'
                    }
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </FilterField>

          <FilterField label="Imtihon yo'nalishi (Exam Track)">
            <select
              value={examTrack}
              onChange={(e) => handleExamTrack(e.target.value)}
              disabled={pending}
              className="w-full rounded-xl border border-rim bg-canvas px-3 py-2 text-xs font-semibold text-ink-strong outline-none focus:border-blue/50 focus:ring-2 focus:ring-blue/15 disabled:opacity-60"
            >
              <option value="">Barchasi</option>
              {EXAM_TRACKS.map((track) => (
                <option key={track.slug} value={track.slug}>
                  {track.label}
                </option>
              ))}
            </select>
          </FilterField>

          {tab === 'courses' && (
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
                  className="w-full rounded-xl border border-rim bg-canvas px-3 py-2 text-xs text-ink-strong placeholder-ink-faint outline-none focus:border-blue/50 focus:ring-2 focus:ring-blue/15"
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
                  className="w-full rounded-xl border border-rim bg-canvas px-3 py-2 text-xs text-ink-strong placeholder-ink-faint outline-none focus:border-blue/50 focus:ring-2 focus:ring-blue/15"
                />
              </FilterField>
            </div>
          )}

          <button
            type="button"
            onClick={() => pushUrl()}
            disabled={pending}
            className="inline-flex w-full items-center justify-center rounded-xl bg-blue px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            Qo&apos;llash
          </button>
        </div>
      </aside>
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
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={
        active
          ? 'inline-flex items-center justify-center rounded-xl bg-blue px-4 py-2 text-sm font-bold text-white'
          : 'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink-strong'
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
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
