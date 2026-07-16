import type { Locale } from '@bilgim/i18n';

// ═════════════════════════════════════════════════════════════════
// Locale-aware formatting utilities (Req 21.3, 21.4)
//
// Bilgim serves Uzbekistan: money is in Uzbek so'm (UZS) and the
// relevant timezone is Asia/Tashkent. These helpers centralize the
// number / currency / date formatting that was previously duplicated
// across feature components (e.g. components/billing/utils.ts,
// app/[locale]/(dashboard)/groups/page.tsx) so every surface renders
// the same way for a given Locale.
//
// All formatters take an explicit `locale` — never read it implicitly —
// so they work in both Server Components (where the locale is a route
// param) and Client Components (where it comes from `useLocale()`).
// ═════════════════════════════════════════════════════════════════

/**
 * The fallback Locale used when an unknown/unsupported locale is passed.
 * Mirrors `defaultLocale` from `@bilgim/i18n` (kept as a literal here so
 * these pure formatters carry no runtime dependency on the package).
 */
const FALLBACK_LOCALE: Locale = 'uz';

/** Asia/Tashkent — the canonical timezone for Bilgim date/time display. */
export const APP_TIME_ZONE = 'Asia/Tashkent';

/** Map an app Locale (`uz` | `ru` | `en`) to a BCP-47 tag for `Intl`. */
export function localeToBcp47(locale: string): string {
  switch (locale) {
    case 'ru':
      return 'ru-RU';
    case 'en':
      return 'en-US';
    case 'uz':
    default:
      return 'uz-UZ';
  }
}

/**
 * The localized currency suffix for UZS. The Uzbek so'm has no widely
 * rendered glyph through `Intl` currency style, so we append the
 * locale's conventional suffix (matching the app's existing copy).
 */
const CURRENCY_SUFFIX: Record<Locale, string> = {
  uz: "so'm",
  ru: 'сум',
  en: 'UZS',
};

/** Format a plain number with the Locale's grouping separators. */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(localeToBcp47(locale), {
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a UZS amount, Locale-aware — e.g. `formatUzs(150000, 'uz')`
 * → `"150 000 so'm"`. Falls back to the default Locale's suffix for an
 * unknown Locale.
 */
export function formatUzs(amountUzs: number, locale: string): string {
  const grouped = formatNumber(amountUzs, locale);
  const suffix = CURRENCY_SUFFIX[locale as Locale] ?? CURRENCY_SUFFIX[FALLBACK_LOCALE];
  return `${grouped} ${suffix}`;
}

/** Accepted date inputs across the app: ISO string, epoch ms, or Date. */
export type DateInput = string | number | Date | null | undefined;

/** Coerce a {@link DateInput} into a valid `Date`, or `null` if invalid. */
function toDate(input: DateInput): Date | null {
  if (input == null) return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a date Locale-aware in the Asia/Tashkent timezone — e.g.
 * `"15-yanvar, 2025"` (uz). Returns `"—"` for missing/invalid input.
 * Pass `options` to override the default day/month/year style.
 */
export function formatDate(
  input: DateInput,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(input);
  if (!date) return '—';
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: APP_TIME_ZONE,
    ...options,
  }).format(date);
}

/**
 * Format a date *and* time Locale-aware in the Asia/Tashkent timezone.
 * Returns `"—"` for missing/invalid input.
 */
export function formatDateTime(
  input: DateInput,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDate(input, locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

// ──────────────────────────────────────────────────────────────────
// Tri-lingual entity rendering (Req 21.4)
//
// Several entities (specialties, plans, badges, exam tracks, levels)
// store their display name in three columns: nameUz / nameRu / nameEn.
// `localizedName` picks the field matching the active Locale and falls
// back gracefully when a translation is missing so a name is always
// shown.
// ──────────────────────────────────────────────────────────────────

/** An entity whose display name is stored per-Locale (all optional). */
export interface TrilingualName {
  nameUz?: string | null;
  nameRu?: string | null;
  nameEn?: string | null;
}

/**
 * Pick the entity name for the active Locale, falling back through
 * uz → ru → en so a non-empty value is returned whenever one exists.
 * Returns `''` only when every field is missing.
 */
export function localizedName(entity: TrilingualName, locale: string): string {
  const byLocale: Record<Locale, string | null | undefined> = {
    uz: entity.nameUz,
    ru: entity.nameRu,
    en: entity.nameEn,
  };
  const preferred = byLocale[locale as Locale];
  return (preferred || entity.nameUz || entity.nameRu || entity.nameEn || '').trim();
}

/**
 * Generic tri-lingual field picker for entities that suffix an arbitrary
 * base field with `Uz`/`Ru`/`En` (e.g. `title`, `description`). Same
 * uz → ru → en fallback as {@link localizedName}.
 */
export function localizedField<TBase extends string>(
  entity: Partial<Record<`${TBase}${'Uz' | 'Ru' | 'En'}`, string | null>>,
  base: TBase,
  locale: string,
): string {
  const uz = entity[`${base}Uz` as const];
  const ru = entity[`${base}Ru` as const];
  const en = entity[`${base}En` as const];
  const byLocale: Record<Locale, string | null | undefined> = { uz, ru, en };
  const preferred = byLocale[locale as Locale];
  return (preferred || uz || ru || en || '').trim();
}
