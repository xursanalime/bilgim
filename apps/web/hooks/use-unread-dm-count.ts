'use client';
import { useQuery } from '@tanstack/react-query';
import { dmApi } from '../lib/api/dm';

export function useUnreadDmCount() {
  return useQuery({
    queryKey: ['dm', 'unread-count'],
    queryFn: () => dmApi.getUnreadCount(),
    // Poll every 30 seconds
    refetchInterval: 30_000,
  });
}
