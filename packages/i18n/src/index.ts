// i18n configuration and locale exports
export const supportedLocales = ['uz', 'ru', 'en'] as const;
export type Locale = (typeof supportedLocales)[number];
export const defaultLocale: Locale = 'uz';
