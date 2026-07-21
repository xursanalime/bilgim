'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';

import { coursesApi } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';

interface CourseDeleteButtonProps {
  courseId: string;
  locale: string;
}

export function CourseDeleteButton({
  courseId,
  locale,
}: CourseDeleteButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => coursesApi.remove(courseId),
    onSuccess: () => {
      router.push(`/${locale}/dashboard/courses`);
      router.refresh();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Server bilan aloqa xatosi.');
      }
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-transparent px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10"
      >
        <Trash2 className="h-4 w-4" />
        Kursni o&apos;chirish
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
      >
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Tasdiqlash va o&apos;chirish
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-xl px-3 py-2 text-sm font-medium text-cream-dim hover:bg-white/[0.04] hover:text-cream"
      >
        Bekor qilish
      </button>
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </div>
  );
}
