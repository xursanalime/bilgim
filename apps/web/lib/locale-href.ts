import { defaultLocale } from '@bilgim/i18n';

/**
 * Builds an internal href for a given locale. The middleware's
 * `localePrefix: 'as-needed'` serves the default locale unprefixed and
 * 307-redirects `/${defaultLocale}/...` back to the bare path — so
 * unconditionally prefixing every link with the current locale sends the
 * (majority, default-locale) case through a redirect on every navigation,
 * which breaks Next's client-side transition and forces a full page load.
 */
export function localeHref(locale: string, path = ''): string {
  if (locale === defaultLocale) {
    return path || '/';
  }
  return `/${locale}${path}`;
}
