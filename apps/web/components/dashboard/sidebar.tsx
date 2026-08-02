'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  GraduationCap,
  Settings,
  LogOut,
  Bell,
  MessageCircle,
  BarChart3,
  HelpCircle,
  FileText,
  UserCheck,
  Trophy,
  BarChart2,
  Gift,
  Sparkles,
  ShieldOff,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { AI_ENABLED } from '../../lib/features';
import { clearTokens } from '../../lib/auth';
import { usePendingRequests } from '../../hooks/use-pending-requests';
import { useUnreadDmCount } from '../../hooks/use-unread-dm-count';
import { usePendingHomeworkCount } from '../../hooks/use-pending-homework-count';
import { useUnreadNotificationsCount } from '../../hooks/use-unread-notifications-count';
import { XpBadge } from './xp-badge';

interface SidebarProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  userName: string;
  userEmail: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Which counter to render as a badge. Keyed explicitly rather than by
   * matching on `label`, which silently dropped the badge whenever a label
   * was reworded.
   */
  badge?: 'requests' | 'grading' | 'messages';
}

export function DashboardSidebar({ locale, role, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const base = `/${locale}`;
  const { data: requests } = usePendingRequests();
  const { data: dmUnreadData } = useUnreadDmCount();
  const { data: homeworkPendingData } = usePendingHomeworkCount();
  const { data: notificationData } = useUnreadNotificationsCount();

  const requestCount = requests?.length || 0;
  const dmUnreadCount = dmUnreadData?.count || 0;
  const homeworkPendingCount = homeworkPendingData?.count || 0;
  const notificationCount = notificationData?.count || 0;

  const teacherItems: NavItem[] = [
    { href: `${base}/dashboard`, label: 'Boshqaruv', icon: LayoutDashboard },
    { href: `${base}/dashboard/courses`, label: 'Kurslar', icon: BookOpen },
    { href: `${base}/groups`, label: 'Guruhlar', icon: Users },
    { href: `${base}/requests`, label: "So'rovlar", icon: UserCheck, badge: 'requests' },
    { href: `${base}/homework`, label: 'Uy ishlari', icon: FileText, badge: 'grading' },
    { href: `${base}/students`, label: 'Talabalar', icon: GraduationCap },
    { href: `${base}/teacher/analytics`, label: 'Analitika', icon: BarChart3 },
    { href: `${base}/messages`, label: 'Xabarlar', icon: MessageCircle, badge: 'messages' },
    ...(AI_ENABLED
      ? [{ href: `${base}/ai-chat`, label: 'BilgimAI', icon: Sparkles }]
      : []),
  ];

  const studentItems: NavItem[] = [
    { href: `${base}/dashboard`, label: 'Boshqaruv', icon: LayoutDashboard },
    { href: `${base}/my-courses`, label: 'Kurslarim', icon: BookOpen },
    { href: `${base}/homework`, label: 'Uy ishlari', icon: FileText },
    { href: `${base}/schedule`, label: 'Jadval', icon: CalendarDays },
    { href: `${base}/messages`, label: 'Xabarlar', icon: MessageCircle, badge: 'messages' },
    ...(AI_ENABLED
      ? [{ href: `${base}/ai-chat`, label: 'BilgimAI', icon: Sparkles }]
      : []),
    { href: `${base}/achievements`, label: 'Yutuqlar', icon: Trophy },
    { href: `${base}/leaderboard`, label: 'Reyting', icon: BarChart2 },
    { href: `${base}/rewards`, label: "Do'kon", icon: Gift },
  ];

  const adminItems: NavItem[] = [
    { href: `${base}/admin`, label: 'Dashboard', icon: LayoutDashboard },
    { href: `${base}/admin/users`, label: 'Foydalanuvchilar', icon: Users },
    { href: `${base}/admin/specialties`, label: 'Mutaxassisliklar', icon: BookOpen },
    { href: `${base}/admin/onboarding`, label: 'Onboarding', icon: GraduationCap },
    { href: `${base}/admin/cms`, label: 'CMS (Kontent)', icon: LayoutDashboard },
    ...(AI_ENABLED
      ? [{ href: `${base}/admin/ai`, label: 'AI Prompts', icon: MessageCircle }]
      : []),
    { href: `${base}/admin/audit-logs`, label: 'Audit Loglar', icon: FileText },
    { href: `${base}/admin/ip-blocklist`, label: 'Bloklangan IP’lar', icon: ShieldOff },
    { href: `${base}/admin/plans`, label: 'Tariflar', icon: BarChart3 },
    { href: `${base}/admin/settings`, label: 'Tizim Sozlamalari', icon: Settings },
  ];

  const items = role === 'STUDENT' ? studentItems : role === 'TEACHER' ? teacherItems : adminItems;

  function isActive(href: string): boolean {
    if (href === `${base}/dashboard` || href === `${base}/admin`) return pathname === href;
    
    // Special handling for Groups to stay active on all group-related subpages
    // even if they are technically nested under /dashboard/courses/...
    if (href === `${base}/groups`) {
      return pathname === href || pathname.includes('/groups');
    }

    // Prevent Courses from being active when we are inside a specific group
    if (href === `${base}/dashboard/courses`) {
      if (pathname.includes('/groups')) return false;
      return pathname === href || pathname.startsWith(`${href}/`);
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleLogout() {
    // Await logout so the cookie-clearing response lands before we navigate
    // (a full-page nav can abort the in-flight fetch).
    await clearTokens();
    window.location.href = `${base}/login`;
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-rim bg-white lg:flex lg:flex-col">
      {/* Brand */}
      <div className="flex h-16 items-center px-8">
        <Link
          href={`${base}/dashboard`}
          className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-ink-strong"
        >
          <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]">
            <span className="relative z-10 text-[10px] font-black">B</span>
          </span>
          <span className="font-display">Bilgim</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-4 py-6">
        <div className="mb-4 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
          Menyu
        </div>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          
          const badgeCount =
            item.badge === 'requests'
              ? requestCount
              : item.badge === 'grading'
                ? homeworkPendingCount
                : item.badge === 'messages'
                  ? dmUnreadCount
                  : 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200',
                active
                  ? 'bg-blue text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)]'
                  : 'text-ink-soft hover:bg-black/[0.04] hover:text-ink-strong'
              )}
            >
              <Icon className={cn('h-4 w-4 transition-transform group-hover:scale-110', active ? 'text-white' : 'text-ink-soft group-hover:text-blue')} />
              {item.label}
              
              {badgeCount > 0 && (
                <span className={cn(
                  "ml-auto flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                  active ? "bg-white text-blue" : "bg-blue text-white"
                )}>
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Nav */}
      <div className="px-4 pb-4">
        <div className="mb-4 h-px bg-rim mx-4" />
        {/* The inbox page existed but nothing linked to it, so notifications
            were effectively invisible. */}
        <Link
          href={`${base}/notifications`}
          className={cn(
            'group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200',
            pathname.startsWith(`${base}/notifications`)
              ? 'bg-blue/10 text-blue'
              : 'text-ink-soft hover:bg-black/[0.04] hover:text-ink-strong'
          )}
        >
          <Bell className="h-4 w-4" />
          Bildirishnomalar
          {notificationCount > 0 && (
            <span className="ml-auto flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red px-1.5 text-[10px] font-bold text-white">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </Link>
        <Link
          href={`${base}/settings/profile`}
          className={cn(
            'group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200',
            pathname.includes('/settings')
              ? 'bg-blue/10 text-blue'
              : 'text-ink-soft hover:bg-black/[0.04] hover:text-ink-strong'
          )}
        >
          <Settings className="h-4 w-4" />
          Sozlamalar
        </Link>
      </div>

      {/* User block */}
      <div className="border-t border-rim bg-tint/30 pt-4 pb-6">
        {role !== 'TEACHER' && <XpBadge locale={locale} variant="card" />}
        <div className="flex items-center gap-3 px-6 mt-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue/10 text-sm font-bold text-blue">
            {userName ? userName.charAt(0).toUpperCase() : userEmail.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink-strong">
              {userName || userEmail.split('@')[0]}
            </p>
            <p className="truncate text-[10px] font-medium text-ink-faint uppercase tracking-wider">
              {role === 'TEACHER' ? "O'qituvchi" : role === 'STUDENT' ? 'Talaba' : 'Admin'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-4 flex w-full items-center gap-2.5 rounded-xl border border-rim bg-white px-4 py-2.5 text-xs font-bold text-red shadow-sm transition-all hover:bg-red-tint hover:border-red/20 active:scale-[0.98]"
        >
          <LogOut className="h-3.5 w-3.5" />
          Tizimdan chiqish
        </button>
      </div>
    </aside>
  );
}
