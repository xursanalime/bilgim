import { ReactNode } from 'react';
import { requireAuth } from '../../../../lib/auth-server';
import { redirect } from 'next/navigation';

interface AdminLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export default function AdminLayout({
  children,
  params: { locale },
}: AdminLayoutProps) {
  const user = requireAuth({ locale });

  if (user.role !== 'ADMIN') {
    redirect(`/${locale}/not-authorized`);
  }

  return (
    <div className="animate-in fade-in duration-500">
      {children}
    </div>
  );
}
