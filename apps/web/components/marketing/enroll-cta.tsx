'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { isAuthenticated } from '../../lib/auth';

interface EnrollCtaProps {
  locale: string;
  courseId: string;
  fromPriceLabel: string | null;
}

/**
 * Auth-aware "Yozilish" CTA for the public course detail page
 * (Task 25.5, Req 14.6).
 *
 * Behaviour:
 *   - Visitor not signed in → /login?callbackUrl=/{locale}/courses/{id}
 *     so the existing auth flow redirects back here after login.
 *   - Visitor signed in → /{locale}/my-courses?courseId={id} where the
 *     student dashboard surfaces the matching course and lets them open
 *     a checkout session via the existing Payme flow.
 *
 * Why client-only: the public course detail page is server-rendered for
 * SEO. We need access to the client-side auth state (cookie + JWT
 * decode) to pick the right destination, hence this small island.
 *
 * Note: the design idealisation calls for `POST /enrollment/requests`
 * here, but the real backend funnels enrollment through `/billing/checkout`
 * (which creates the EnrollmentRequest in the same transaction as the
 * Payme webhook PerformTransaction — Req 4.4 / 4.6). Routing
 * authenticated visitors to `/my-courses` lets them pick a group and
 * trigger checkout via the existing dashboard UI rather than rebuilding
 * that flow on the marketing surface.
 */
export function EnrollCta({ locale, courseId, fromPriceLabel }: EnrollCtaProps) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  // We can't detect auth at render time without causing hydration
  // mismatch — the initial render runs without `window`. After mount we
  // resolve the real value and update the destination so middle-clicks
  // land on the correct page.
  useEffect(() => {
    setAuthed(isAuthenticated());
  }, []);

  const callback = `/${locale}/courses/${courseId}`;
  const href = authed
    ? `/${locale}/my-courses?courseId=${encodeURIComponent(courseId)}`
    : `/${locale}/login?callbackUrl=${encodeURIComponent(callback)}`;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Always re-check auth at click time. A visitor may have logged out
    // in another tab between mount and click.
    if (!isAuthenticated()) {
      e.preventDefault();
      router.push(`/${locale}/login?callbackUrl=${encodeURIComponent(callback)}`);
      return;
    }
    // For authenticated users, let the link navigate normally.
  };

  return (
    <div className="rounded-3xl border border-accent2-500/30 bg-accent2-500/[0.05] p-6 shadow-[0_0_60px_-24px_rgba(0,232,122,0.4)]">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent2-500">
        Yozilish
      </h2>
      {fromPriceLabel && (
        <p
          className="mt-3 text-2xl font-extrabold tracking-tight text-cream"
          style={{ letterSpacing: '-0.03em' }}
        >
          {fromPriceLabel}
          <span className="ml-1 text-sm font-semibold text-cream-dim">
            / kurs
          </span>
        </p>
      )}
      <p className="mt-2 text-xs text-cream-dim">
        {authed
          ? "Mening kurslarim sahifasiga o'tib, ushbu kursga to'lovni yakunlang."
          : "Ro'yxatdan o'ting, to'lov qiling va ustoz tasdig'idan keyin guruhga qo'shiling."}
      </p>
      <a
        href={href}
        onClick={handleClick}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent2-500 px-5 py-3 text-sm font-bold text-ink shadow-[0_0_0_1px_rgba(0,232,122,0.4),0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-all hover:bg-accent2-400 active:scale-[0.98]"
      >
        {authed ? "Yozilishni davom ettirish" : "Yozilishni boshlash"}
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </a>
    </div>
  );
}
