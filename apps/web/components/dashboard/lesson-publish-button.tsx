'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';

import { lessonsApi, type LessonStatus } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import {
  usePublishingGuard,
  PublishingBlockedNotice,
} from '../teacher/publishing-guard';

interface LessonPublishButtonProps {
  lessonId: string;
  status: LessonStatus;
}

export function LessonPublishButton({
  lessonId,
  status,
}: LessonPublishButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const guard = usePublishingGuard();

  const mutation = useMutation({
    mutationFn: () => lessonsApi.publish(lessonId),
    onSuccess: () => router.refresh(),
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) setError(err.message);
      else setError('Server bilan aloqa xatosi.');
    },
  });

  if (status === 'READY') {
    return (
      <span className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-teal/20 bg-teal/5 px-5 text-sm font-bold text-teal shadow-inner backdrop-blur-md">
        ✓ Nashrda
      </span>
    );
  }

  if (status === 'ARCHIVED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-red/20 bg-red-tint px-3 py-2 text-sm font-medium text-red">
        Arxivda
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          mutation.mutate();
        }}
        disabled={mutation.isPending || guard.blocked}
        title={guard.blocked ? guard.reason ?? undefined : undefined}
        className="inline-flex items-center gap-1.5 rounded-xl bg-blue px-4 py-2 text-sm font-bold text-white shadow-blue-soft transition-colors hover:bg-blue-600 disabled:opacity-60"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Nashr qilish
      </button>
      {guard.blocked && (
        <PublishingBlockedNotice reason={guard.reason} href={guard.href} />
      )}
      {error && <p className="text-xs text-red">{error}</p>}
    </div>
  );
}
