'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, ChevronRight, AlertCircle, Radio } from 'lucide-react';

import { lessonsApi, type Lesson } from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface LessonRowProps {
  lesson: Lesson;
  locale: string;
  courseId: string;
  groupId: string;
}

const LESSON_TYPE_LABEL: Record<Lesson['type'], string> = {
  RECORDED: 'Yozib olingan',
  LIVE: 'Jonli efir',
  HYBRID: 'Aralash',
  TEXT_ONLY: 'Matn',
};

const LESSON_STATUS_BADGE: Record<Lesson['status'], string> = {
  DRAFT: 'bg-soft text-ink-soft',
  READY: 'bg-green-tint text-green',
  ARCHIVED: 'bg-red-tint text-red',
};

const LESSON_STATUS_LABEL: Record<Lesson['status'], string> = {
  DRAFT: 'Qoralama',
  READY: 'Nashrda',
  ARCHIVED: 'Arxivda',
};

export function LessonRow({
  lesson,
  locale,
  courseId,
  groupId,
}: LessonRowProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const publishMutation = useMutation({
    mutationFn: () => lessonsApi.publish(lesson.id),
    onSuccess: () => router.refresh(),
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) setError(err.message);
      else setError('Server bilan aloqa xatosi.');
    },
  });

  return (
    <div className="flex items-center justify-between gap-6 px-6 py-5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border',
              lesson.status === 'READY' ? 'bg-green/5 text-green border-green/10' :
              lesson.status === 'DRAFT' ? 'bg-tint text-ink-faint border-rim' :
              'bg-red/5 text-red border-red/10'
            )}
          >
            {LESSON_STATUS_LABEL[lesson.status]}
          </span>
          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-ink-faint/60">
            <span className="h-1 w-1 rounded-full bg-rim" />
            {LESSON_TYPE_LABEL[lesson.type]}
          </div>
        </div>
        
        <Link
          href={lesson.type === 'LIVE'
            ? `/${locale}/live/${lesson.id}?groupId=${groupId}&courseId=${courseId}`
            : `/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}`}
          className="group/link flex items-center gap-2"
        >
          <h4 className="text-[15px] font-bold text-ink-strong group-hover/link:text-blue transition-colors">
            {lesson.title}
          </h4>
          <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover/link:translate-x-1 group-hover/link:text-blue" />
        </Link>

        {lesson.description && (
          <p className="line-clamp-1 text-xs text-ink-soft opacity-70">
            {lesson.description}
          </p>
        )}
        
        {error && (
          <p className="flex items-center gap-1.5 text-[10px] font-bold text-red">
            <AlertCircle className="h-3 w-3" />
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {lesson.type === 'LIVE' && (
          <Link
            href={`/${locale}/live/${lesson.id}?groupId=${groupId}&courseId=${courseId}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-purple/10 px-4 text-xs font-bold text-purple transition-all hover:bg-purple/20 active:scale-[0.98]"
          >
            <Radio className="h-3.5 w-3.5" />
            Efirga kirish
          </Link>
        )}

        {lesson.status === 'DRAFT' && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              publishMutation.mutate();
            }}
            disabled={publishMutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue px-4 text-xs font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 disabled:opacity-60 active:scale-[0.98]"
          >
            {publishMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Nashr qilish
          </button>
        )}
        
        <Link
          href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}/edit`}
          className="flex h-9 items-center rounded-xl border border-rim bg-white px-4 text-xs font-bold text-ink-strong transition-all hover:bg-tint active:scale-[0.98]"
        >
          Tahrirlash
        </Link>
      </div>
    </div>
  );
}
