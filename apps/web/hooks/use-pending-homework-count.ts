'use client';
import { useQuery } from '@tanstack/react-query';
import { homeworkApi } from '../lib/api/homework';

export function usePendingHomeworkCount() {
  return useQuery({
    queryKey: ['homework', 'pending-count'],
    queryFn: () => homeworkApi.getPendingCount(),
    // Poll every 60 seconds
    refetchInterval: 60_000,
  });
}
