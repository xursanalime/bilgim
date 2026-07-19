import type { ReactNode } from 'react';
import { unstable_setRequestLocale } from 'next-intl/server';

import { requireAuth } from '../../../../lib/auth-server';

interface MessagesLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

/**
 * Messages surface — STUDENT and TEACHER only (Req 13.5 / 15.7).
 *
 * The dashboard layout wraps a navbar above us; here we just enforce
 * the role restriction and let the page choose the inner layout.
 */
export default function MessagesLayout({
  children,
  params: { locale },
}: MessagesLayoutProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['STUDENT', 'TEACHER'] });
  return (
    <div className="mx-auto h-[calc(100vh-8rem)] w-full max-w-7xl overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-surface/40">
      {children}
    </div>
  );
}
