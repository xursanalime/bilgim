'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';

import { lessonsApi, type LessonStatus } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';

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
      <span className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-transparent bg-teal px-5 text-sm font-bold text-white">
        ✓ Nashrda
      </span>
    );
  }

  if (status === 'ARCHIVED') {
    return (
      <span className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-red/10 bg-red-tint px-5 text-sm font-bold text-red">
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
        disabled={mutation.isPending}
        className="inline-flex h-11 items-center gap-2 rounded-2xl bg-blue px-5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)] transition-all hover:bg-blue-600 disabled:opacity-60 active:scale-[0.98]"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Nashr qilish
      </button>
      {error && <p className="text-xs text-red">{error}</p>}
    </div>
  );
}
