import type { ReactNode } from 'react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { QueryProvider } from '../../../components/providers/query-provider';
import { DashboardTopNav } from '../../../components/dashboard/top-nav';
import { DashboardSidebar } from '../../../components/dashboard/sidebar';
import { DashboardBottomTabNav } from '../../../components/dashboard/bottom-tab-nav';
import { requireAuth } from '../../../lib/auth-server';
import { GamificationToastProvider } from '../../../components/providers/gamification-toast-provider';
import { LevelUpToast } from '../../../components/gamification/level-up-toast';
import { AiChatWidget } from '../../../components/ai/ai-chat-widget';

interface LayoutProps {
  children: ReactNode;
  params: { locale: string };
}

/**
 * Dashboard-Full layout — sidebar va topnav bor,
 * lekin main da padding va max-width YO'Q.
 * AI Chat va boshqa full-screen sahifalar uchun.
 */
export default function DashboardFullLayout({
  children,
  params: { locale },
}: LayoutProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  return (
    <QueryProvider>
      <GamificationToastProvider role={user.role}>
        <LevelUpToast role={user.role} locale={locale} />
        <div className="flex h-screen bg-surface text-ink-strong overflow-hidden">
          <AiChatWidget role={user.role as 'STUDENT' | 'TEACHER' | 'ADMIN'} />

          <DashboardSidebar
            locale={locale}
            role={user.role}
            userName={''}
            userEmail={user.email}
          />

          <div className="flex flex-1 flex-col overflow-hidden">
            <DashboardTopNav locale={locale} role={user.role} email={user.email} />

            {/* No padding, no max-width — children fill everything.
                Reserve space for the mobile bottom tab bar (Req 18.2). */}
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 overflow-hidden pb-16 lg:pb-0"
            >
              {children}
            </main>
          </div>

          {/* Mobile-only bottom tab bar (Req 18.2/18.3); sidebar takes over at lg. */}
          <DashboardBottomTabNav locale={locale} role={user.role} />
        </div>
      </GamificationToastProvider>
    </QueryProvider>
  );
}
