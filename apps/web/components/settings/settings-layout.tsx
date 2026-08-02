'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, Bell, Shield, CreditCard, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SettingsLayoutClientProps {
  locale: string;
  // `undefined` is explicitly allowed (not just omission) because the
  // caller passes `user?.role`, which is `undefined` when signed out —
  // required under this project's `exactOptionalPropertyTypes: true`.
  role?: string | undefined;
}

export function SettingsLayoutClient({ locale, role }: SettingsLayoutClientProps) {
  const pathname = usePathname();
  const base = `/${locale}/settings`;

  const tabs = [
    { href: `${base}/profile`, label: 'Shaxsiy profil', icon: User },
    // Notifications/Billing are STUDENT/TEACHER-only server-side
    // (`requireAuth({ roles: [...] })` redirects ADMIN away on both
    // pages) — hide the tabs for ADMIN too instead of navigating them
    // into that redirect.
    ...(role !== 'ADMIN'
      ? [{ href: `${base}/notifications`, label: 'Xabarnomalar', icon: Bell }]
      : []),
    { href: `${base}/security`, label: 'Xavfsizlik', icon: Shield },
    ...(role !== 'ADMIN'
      ? [{ href: `${base}/billing`, label: 'Toʻlovlar', icon: CreditCard }]
      : []),
  ];

  return (
    <aside className="w-full shrink-0 lg:w-[280px]">
      <nav className="flex items-center gap-2 overflow-x-auto pb-4 scrollbar-hide lg:flex-col lg:items-stretch lg:gap-1.5 lg:pb-0 lg:overflow-visible">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = pathname.startsWith(tab.href);
          
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "group flex shrink-0 items-center justify-between rounded-2xl px-4 py-2.5 text-sm font-bold transition-all duration-300 sm:px-5 sm:py-3 lg:shrink lg:px-4 lg:py-2.5",
                active
                  ? "bg-blue text-white shadow-blue-soft shadow-lg scale-[1.01]"
                  : "bg-white border border-rim text-ink-soft hover:bg-tint hover:text-ink-strong active:scale-[0.98]"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className={cn("h-4.5 w-4.5", active ? "text-white" : "text-ink-faint group-hover:text-blue transition-colors")} />
                <span className="whitespace-nowrap">{tab.label}</span>
              </div>
              <ChevronRight className={cn(
                "hidden h-4 w-4 transition-transform lg:block",
                active ? "text-white/60 translate-x-0.5" : "text-ink-faint opacity-0 group-hover:opacity-100 group-hover:translate-x-0 -translate-x-2"
              )} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
