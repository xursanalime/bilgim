'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ListChecks,
  Lock,
  PlayCircle,
  Radio,
} from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { ErrorState } from '../states';
import {
  studentApi,
  type LessonSummary,
} from '../../lib/api/student';
import { lessonProgressApi } from '../../lib/lesson-api';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface LessonNavProps {
  locale: string;
  groupId: string;
  currentLessonId: string;
}

/**
 * Lesson navigation (frontend-redesign task 2.3, Req 6.4):
 *  - previous / next controls (skip nothing — neighbours are disabled when
 *    locked so a Learner can't jump into an inaccessible lesson),
 *  - the full ordered lesson list for the Group with the current lesson
 *    highlighted and per-lesson completion + lock state,
 *  - locked lessons render as non-interactive rows (no link), surfacing the
 *    published/locked status from Req 6.4.
 *
 * Completion comes from the server-side progress endpoint (Req 6.6) via
 * `lessonProgressApi`; it degrades to "nothing completed" if that endpoint is
 * not yet deployed, so navigation always renders.
 */
export function LessonNav({ locale, groupId, currentLessonId }: LessonNavProps) {
  const lessonsQuery = useQuery({
    queryKey: ['catalog', 'group', groupId, 'lessons'],
    queryFn: () => studentApi.listLessons(groupId),
  });

  const progressQuery = useQuery({
    queryKey: ['catalog', 'group', groupId, 'progress'],
    queryFn: () => lessonProgressApi.listGroupProgress(groupId),
  });

  const completedIds = useMemo(() => {
    const set = new Set<string>();
    for (const entry of progressQuery.data ?? []) {
      if (entry.completed) set.add(entry.lessonId);
    }
    return set;
  }, [progressQuery.data]);

  const ordered = useMemo(() => {
    const list = [...(lessonsQuery.data ?? [])];
    list.sort((a, b) => a.position - b.position);
    return list;
  }, [lessonsQuery.data]);

  const currentIndex = ordered.findIndex((l) => l.id === currentLessonId);
  const prev = currentIndex > 0 ? ordered[currentIndex - 1] : undefined;
  const next =
    currentIndex >= 0 && currentIndex < ordered.length - 1
      ? ordered[currentIndex + 1]
      : undefined;

  if (lessonsQuery.isLoading) {
    return (
      <Card padding="lg" className="space-y-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </Card>
    );
  }

  if (lessonsQuery.isError) {
    return (
      <ErrorState
        title="Darslar ro'yxatini yuklab bo'lmadi"
        message={
          lessonsQuery.error instanceof ApiClientError
            ? lessonsQuery.error.message
            : "Iltimos, keyinroq qayta urinib ko'ring."
        }
        retryLabel="Qayta urinish"
        onRetry={() => void lessonsQuery.refetch()}
      />
    );
  }

  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-ink-soft" aria-hidden="true" />
        <h2 className="text-base font-bold tracking-tight text-ink-strong">
          Guruh darslari
        </h2>
      </div>

      {/* Prev / next */}
      <div className="flex items-center justify-between gap-2">
        <NavArrow
          locale={locale}
          lesson={prev}
          direction="prev"
        />
        <NavArrow
          locale={locale}
          lesson={next}
          direction="next"
        />
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-ink-soft">Bu guruhda darslar mavjud emas.</p>
      ) : (
        <ol className="space-y-1.5">
          {ordered.map((lesson, idx) => (
            <li key={lesson.id}>
              <LessonRow
                locale={locale}
                lesson={lesson}
                index={idx + 1}
                isCurrent={lesson.id === currentLessonId}
                isCompleted={completedIds.has(lesson.id)}
              />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** A lesson is locked (not navigable) unless it is published/READY. */
function isLessonLocked(lesson: LessonSummary): boolean {
  return lesson.status !== 'READY';
}

function NavArrow({
  locale,
  lesson,
  direction,
}: {
  locale: string;
  lesson: LessonSummary | undefined;
  direction: 'prev' | 'next';
}) {
  const isPrev = direction === 'prev';
  const label = isPrev ? 'Oldingi' : 'Keyingi';
  const locked = lesson ? isLessonLocked(lesson) : false;
  const disabled = !lesson || locked;

  const icon = isPrev ? (
    <ChevronLeft className="h-4 w-4" />
  ) : (
    <ChevronRight className="h-4 w-4" />
  );

  if (disabled) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        {...(isPrev ? { leftIcon: icon } : { rightIcon: icon })}
        title={locked ? 'Dars qulflangan' : undefined}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      {...(isPrev ? { leftIcon: icon } : { rightIcon: icon })}
    >
      <Link href={`/${locale}/lessons/${lesson.id}`}>{label}</Link>
    </Button>
  );
}

function LessonRow({
  locale,
  lesson,
  index,
  isCurrent,
  isCompleted,
}: {
  locale: string;
  lesson: LessonSummary;
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
}) {
  const locked = isLessonLocked(lesson);
  const isLive = lesson.type === 'LIVE';

  const inner = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <StatusIcon
        locked={locked}
        completed={isCompleted}
        isCurrent={isCurrent}
        isLive={isLive}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {index}. {lesson.title}
        </span>
        <span className="block text-[11px] uppercase tracking-wide text-ink-faint">
          {lesson.type}
        </span>
      </span>
    </span>
  );

  // Locked lessons are intentionally NOT clickable (Req 6.4).
  if (locked) {
    return (
      <div
        aria-disabled="true"
        className="flex items-center justify-between gap-3 rounded-2xl border border-rim bg-soft/60 px-3 py-2.5 text-left text-ink-faint"
      >
        {inner}
        <Badge variant="neutral" size="sm">
          <Lock className="h-3 w-3" />
          Qulflangan
        </Badge>
      </div>
    );
  }

  return (
    <Link
      href={`/${locale}/lessons/${lesson.id}`}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue active:scale-[0.99]',
        isCurrent
          ? 'border-blue/40 bg-blue-tint text-ink-strong'
          : 'border-rim bg-canvas text-ink-strong hover:border-blue/40 hover:bg-blue-tint',
      )}
    >
      {inner}
      {isCompleted ? (
        <Badge variant="green" size="sm">
          <Check className="h-3 w-3" />
          Bajarildi
        </Badge>
      ) : isCurrent ? (
        <Badge variant="blue" size="sm">
          Joriy
        </Badge>
      ) : null}
    </Link>
  );
}

function StatusIcon({
  locked,
  completed,
  isCurrent,
  isLive,
}: {
  locked: boolean;
  completed: boolean;
  isCurrent: boolean;
  isLive: boolean;
}) {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl';

  if (locked) {
    return (
      <span className={cn(base, 'bg-soft text-ink-faint')} aria-hidden="true">
        <Lock className="h-4 w-4" />
      </span>
    );
  }
  if (completed) {
    return (
      <span className={cn(base, 'bg-green-tint text-green')} aria-hidden="true">
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (isLive) {
    return (
      <span className={cn(base, 'bg-red-tint text-red')} aria-hidden="true">
        <Radio className="h-4 w-4" />
      </span>
    );
  }
  if (isCurrent) {
    return (
      <span className={cn(base, 'bg-blue-tint text-blue')} aria-hidden="true">
        <PlayCircle className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className={cn(base, 'bg-soft text-ink-soft')} aria-hidden="true">
      <Circle className="h-4 w-4" />
    </span>
  );
}
