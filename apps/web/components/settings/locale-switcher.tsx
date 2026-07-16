'use client';

import { useRef, useTransition, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Languages, Check } from 'lucide-react';
import {
  supportedLocales,
  defaultLocale,
  type Locale,
} from '@bilgim/i18n';
import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// LocaleSwitcher — persistent interface-language switch (Req 21.2).
//
// Switching does two things:
//  1. Rewrites the `[locale]` route segment so the current page is
//     re-rendered with the chosen Locale's messages.
//  2. Persists the choice in the `NEXT_LOCALE` cookie — the convention
//     next-intl's middleware reads on subsequent visits — so the
//     preference survives navigation and full reloads.
//
// `localePrefix: 'as-needed'` (see middleware.ts) means the default
// Locale (uz) is served without a prefix, so we only prepend a prefix
// for non-default locales.
// ═════════════════════════════════════════════════════════════════

/** One year — long-lived so the language choice sticks across sessions. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Native endonym shown for each Locale (always in its own language). */
const LOCALE_LABELS: Record<Locale, string> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

/** Strip a leading supported-locale segment from a pathname, if present. */
function pathWithoutLocale(pathname: string): string {
  const segments = pathname.split('/');
  // segments[0] is '' (leading slash); segments[1] may be a locale.
  if (segments[1] && supportedLocales.includes(segments[1] as Locale)) {
    segments.splice(1, 1);
  }
  const rest = segments.join('/');
  return rest === '' ? '/' : rest;
}

/** Build the target path for `next`, honoring `localePrefix: 'as-needed'`. */
function buildLocalizedPath(pathname: string, next: Locale): string {
  const base = pathWithoutLocale(pathname);
  if (next === defaultLocale) return base;
  return base === '/' ? `/${next}` : `/${next}${base}`;
}

export function LocaleSwitcher() {
  const t = useTranslations('locale_switcher');
  const activeLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const groupRef = useRef<HTMLDivElement>(null);

  // Roving arrow-key navigation for the radiogroup composite widget (Req 6.1).
  // Tab enters the group once (only the checked radio is tabbable); Arrow keys
  // move focus between options and Home/End jump to the edges. Activation stays
  // on Enter/Space (native button → handleSelect).
  function handleGroupKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
        e.key,
      )
    ) {
      return;
    }
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ??
        [],
    );
    if (radios.length === 0) return;
    const current = radios.findIndex((r) => r === document.activeElement);
    let nextIndex = current < 0 ? 0 : current;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      nextIndex = (nextIndex + 1) % radios.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      nextIndex = (nextIndex - 1 + radios.length) % radios.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = radios.length - 1;
    e.preventDefault();
    radios[nextIndex]?.focus();
  }

  function handleSelect(next: Locale) {
    if (next === activeLocale) return;
    // Persist using next-intl's cookie convention so the middleware
    // honors the choice on future requests.
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
    startTransition(() => {
      router.replace(buildLocalizedPath(pathname, next));
      router.refresh();
    });
  }

  return (
    <fieldset
      className="rounded-2xl border border-rim bg-white p-5"
      disabled={isPending}
      aria-busy={isPending}
    >
      <legend className="sr-only">{t('label')}</legend>
      <div className="mb-3 flex items-center gap-2">
        <Languages className="h-4.5 w-4.5 text-blue" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-ink-strong">{t('label')}</p>
          <p className="text-xs text-ink-soft">{t('description')}</p>
        </div>
      </div>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={t('label')}
        onKeyDown={handleGroupKeyDown}
        className="flex flex-col gap-1.5 sm:flex-row"
      >
        {supportedLocales.map((loc) => {
          const active = loc === activeLocale;
          return (
            <button
              key={loc}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => handleSelect(loc)}
              className={cn(
                'flex flex-1 items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all duration-200',
                active
                  ? 'border-blue bg-blue text-white shadow-blue-soft shadow-sm'
                  : 'border-rim bg-white text-ink-soft hover:bg-tint hover:text-ink-strong active:scale-[0.98]',
              )}
            >
              <span className="whitespace-nowrap">{LOCALE_LABELS[loc]}</span>
              {active && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
