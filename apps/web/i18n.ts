import { getRequestConfig } from 'next-intl/server';
import { supportedLocales, defaultLocale, type Locale } from '@bilgim/i18n';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  // Validate that the incoming locale is supported
  const validLocale = supportedLocales.includes(locale as Locale)
    ? (locale as Locale)
    : defaultLocale;

  return {
    locale: validLocale,
    messages: (
      await import(`@bilgim/i18n/locales/${validLocale}/common.json`)
    ).default,
  };
});
