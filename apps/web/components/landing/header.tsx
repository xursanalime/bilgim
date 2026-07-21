'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrandMark } from './brand-logo';

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
    { label: "O'qituvchilar", href: `/${locale}/teachers` },
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
            href={`/${locale}`}
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
            <Link
              href={`/${locale}/login`}
              className="hidden text-sm font-semibold text-ink-soft transition-colors hover:text-ink-strong sm:inline-block"
            >
              Kirish
            </Link>
            <Link
              href={`/${locale}/register?role=teacher`}
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
              onClick={() => setMobileOpen((v) => !v)}
              className="liquid-glass flex h-9 w-9 items-center justify-center rounded-full text-ink-strong lg:hidden"
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
              <nav className="flex flex-col gap-1">
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
                  href={`/${locale}/login`}
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
