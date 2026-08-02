'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

import type { Course } from '../../lib/api/catalog';
import { cn } from '../../lib/utils';
import { CourseGrid } from './course-grid';

type StatusFilter = 'all' | 'published' | 'draft';

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Barchasi',
  published: 'Nashrda',
  draft: 'Qoralama',
};

interface CourseBrowserProps {
  courses: Course[];
  locale: string;
}

/**
 * Search + status filter over the teacher's course list.
 *
 * The page previously rendered a search input and a filter button that were
 * pure decoration — the page is a server component, so neither had any state
 * or handler behind it. Typing did nothing and the funnel icon did nothing.
 *
 * Filtering happens client-side over the already-loaded list: the catalogue is
 * capped at 100 courses server-side, so there is nothing to gain from a
 * round trip per keystroke.
 */
export function CourseBrowser({ courses, locale }: CourseBrowserProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const counts = useMemo(
    () => ({
      all: courses.length,
      published: courses.filter((c) => c.isPublished).length,
      draft: courses.filter((c) => !c.isPublished).length,
    }),
    [courses],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (status === 'published' && !c.isPublished) return false;
      if (status === 'draft' && c.isPublished) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [courses, query, status]);

  const isFiltering = query.trim().length > 0 || status !== 'all';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-[280px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kurslarni qidirish…"
            aria-label="Kurslarni qidirish"
            className="w-full rounded-2xl border border-rim bg-white px-11 py-2.5 text-sm outline-none transition-all focus:border-blue/40 focus:ring-4 focus:ring-blue/5"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Qidiruvni tozalash"
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-tint hover:text-ink-strong"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all',
                status === key
                  ? 'bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]'
                  : 'border border-rim text-ink-soft hover:border-blue/20 hover:text-blue',
              )}
            >
              {STATUS_LABELS[key]}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-black tabular-nums',
                  status === key
                    ? 'bg-white/20 text-white'
                    : 'bg-tint text-ink-faint',
                )}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {isFiltering && filtered.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[2rem] border border-rim bg-canvas p-12 text-center shadow-soft">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-tint text-blue">
            <Search className="h-6 w-6" />
          </span>
          <h3 className="mt-5 font-display text-lg font-bold tracking-tight text-ink-strong">
            Hech narsa topilmadi
          </h3>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
            Boshqa so&apos;z bilan qidirib ko&apos;ring yoki filtrni o&apos;zgartiring.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setStatus('all');
            }}
            className="mt-6 rounded-2xl border border-rim px-5 py-2 text-xs font-bold text-ink-soft transition-all hover:border-blue/30 hover:text-blue"
          >
            Filtrni tozalash
          </button>
        </div>
      ) : (
        <CourseGrid courses={filtered} locale={locale} />
      )}
    </div>
  );
}
