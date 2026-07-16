'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supportedLocales, defaultLocale, type Locale } from '@bilgim/i18n';

import { Button } from '../ui/button';
import { usePrefersReducedMotion } from '../../lib/use-prefers-reduced-motion';

// ═════════════════════════════════════════════════════════════════
// CookieConsentBanner — first-visit cookie notice.
//
// Mounted once in the ROOT layout (app/layout.tsx), so it renders above
// the `[locale]` segment and shows on every page regardless of auth
// state. Because of that it can't rely on the `NextIntlClientProvider`
// context (that's set up one level down, in app/[locale]/layout.tsx), so
// the locale for the privacy-policy link is derived directly from the
// pathname instead of `useLocale()`.
//
// Storage: a plain localStorage flag (`bilgim_cookie_consent`) — this is
// a non-sensitive UI preference, unrelated to the HttpOnly auth-token
// cookies used elsewhere in the app.
// ═════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'bilgim_cookie_consent';

/** Resolve the active locale from the URL, honoring `localePrefix: 'as-needed'`. */
function localeFromPathname(pathname: string): Locale {
  const segment = pathname.split('/')[1];
  return supportedLocales.includes(segment as Locale)
    ? (segment as Locale)
    : defaultLocale;
}

function privacyHref(pathname: string): string {
  const locale = localeFromPathname(pathname);
  return locale === defaultLocale ? '/legal/privacy' : `/${locale}/legal/privacy`;
}

export function CookieConsentBanner() {
  const pathname = usePathname() ?? '/';
  const prefersReducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const consented = window.localStorage.getItem(STORAGE_KEY);
      if (!consented) setVisible(true);
    } catch {
      // localStorage unavailable (private mode, disabled, etc.) — skip
      // the banner rather than risk a render loop trying to persist it.
    }
  }, []);

  function handleAccept() {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Ignore — worst case the banner reappears next visit.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie xabarnomasi"
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 ${
        prefersReducedMotion ? '' : 'animate-in slide-in-from-bottom-4 duration-300'
      }`}
    >
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-rim bg-canvas p-4 shadow-lg shadow-black/10 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-soft">
          Ushbu sayt sessiyangizni saqlash va xizmatni yaxshilash uchun
          cookie&apos;lardan foydalanadi.{' '}
          <Link
            href={privacyHref(pathname)}
            className="font-semibold text-ink-strong underline underline-offset-2"
          >
            Maxfiylik siyosati
          </Link>
        </p>
        <div className="flex shrink-0 justify-end">
          <Button type="button" size="sm" onClick={handleAccept}>
            Roziman
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CookieConsentBanner;
