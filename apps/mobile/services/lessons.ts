/**
 * Lessons service — write-through cache wrapper around `/catalog/lessons/:id`
 * (Task 22.2, Req 16.1).
 *
 * Strategy:
 *   1. Network first — calls `sdk.lessons.get(id)`. On success we
 *      hydrate the SQLite cache and return the fresh response.
 *   2. On failure (any throw — DNS, timeout, 5xx) we fall back to the
 *      cache. If a row exists we surface it with `fromCache: true`.
 *      Stale-by-TTL rows are still returned offline; only the network
 *      call decides freshness.
 *   3. Total miss → re-throw the original error so the screen can
 *      render an error state.
 *
 * The shape of `LessonDetail` is the one defined in
 * `@bilgim/api-client` (Task 22.1) — we reuse it verbatim so the
 * cached blob and the fresh response have the same shape.
 *
 * Integration with task 22.1: this module sits at
 * `apps/mobile/services/lessons.ts` (the conventional services layer
 * referenced in the task description) and uses the shared SDK from
 * `lib/api-client.ts`. No type-coupling beyond `LessonDetail`.
 */

import { ApiClientError, type LessonDetail } from '@bilgim/api-client';

import { sdk } from '../lib/api-client';
import {
  getCachedLesson,
  putCachedLesson,
  type CachedLesson,
} from '../lib/cache';

export type { LessonDetail };

export interface LessonResult {
  lesson: LessonDetail;
  fromCache: boolean;
  /** `true` when the cached row's `expiresAt` is in the past. */
  isStale: boolean;
}

interface CachedLessonContent {
  description: LessonDetail['description'];
  status: LessonDetail['status'];
  scheduledFor: LessonDetail['scheduledFor'];
  durationMinutes: LessonDetail['durationMinutes'];
  orderIndex: LessonDetail['orderIndex'];
  createdAt: LessonDetail['createdAt'];
  contentMarkdown: LessonDetail['contentMarkdown'];
  attachments: LessonDetail['attachments'];
}

function lessonToContent(lesson: LessonDetail): CachedLessonContent {
  return {
    description: lesson.description,
    status: lesson.status,
    scheduledFor: lesson.scheduledFor,
    durationMinutes: lesson.durationMinutes,
    orderIndex: lesson.orderIndex,
    createdAt: lesson.createdAt,
    contentMarkdown: lesson.contentMarkdown,
    attachments: lesson.attachments,
  };
}

function cachedToLesson(cached: CachedLesson): LessonDetail {
  const content = (cached.contentJson as CachedLessonContent) ?? {
    description: null,
    status: 'READY',
    scheduledFor: null,
    durationMinutes: null,
    orderIndex: 0,
    createdAt: new Date(cached.cachedAt).toISOString(),
    contentMarkdown: null,
    attachments: [],
  };

  return {
    id: cached.id,
    groupId: cached.courseId,
    title: cached.title,
    description: content.description ?? null,
    status: content.status ?? 'READY',
    scheduledFor: content.scheduledFor ?? null,
    durationMinutes: content.durationMinutes ?? null,
    orderIndex: content.orderIndex ?? 0,
    createdAt: content.createdAt ?? new Date(cached.cachedAt).toISOString(),
    contentMarkdown: content.contentMarkdown ?? null,
    attachments: content.attachments ?? [],
  };
}

async function writeThrough(lesson: LessonDetail): Promise<void> {
  // The SQLite cache stores `(id, courseId, title, contentJson, …)`.
  // We map `groupId` → `courseId` because the cache key naming
  // pre-dates the catalog rename; both reference the same FK column.
  await putCachedLesson({
    id: lesson.id,
    courseId: lesson.groupId,
    title: lesson.title,
    contentJson: lessonToContent(lesson),
    mediaManifest: lesson.attachments.length > 0 ? lesson.attachments : null,
  });
}

/**
 * Fetch a single lesson by id with write-through caching. Never throws
 * on cache failure; only throws when both the network and the cache
 * miss. On a cache hit while offline, returns the cached row even if
 * it's expired so the user can still read the lesson.
 */
export async function fetchLesson(lessonId: string): Promise<LessonResult> {
  try {
    const fresh = await sdk.lessons.get(lessonId);
    void writeThrough(fresh);
    return { lesson: fresh, fromCache: false, isStale: false };
  } catch (err) {
    const cached = await getCachedLesson(lessonId);
    if (cached) {
      return {
        lesson: cachedToLesson(cached),
        fromCache: true,
        isStale: cached.expiresAt < Date.now(),
      };
    }
    if (err instanceof ApiClientError) throw err;
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Pre-cache a lesson without surfacing the result to the caller. Used
 * by the background sync task to keep recent lessons fresh.
 */
export async function prefetchLesson(lessonId: string): Promise<void> {
  try {
    const fresh = await sdk.lessons.get(lessonId);
    await writeThrough(fresh);
  } catch {
    // Background pre-fetch must never throw.
  }
}
