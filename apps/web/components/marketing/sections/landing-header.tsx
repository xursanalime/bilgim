'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * LandingHeader — sticky header for the new landing page.
 *
 * Features:
 *   - Transparent on top of hero, blurred dark surface on scroll
 *   - Navigation links visible on lg+
 *   - Login + CTA buttons always visible
 *   - Mobile hamburger menu (drawer)
 */
export function LandingHeader({ locale }: { locale: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navItems = [
    { label: 'Imkoniyatlar', href: '#features' },
    { label: 'AI Tutor', href: '#ai-tutor' },
    { label: 'Narxlar', href: '#pricing' },
    { label: 'O‘qituvchilar', href: `/${locale}/teachers` },
    { label: 'Kurslar', href: `/${locale}/courses` },
  ];

  return (
    <header
      className={`fixed top-0 z-50 w-full transition-all duration-500 ${
        scrolled
          ? 'border-b border-white/[0.07] bg-ink/80 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:h-18 lg:px-8">
        {/* Logo */}
        <Link
          href={`/${locale}`}
          className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-cream"
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent2-500 text-ink"
            style={{ boxShadow: '0 0 24px rgba(0, 232, 122, 0.5)' }}
          >
            <Logo />
          </span>
          <span>Bilgim</span>
        </Link>

        {/* Center nav (desktop) */}
        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-full px-4 py-2 text-sm font-medium text-cream-dim transition-all hover:bg-white/[0.05] hover:text-cream"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={`/${locale}/login`}
            className="hidden text-sm font-semibold text-cream-dim transition-colors hover:text-cream sm:inline-block"
          >
            Kirish
          </Link>
          <Link
            href={`/${locale}/register?role=teacher`}
            className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-accent2-500 px-4 py-2 text-sm font-bold text-ink transition-all hover:bg-accent2-400 active:scale-[0.97] sm:px-5 sm:py-2.5"
            style={{
              boxShadow:
                '0 0 0 1px rgba(0,232,122,0.4), 0 8px 24px -8px rgba(0,232,122,0.6)',
            }}
          >
            <span className="relative z-10">Boshlash</span>
            <svg
              className="relative z-10 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-cream transition-colors hover:bg-white/[0.08] lg:hidden"
            aria-label="Menu"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {mobileOpen ? (
                <>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </>
              ) : (
                <>
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div className="border-t border-white/[0.07] bg-ink/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-4 py-3 text-sm font-medium text-cream-dim transition-colors hover:bg-white/[0.05] hover:text-cream"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-white/[0.07] pt-4">
              <Link
                href={`/${locale}/login`}
                onClick={() => setMobileOpen(false)}
                className="block rounded-xl px-4 py-3 text-sm font-semibold text-cream"
              >
                Kirish
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function Logo() {
  return (
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
  );
}
