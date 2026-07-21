/**
 * Mobile i18n — thin wrapper over `@edubridge/i18n`.
 *
 * The web app uses `next-intl`'s server config (see `apps/web/i18n.ts`)
 * which is Node-only. The mobile app needs the same locales but
 * without the SSR machinery, so we ship a minimal in-bundle map plus a
 * `t(key)` helper. Locales: `uz`, `ru`, `en` (default `uz`, matching
 * `@edubridge/i18n`).
 *
 * Resolution order:
 *   1. `EXPO_PUBLIC_LOCALE` env var — handy in dev / E2E.
 *   2. Device locale via `expo-localization` (lazy import).
 *   3. `defaultLocale` (`uz`).
 *
 * The map below contains only keys the auth + tab skeleton needs.
 * Phase 22.2 will load full locale bundles via `expo-asset` /
 * `Asset.fromModule(require('@edubridge/i18n/locales/...'))` so we
 * don't blow up the JS bundle.
 */

import {
  defaultLocale,
  supportedLocales,
  type Locale,
} from '@edubridge/i18n';

import enCommon from '@edubridge/i18n/locales/en/common.json';
import ruCommon from '@edubridge/i18n/locales/ru/common.json';
import uzCommon from '@edubridge/i18n/locales/uz/common.json';

type Messages = Record<string, unknown>;

const MESSAGES: Record<Locale, Messages> = {
  uz: uzCommon as Messages,
  ru: ruCommon as Messages,
  en: enCommon as Messages,
};

let activeLocale: Locale = defaultLocale;

function isLocale(value: string | undefined | null): value is Locale {
  return (
    typeof value === 'string' &&
    (supportedLocales as readonly string[]).includes(value)
  );
}

function detectLocale(): Locale {
  const envLocale = process.env.EXPO_PUBLIC_LOCALE;
  if (isLocale(envLocale)) return envLocale;

  // Device locale lookup is best-effort. We do not import
  // `expo-localization` synchronously to avoid cold-start cost; the
  // host can call `setLocale(...)` from the app bootstrap once it has
  // resolved the device locale.
  return defaultLocale;
}

export function setLocale(locale: Locale | string | undefined): void {
  if (isLocale(locale)) {
    activeLocale = locale;
  } else {
    activeLocale = defaultLocale;
  }
}

export function getLocale(): Locale {
  return activeLocale;
}

/**
 * Resolve a dotted key (`auth.errors.INVALID_CREDENTIALS`) against the
 * active locale. Returns the key itself when no translation exists so
 * missing strings are visible in dev without crashing the app.
 */
export function t(key: string, fallback?: string): string {
  const segments = key.split('.');
  let cursor: unknown = MESSAGES[activeLocale];
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in cursor) {
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }
    cursor = undefined;
    break;
  }
  if (typeof cursor === 'string') return cursor;
  return fallback ?? key;
}

// Pre-warm the active locale at module load time. Apps can override it
// later via `setLocale(...)`.
activeLocale = detectLocale();

export { defaultLocale, supportedLocales, type Locale };
