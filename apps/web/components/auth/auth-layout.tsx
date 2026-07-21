import type { ReactNode } from 'react';
import Link from 'next/link';

interface AuthLayoutProps {
  children: ReactNode;
  locale: string;
  /** "Don't have an account? Sign up" footer text variant */
  footer?: 'signup' | 'login' | 'none';
}

/**
 * Auth layout — full-screen dark background with green radial glow on left,
 * centered card with form on the right.
 */
export function AuthLayout({
  children,
  locale,
  footer = 'none',
}: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ink text-cream">
      {/* ── Background ──────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
      <div className="pointer-events-none absolute inset-0 bg-glow-green" />
      {/* Vignette fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink to-transparent" />

      {/* ── Top bar with single logo ───────────────────────── */}
      <header className="relative z-10 px-6 py-6 sm:px-10">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-cream transition-opacity hover:opacity-80"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent2-500 text-ink shadow-[0_0_20px_rgba(0,232,122,0.4)]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </span>
          EduBridge
        </Link>
      </header>

      {/* ── Centered card ──────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
        <div className="w-full max-w-md">
          {/* Dark card */}
          <div className="rounded-3xl border border-white/[0.07] bg-ink-surface p-8 shadow-2xl sm:p-10">
            {children}
          </div>

          {/* Footer link */}
          {footer !== 'none' && (
            <div className="mt-6 text-center text-sm text-cream-dim">
              {footer === 'signup' ? (
                <>
                  Akkauntingiz yo&apos;qmi?{' '}
                  <Link
                    href={`/${locale}/register`}
                    className="font-semibold text-accent2-500 underline-offset-4 hover:underline"
                  >
                    Ro&apos;yxatdan o&apos;tish
                  </Link>
                </>
              ) : (
                <>
                  Akkauntingiz bormi?{' '}
                  <Link
                    href={`/${locale}/login`}
                    className="font-semibold text-accent2-500 underline-offset-4 hover:underline"
                  >
                    Kirish
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Bottom decoration ──────────────────────────────── */}
      <footer className="relative z-10 px-6 py-6 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim/50 sm:px-10">
        © {new Date().getFullYear()} EduBridge. O&apos;zbekiston uchun
        ta&apos;lim platformasi.
      </footer>
    </div>
  );
}
