import type { MetadataRoute } from 'next';
import { supportedLocales, defaultLocale, type Locale } from '@bilgim/i18n';

// Production deployments should set NEXT_PUBLIC_SITE_URL — this fallback
// only covers local/dev builds.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bilgim.uz';

// Public, marketing-facing routes that have a real `page.tsx` today.
// Mirrors `marketingPaths` in middleware.ts, but only the entries that are
// actually implemented under app/[locale]/(marketing)/* or the root
// app/[locale]/page.tsx — middleware also lists `/about`, `/pricing` and
// `/t/` but none of those have a corresponding page yet, so they're
// intentionally left out to avoid advertising 404s to crawlers.
const marketingRoutes: Array<{ path: string; priority: number }> = [
  { path: '', priority: 1 },
  { path: '/search', priority: 0.7 },
  { path: '/discover', priority: 0.8 },
  { path: '/teachers', priority: 0.8 },
  { path: '/courses', priority: 0.8 },
  { path: '/talabalar-uchun', priority: 0.7 },
];

/** Build a localized URL honoring `localePrefix: 'as-needed'` (default locale has no prefix). */
function localizedUrl(locale: Locale, path: string): string {
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  return `${BASE_URL}${prefix}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return marketingRoutes.flatMap(({ path, priority }) =>
    supportedLocales.map((locale) => ({
      url: localizedUrl(locale, path),
      lastModified,
      changeFrequency: 'weekly' as const,
      priority,
    })),
  );
}
