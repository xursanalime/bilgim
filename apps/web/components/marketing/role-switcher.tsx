'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

interface RoleSwitcherProps {
  locale: string;
}

/**
 * Header role switcher — segmented control on dark theme with animated pill
 * that slides between O'qituvchilar (/) and Talabalar (/talabalar-uchun).
 */
export function RoleSwitcher({ locale }: RoleSwitcherProps) {
  const pathname = usePathname();
  const path = pathname.replace(new RegExp(`^/${locale}`), '') || '/';
  const isStudent = path.startsWith('/talabalar-uchun');

  return (
    <div className="hidden md:block">
      <div className="relative inline-flex items-center rounded-full border border-white/[0.07] bg-white/[0.04] p-1 backdrop-blur-sm">
        {/* Animated background pill */}
        <motion.div
          className="absolute inset-y-1 w-1/2 rounded-full bg-accent2-500 shadow-[0_0_20px_rgba(0,232,122,0.4)]"
          initial={false}
          animate={{ x: isStudent ? '100%' : '0%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          style={{ left: '0.25rem', width: 'calc(50% - 0.25rem)' }}
        />

        <Link
          href={`/${locale}`}
          aria-current={!isStudent ? 'page' : undefined}
          className={`relative z-10 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-colors duration-300 ${
            !isStudent ? 'text-ink' : 'text-cream-dim hover:text-cream'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
            <path d="M6 12v5c3 3 9 3 12 0v-5" />
          </svg>
          O&apos;qituvchilar
        </Link>

        <Link
          href={`/${locale}/talabalar-uchun`}
          aria-current={isStudent ? 'page' : undefined}
          className={`relative z-10 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-colors duration-300 ${
            isStudent ? 'text-ink' : 'text-cream-dim hover:text-cream'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>
          Talabalar
        </Link>
      </div>
    </div>
  );
}
