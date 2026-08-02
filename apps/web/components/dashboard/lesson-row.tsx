'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import {
  Loader2,
  Send,
  ChevronRight,
  AlertCircle,
  Radio,
  PlayCircle,
  Layers,
  FileText,
} from 'lucide-react';

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

const LESSON_TYPE_ICON: Record<Lesson['type'], typeof PlayCircle> = {
  RECORDED: PlayCircle,
  LIVE: Radio,
  HYBRID: Layers,
  TEXT_ONLY: FileText,
};

const LESSON_TYPE_COLOR: Record<Lesson['type'], string> = {
  RECORDED: 'bg-blue-tint text-blue',
  LIVE: 'bg-purple-tint text-purple',
  HYBRID: 'bg-orange-tint text-orange',
  TEXT_ONLY: 'bg-teal-tint text-teal',
};

const LESSON_STATUS_BADGE: Record<Lesson['status'], string> = {
  DRAFT: 'border-rim bg-tint text-ink-faint',
  READY: 'border-transparent bg-teal text-white',
  ARCHIVED: 'border-red/10 bg-red-tint text-red',
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

  const TypeIcon = LESSON_TYPE_ICON[lesson.type];

  return (
    <div className="group relative flex flex-col gap-4 rounded-3xl border border-rim bg-canvas p-5 shadow-soft transition-all hover:-translate-y-1 hover:shadow-medium hover:border-blue/20 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex min-w-0 items-center gap-5 sm:min-w-0 sm:flex-1">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors',
            LESSON_TYPE_COLOR[lesson.type],
          )}
        >
          <TypeIcon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                LESSON_STATUS_BADGE[lesson.status],
              )}
            >
              {LESSON_STATUS_LABEL[lesson.status]}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-ink-faint">
              {LESSON_TYPE_LABEL[lesson.type]}
            </span>
          </div>

          <Link
            href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}`}
            className="group/link flex min-w-0 items-center gap-1.5"
          >
            <h4 className="truncate text-[15px] font-bold text-ink-strong group-hover/link:text-blue transition-colors">
              {lesson.title}
            </h4>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover/link:translate-x-1 group-hover/link:text-blue" />
          </Link>

          {lesson.description && (
            <p className="line-clamp-1 text-xs text-ink-soft">
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
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:shrink-0 sm:flex-nowrap">
        {lesson.type === 'LIVE' && (
          <Link
            href={`/${locale}/live/${lesson.id}?groupId=${groupId}&courseId=${courseId}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-purple-tint px-4 text-xs font-bold text-purple transition-all hover:bg-purple/20 active:scale-[0.98]"
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
