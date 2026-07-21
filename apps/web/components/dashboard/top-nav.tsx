'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Menu, X, Bell, User } from 'lucide-react';
import { clearTokens } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { usePendingRequests } from '../../hooks/use-pending-requests';
import { useUnreadDmCount } from '../../hooks/use-unread-dm-count';
import { usePendingHomeworkCount } from '../../hooks/use-pending-homework-count';
import { XpBadge } from './xp-badge';

interface DashboardTopNavProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  email: string;
}

export function DashboardTopNav({
  locale,
  role,
  email,
}: DashboardTopNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  
  const { data: requests } = usePendingRequests();
  const { data: dmUnreadData } = useUnreadDmCount();
  const { data: homeworkPendingData } = usePendingHomeworkCount();
  
  const requestCount = requests?.length || 0;
  const dmUnreadCount = dmUnreadData?.count || 0;
  const homeworkPendingCount = homeworkPendingData?.count || 0;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearTokens();
    window.location.href = `/${locale}/login`;
  }

  const base = `/${locale}`;
  const teacherItems = [
    { href: `${base}/dashboard`, label: 'Boshqaruv' },
    { href: `${base}/dashboard/courses`, label: 'Kurslar' },
    { href: `${base}/groups`, label: 'Guruhlar' },
    { href: `${base}/requests`, label: "So'rovlar" },
    { href: `${base}/homework`, label: 'Uy ishlari' },
    { href: `${base}/students`, label: 'Talabalar' },
    { href: `${base}/teacher/analytics`, label: 'Analitika' },
    { href: `${base}/messages`, label: 'Xabarlar' },
  ];

  const studentItems = [
    { href: `${base}/dashboard`, label: 'Boshqaruv' },
    { href: `${base}/my-courses`, label: 'Kurslarim' },
    { href: `${base}/homework`, label: 'Uy ishlari' },
    { href: `${base}/schedule`, label: 'Jadval' },
    { href: `${base}/messages`, label: 'Xabarlar' },
  ];

  const items = role === 'STUDENT' ? studentItems : teacherItems;

  return (
    <header className="sticky top-0 z-40 border-b border-rim bg-white lg:hidden">
      <div className="flex h-16 items-center justify-between px-6">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-ink-strong"
          aria-label="Menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <Link
          href={`${base}/dashboard`}
          className="flex items-center gap-2 text-base font-extrabold tracking-tight text-ink-strong"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue text-white text-[10px] font-black">
            B
          </span>
          <span className="font-display">Bilgim</span>
        </Link>

        <div className="flex items-center gap-3">
          <XpBadge locale={locale} />
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue/10 text-[10px] font-black text-blue">
            {email[0]?.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 top-16 z-[100] h-[calc(100vh-4rem)] w-full overflow-y-auto bg-white animate-in slide-in-from-top duration-300">
          <nav className="flex flex-col p-6 space-y-1">
            {items.map((item) => {
              const isActive = 
                item.href === `${base}/groups` 
                  ? (pathname === item.href || pathname.includes('/groups'))
                  : item.href === `${base}/dashboard/courses`
                    ? (!pathname.includes('/groups') && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
                    : (pathname === item.href || pathname.startsWith(`${item.href}/`));
              
              let badgeCount = 0;
              if (item.label === "So'rovlar") badgeCount = requestCount;
              else if (item.label === "Uy ishlari") badgeCount = homeworkPendingCount;
              else if (item.label === "Xabarlar") badgeCount = dmUnreadCount;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between rounded-2xl px-5 py-4 text-sm font-bold transition-all',
                    isActive
                      ? 'bg-blue text-white shadow-lg shadow-blue/20'
                      : 'text-ink-soft hover:bg-tint active:bg-soft'
                  )}
                >
                  <span>{item.label}</span>
                  {badgeCount > 0 && (
                    <span className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                      isActive ? "bg-white text-blue" : "bg-blue text-white"
                    )}>
                      {badgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
            
            <div className="my-4 h-px bg-rim" />
            
            <Link
              href={`${base}/settings/profile`}
              className="flex items-center rounded-2xl px-5 py-4 text-sm font-bold text-ink-soft hover:bg-tint"
            >
              Sozlamalar
            </Link>
            
            <button
              onClick={handleLogout}
              className="flex w-full items-center rounded-2xl px-5 py-4 text-sm font-bold text-red hover:bg-red-tint"
            >
              Tizimdan chiqish
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
