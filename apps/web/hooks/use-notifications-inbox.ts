'use client';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../lib/api/notifications';

export function useNotificationsInbox() {
  return useQuery({
    queryKey: ['notifications', 'inbox', { unreadOnly: true }],
    queryFn: () => notificationsApi.list({ unreadOnly: true, limit: 100 }),
    // Poll every 60 seconds
    refetchInterval: 60_000,
  });
}
