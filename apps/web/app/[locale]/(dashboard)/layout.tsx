import type { ReactNode } from 'react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { QueryProvider } from '../../../components/providers/query-provider';
import { DashboardTopNav } from '../../../components/dashboard/top-nav';
import { DashboardSidebar } from '../../../components/dashboard/sidebar';
import { requireAuth } from '../../../lib/auth-server';
import { GamificationToastProvider } from '../../../components/providers/gamification-toast-provider';

interface DashboardLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export default function DashboardLayout({
  children,
  params: { locale },
}: DashboardLayoutProps) {
  unstable_setRequestLocale(locale);

  const user = requireAuth({ locale });

  const content = (
    <div className="flex h-screen bg-base text-ink-strong overflow-hidden">
      {/* Sidebar — hidden on mobile */}
      <DashboardSidebar
        locale={locale}
        role={user.role}
        userName={''}
        userEmail={user.email}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardTopNav locale={locale} role={user.role} email={user.email} />

        <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-10 lg:px-12">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );

  return (
    <QueryProvider>
      {/* Gamification (XP/streaks) is disabled for teachers */}
      {user.role === 'TEACHER' ? content : (
        <GamificationToastProvider>{content}</GamificationToastProvider>
      )}
    </QueryProvider>
  );
}
