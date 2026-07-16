'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  FileText,
  MessageCircle,
  Sparkles,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { usePendingRequests } from '../../hooks/use-pending-requests';
import { useUnreadDmCount } from '../../hooks/use-unread-dm-count';
import { usePendingHomeworkCount } from '../../hooks/use-pending-homework-count';

interface BottomTabNavProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

interface TabItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Mobile bottom tab bar (frontend-redesign Req 18.2 / 18.3).
 *
 * The desktop sidebar is hidden below `lg`; this bar gives an equivalent,
 * thumb-reachable primary navigation on small viewports. It augments the
 * hamburger drawer in `DashboardTopNav` (which still exposes the full menu,
 * settings and logout) by surfacing the handful of primary destinations as
 * persistent tabs. Hidden at `lg` and up where the sidebar takes over.
 *
 * Every tab is a ≥44×44px touch target (`min-h-14`/`min-w-11`, Req 18.3) and
 * preserves natural keyboard/focus order (plain anchor links in DOM order).
 */
export function DashboardBottomTabNav({ locale, role }: BottomTabNavProps) {
  const pathname = usePathname();
  const base = `/${locale}`;

  const { data: requests } = usePendingRequests();
  const { data: dmUnreadData } = useUnreadDmCount();
  const { data: homeworkPendingData } = usePendingHomeworkCount();

  const requestCount = requests?.length || 0;
  const dmUnreadCount = dmUnreadData?.count || 0;
  const homeworkPendingCount = homeworkPendingData?.count || 0;

  const studentItems: TabItem[] = [
    { href: `${base}/dashboard`, label: 'Boshqaruv', icon: LayoutDashboard },
    { href: `${base}/my-courses`, label: 'Kurslar', icon: BookOpen },
    { href: `${base}/homework`, label: 'Uy ishlari', icon: FileText },
    { href: `${base}/messages`, label: 'Xabarlar', icon: MessageCircle },
    { href: `${base}/ai-chat`, label: 'BilgimAI', icon: Sparkles },
  ];

  const teacherItems: TabItem[] = [
    { href: `${base}/dashboard`, label: 'Boshqaruv', icon: LayoutDashboard },
    { href: `${base}/dashboard/courses`, label: 'Kurslar', icon: BookOpen },
    { href: `${base}/groups`, label: 'Guruhlar', icon: Users },
    { href: `${base}/homework`, label: 'Uy ishlari', icon: FileText },
    { href: `${base}/messages`, label: 'Xabarlar', icon: MessageCircle },
  ];

  const adminItems: TabItem[] = [
    { href: `${base}/admin`, label: 'Boshqaruv', icon: LayoutDashboard },
    { href: `${base}/admin/users`, label: 'Foydalanuvchilar', icon: Users },
    { href: `${base}/admin/english-catalog`, label: 'Katalog', icon: BookOpen },
    { href: `${base}/admin/settings`, label: 'Sozlamalar', icon: Settings },
  ];

  const items =
    role === 'STUDENT' ? studentItems : role === 'TEACHER' ? teacherItems : adminItems;

  function isActive(href: string): boolean {
    if (href === `${base}/dashboard` || href === `${base}/admin`) {
      return pathname === href;
    }
    if (href === `${base}/groups`) {
      return pathname === href || pathname.includes('/groups');
    }
    if (href === `${base}/dashboard/courses`) {
      if (pathname.includes('/groups')) return false;
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Asosiy navigatsiya"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rim bg-white pb-[max(0px,env(safe-area-inset-bottom))] lg:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          let badgeCount = 0;
          if (item.label === 'Uy ishlari') badgeCount = homeworkPendingCount;
          else if (item.label === 'Xabarlar') badgeCount = dmUnreadCount;
          else if (item.href === `${base}/requests`) badgeCount = requestCount;

          return (
            <li key={item.href} className="flex flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 w-full min-w-11 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-bold transition-colors',
                  active ? 'text-blue' : 'text-ink-soft hover:text-ink-strong'
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badgeCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue px-1 text-[9px] font-bold text-white">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
