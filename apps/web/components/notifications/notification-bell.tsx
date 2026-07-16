'use client';

import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { notificationsApi } from '../../lib/api/notifications';
import { NotificationPanel } from './notification-panel';

interface NotificationBellProps {
  locale: string;
  /** Optional extra classes for the trigger button (positioning, etc.). */
  className?: string;
}

/**
 * Notification center trigger (Task 10.1, Req 14.1).
 *
 * A bell button with an unread-count badge that opens the
 * {@link NotificationPanel} drawer. The badge polls
 * `GET /notifications/unread-count` every 30s; the list itself is owned
 * by the panel and only fetched while open.
 *
 * Themed for the redesigned light app shell (white / rim / ink / blue),
 * so it sits cleanly in the dashboard top-nav.
 */
export function NotificationBell({
  locale,
  className = '',
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 30_000,
    retry: 0,
  });

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = unreadQuery.data?.count ?? 0;
  const display = count > 99 ? '99+' : String(count);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          count > 0
            ? `Bildirishnomalar (${display} o'qilmagan)`
            : 'Bildirishnomalar'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-ink-strong transition-colors hover:bg-soft"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {count > 0 ? (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red px-1 text-[10px] font-black leading-[16px] text-white ring-2 ring-white"
            aria-hidden
          >
            {display}
          </span>
        ) : null}
      </button>

      {open ? (
        <NotificationPanel
          locale={locale}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
