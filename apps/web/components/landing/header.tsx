'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { BrandMark } from './brand-logo';
import { useTheme } from '../providers/theme-provider';
import { localeHref } from '../../lib/locale-href';

/**
 * Compact light/dark toggle for the landing capsule navbar. Cycles between
 * light and dark (ignores `system` for a single-tap UX) and reflects the
 * currently resolved theme.
 */
function LandingThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Yorug‘ rejimga o‘tish' : 'Tungi rejimga o‘tish'}
      title={isDark ? 'Yorug‘ rejim' : 'Tungi rejim'}
      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-all hover:bg-black/[0.04] hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

/**
 * Header — Apple-style liquid glass capsule navbar.
 *
 * On top of hero: subtle floating capsule.
 * On scroll:      strong glass with shadow.
 */
export function Header({ locale }: { locale: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const nav = [
    { label: 'Imkoniyatlar', href: '#features' },
    { label: 'AI Tutor', href: '#ai' },
    { label: 'Tariflar', href: '#pricing' },
    { label: 'Ustozlar', href: localeHref(locale, '/teachers') },
  ];

  return (
    <>
      <header
        className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 transition-all duration-500 ease-out ${
          scrolled
            ? 'w-[calc(100%-2rem)] max-w-5xl'
            : 'w-[calc(100%-2rem)] max-w-7xl'
        }`}
      >
        <div
          className={`relative flex items-center justify-between gap-3 rounded-full transition-all duration-500 ${
            scrolled
              ? 'liquid-glass-strong px-3 py-2'
              : 'liquid-glass px-4 py-2.5'
          }`}
        >
          {/* Logo */}
          <Link
            href={localeHref(locale)}
            className="flex items-center gap-2.5 pl-1.5"
          >
            <BrandMark size={36} />
            <span className="text-base font-extrabold tracking-tight text-ink-strong sm:text-lg" style={{ letterSpacing: '-0.025em' }}>
              Bilgim
            </span>
          </Link>

          {/* Center nav */}
          <nav className="hidden items-center gap-1 lg:flex">
            {nav.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-ink-soft transition-all hover:bg-black/[0.04] hover:text-ink-strong"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <LandingThemeToggle />
            <Link
              href={localeHref(locale, '/login')}
              className="hidden text-sm font-semibold text-ink-soft transition-colors hover:text-ink-strong sm:inline-block"
            >
              Kirish
            </Link>
            <Link
              href={localeHref(locale, '/register?role=teacher')}
              className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-blue px-4 py-2 text-sm font-bold text-white transition-all hover:bg-blue-600 active:scale-[0.97] sm:px-5 sm:py-2.5"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(0, 113, 227, 0.4), 0 8px 24px -8px rgba(0, 113, 227, 0.5)',
              }}
            >
              <span className="relative z-10">Boshlash</span>
              <svg
                className="relative z-10 h-3 w-3 transition-transform group-hover:translate-x-0.5"
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
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="liquid-glass flex h-9 w-9 items-center justify-center rounded-full text-ink-strong lg:hidden"
              aria-label="Menu"
              aria-expanded={mobileOpen}
              aria-controls="landing-mobile-menu"
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
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="liquid-glass-strong absolute left-4 right-4 top-20 rounded-3xl p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <nav id="landing-mobile-menu" className="flex flex-col gap-1">
                {nav.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-2xl px-4 py-3 text-base font-medium text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink-strong"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 border-t border-rim pt-3">
                <Link
                  href={localeHref(locale, '/login')}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-2xl px-4 py-3 text-sm font-semibold text-ink-strong"
                >
                  Kirish
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Logo() {
  // Legacy: kept for backwards-compat references but no longer used in this file.
  return null;
}
