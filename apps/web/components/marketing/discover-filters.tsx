'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import {
  CEFR_LEVELS,
  EXAM_TRACKS,
  type CefrLevel,
} from '../discovery/facets';

interface DiscoverFiltersProps {
  locale: string;
  initialQuery: string;
  /** Selected CEFR levels (multi-select, Req 15.2). */
  initialCefr: CefrLevel[];
  /** Selected Exam_Track slug (Req 15.2). */
  initialExamTrack?: string;
}

/**
 * Filter UI for the public instructor catalog (`/[locale]/discover`).
 *
 * The page is a Server Component that reads filters from `searchParams`,
 * so this client component updates the URL when the user changes a facet.
 * English-only refocus: instructors are filterable by **CEFR level**
 * (matches `taughtCefrLevels`) and **Exam_Track** (matches
 * `examTrackFocus`) plus a name/headline query (Req 15.2).
 */
export function DiscoverFilters({
  locale,
  initialQuery,
  initialCefr,
  initialExamTrack,
}: DiscoverFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [cefr, setCefr] = useState<CefrLevel[]>(initialCefr);
  const [examTrack, setExamTrack] = useState(initialExamTrack ?? '');

  const pushUrl = (next: {
    q?: string;
    cefr?: CefrLevel[];
    examTrack?: string;
  }) => {
    const params = new URLSearchParams();
    const trimmedQ = (next.q ?? query).trim();
    const cefrValue = next.cefr ?? cefr;
    const trackValue = (next.examTrack ?? examTrack).trim();
    if (trimmedQ.length >= 2) params.set('q', trimmedQ);
    for (const level of cefrValue) params.append('cefrLevel', level);
    if (trackValue) params.set('examTrack', trackValue);
    const qs = params.toString();
    startTransition(() => {
      router.push(`/${locale}/discover${qs ? `?${qs}` : ''}`);
    });
  };

  const submit = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    pushUrl({});
  };

  const toggleCefr = (level: CefrLevel) => {
    const nextCefr = cefr.includes(level)
      ? cefr.filter((l) => l !== level)
      : [...cefr, level];
    setCefr(nextCefr);
    pushUrl({ cefr: nextCefr });
  };

  const reset = () => {
    setQuery('');
    setCefr([]);
    setExamTrack('');
    startTransition(() => {
      router.push(`/${locale}/discover`);
    });
  };

  const hasFilters = !!query || cefr.length > 0 || !!examTrack;

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-3xl border border-rim bg-canvas p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            placeholder="Ustoz ismi yoki sarlavhasi"
            aria-label="Qidirish"
            className="w-full rounded-2xl border border-rim bg-canvas py-2.5 pl-12 pr-4 text-sm text-ink-strong placeholder-ink-faint outline-none transition-colors focus:border-blue/50 focus:ring-2 focus:ring-blue/15"
          />
        </label>

        <select
          value={examTrack}
          onChange={(e) => {
            setExamTrack(e.target.value);
            pushUrl({ examTrack: e.target.value });
          }}
          disabled={pending}
          aria-label="Imtihon yo'nalishi"
          className="rounded-2xl border border-rim bg-canvas px-4 py-2.5 text-sm font-semibold text-ink-strong outline-none focus:border-blue/50 focus:ring-2 focus:ring-blue/15 disabled:opacity-60"
        >
          <option value="">Barcha yo&apos;nalishlar</option>
          {EXAM_TRACKS.map((track) => (
            <option key={track.slug} value={track.slug}>
              {track.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? 'Yuklanmoqda...' : 'Qidirish'}
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-2xl border border-rim bg-tint px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:text-ink-strong"
            >
              Tozalash
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          CEFR:
        </span>
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
    </form>
  );
}
