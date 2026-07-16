import type { MetadataRoute } from 'next';

// Production deployments should set NEXT_PUBLIC_SITE_URL — this fallback
// only covers local/dev builds.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bilgim.uz';

// Authenticated-only route prefixes, mirroring `protectedPrefixes` in
// middleware.ts. Locale prefixes (`/ru`, `/en`) are handled by the leading
// wildcard so a single rule covers all locales.
const protectedPrefixes = [
  '/dashboard',
  '/admin',
  '/student',
  '/groups',
  '/lessons',
  '/live',
  '/schedule',
  '/my-courses',
  '/notifications',
  '/messages',
  '/settings',
  '/onboarding',
  '/assignments',
  '/submissions',
  '/teacher',
  '/requests',
];

export default function robots(): MetadataRoute.Robots {
  const disallow = [
    '/api/',
    // Each protected prefix needs two forms: the default locale (`uz`, no
    // prefix — e.g. `/dashboard`) and any other locale (`/ru/dashboard`,
    // `/en/dashboard`, ...), matched with a wildcard segment.
    ...protectedPrefixes.flatMap((prefix) => [`${prefix}`, `${prefix}/*`, `/*${prefix}`, `/*${prefix}/*`]),
  ];

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow,
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
