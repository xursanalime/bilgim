'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Send, ChevronRight, AlertCircle, Radio, Play, PlayCircle } from 'lucide-react';

import { lessonsApi, type Lesson } from '../../lib/api/catalog';
import { liveApi } from '../../lib/api/live';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import {
  usePublishingGuard,
  PublishingBlockedNotice,
} from '../teacher/publishing-guard';

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
  const guard = usePublishingGuard();

  const isLiveLesson = lesson.type === 'LIVE';

  // For LIVE lessons, reflect the ACTUAL session state instead of always
  // offering "Efirga kirish". After the teacher ends the broadcast the session
  // flips to ENDED, the recording is finalized (live.ended → recording queue),
  // and this row should surface the recording — not a stale "join" button.
  const { data: sessionData } = useQuery({
    queryKey: ['live-session-status', lesson.id],
    queryFn: () => liveApi.getOne(lesson.id),
    enabled: isLiveLesson,
    retry: false,
    refetchInterval: isLiveLesson ? 20_000 : false,
    staleTime: 10_000,
  });

  const { data: recordings } = useQuery({
    queryKey: ['lesson-recordings', lesson.id],
    queryFn: () => liveApi.listRecordings(lesson.id),
    enabled: isLiveLesson,
    retry: false,
    refetchInterval: isLiveLesson ? 30_000 : false,
    staleTime: 15_000,
  });

  const liveStatus = sessionData?.session?.status;
  const isLiveNow = liveStatus === 'LIVE' || liveStatus === 'STARTING';

  // Recording state is derived from listRecordings — NOT from getOne, which
  // 404s once a session ends (so it can't tell us "ended/finalizing").
  const recs = recordings ?? [];
  const readyRecording = recs.find((r) => r.status === 'READY' && r.assetId);
  const processingRecording = recs.find((r) => r.status === 'RECORDING');

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
              lesson.status === 'READY' ? 'bg-blue/5 text-blue border-blue/10' :
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
            ? `/${locale}/live/${lesson.id}` 
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

        {lesson.status === 'DRAFT' && guard.blocked && (
          <PublishingBlockedNotice
            reason={guard.reason}
            href={guard.href}
            className="text-[11px]"
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {isLiveLesson && isLiveNow && (
          <Link
            href={`/${locale}/live/${lesson.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-purple/10 px-4 text-xs font-bold text-purple transition-all hover:bg-purple/20 active:scale-[0.98]"
          >
            <Radio className="h-3.5 w-3.5" />
            Efirga kirish
          </Link>
        )}

        {/* Ready recording → watch on demand. */}
        {isLiveLesson && !isLiveNow && readyRecording && (
          <Link
            href={`/${locale}/lessons/${lesson.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-green/10 px-4 text-xs font-bold text-green transition-all hover:bg-green/20 active:scale-[0.98]"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Yozuvni ko&apos;rish
          </Link>
        )}

        {/* Recording still being finalized/uploaded. */}
        {isLiveLesson && !isLiveNow && !readyRecording && processingRecording && (
          <span
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-tint px-4 text-xs font-bold text-ink-soft"
            title="Dars yozuvi tayyorlanmoqda"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Yozuv tayyorlanmoqda
          </span>
        )}

        {/* Not live and no recording yet → teacher can (re)start the broadcast. */}
        {isLiveLesson && !isLiveNow && !readyRecording && !processingRecording && (
          <Link
            href={`/${locale}/live/${lesson.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-purple/10 px-4 text-xs font-bold text-purple transition-all hover:bg-purple/20 active:scale-[0.98]"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Efir boshlash
          </Link>
        )}

        {lesson.status === 'DRAFT' && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              publishMutation.mutate();
            }}
            disabled={publishMutation.isPending || guard.blocked}
            title={guard.blocked ? guard.reason ?? undefined : undefined}
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
