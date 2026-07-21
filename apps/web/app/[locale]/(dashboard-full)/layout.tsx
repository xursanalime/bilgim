import type { ReactNode } from 'react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { QueryProvider } from '../../../components/providers/query-provider';
import { DashboardTopNav } from '../../../components/dashboard/top-nav';
import { DashboardSidebar } from '../../../components/dashboard/sidebar';
import { requireAuth } from '../../../lib/auth-server';
import { GamificationToastProvider } from '../../../components/providers/gamification-toast-provider';
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
      <GamificationToastProvider>
        <div className="flex h-screen bg-base text-ink-strong overflow-hidden">
          <AiChatWidget role={user.role as 'STUDENT' | 'TEACHER' | 'ADMIN'} />

          <DashboardSidebar
            locale={locale}
            role={user.role}
            userName={''}
            userEmail={user.email}
          />

          <div className="flex flex-1 flex-col overflow-hidden">
            <DashboardTopNav locale={locale} role={user.role} email={user.email} />

            {/* No padding, no max-width — children fill everything */}
            <main className="flex-1 overflow-hidden">
              {children}
            </main>
          </div>
        </div>
      </GamificationToastProvider>
    </QueryProvider>
  );
}
