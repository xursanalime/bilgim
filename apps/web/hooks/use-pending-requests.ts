'use client';
import { useQuery } from '@tanstack/react-query';
import { enrollmentApi } from '../lib/api/enrollment';
import { getUserRole } from '../lib/auth';

export function usePendingRequests() {
  const role = getUserRole();
  const isTeacherOrAdmin = role === 'TEACHER' || role === 'ADMIN';

  return useQuery({
    queryKey: ['enrollment', 'requests', 'pending'],
    queryFn: () => enrollmentApi.pendingRequests(),
    enabled: isTeacherOrAdmin,
    // Poll every 60 seconds
    refetchInterval: isTeacherOrAdmin ? 60_000 : false,
  });
}
