'use client';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../lib/api/notifications';

export function useUnreadNotificationsCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    // Poll every 60 seconds
    refetchInterval: 60_000,
  });
}
