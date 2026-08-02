/**
 * Write-through SQLite cache for lessons (Task 22.2, Req 16.1).
 *
 * Cache policy:
 *   - TTL: each entry gets `expiresAt = cachedAt + 7d` by default (the
 *     same window as our backend's CDN cache for lesson assets). Stale
 *     entries are returned to offline readers but the network call
 *     refreshes them whenever connectivity returns.
 *   - LRU: when the on-disk size exceeds 200 MB we delete the oldest
 *     entries by `accessedAt` until we are back under the budget.
 *   - On read we bump `accessedAt` so frequently-viewed lessons stay
 *     in cache.
 *
 * Concurrency: SQLite serializes writes per database; both `put` and
 * `get` are async wrappers around a single `runAsync`. That is fine
 * for a few hundred lessons per user on a phone.
 *
 * Web platform: when SQLite is not available the helpers behave as a
 * pure no-op cache (every read misses, every write returns).
 */

import { openCacheDatabase } from './db';

export interface CachedLesson {
  id: string;
  courseId: string;
  title: string;
  contentJson: unknown;
  mediaManifest: unknown | null;
  cachedAt: number;
  expiresAt: number;
  accessedAt: number;
  sizeBytes: number;
}

export interface CachedLessonInput {
  id: string;
  courseId: string;
  title: string;
  contentJson: unknown;
  mediaManifest?: unknown | null;
  /** TTL override in milliseconds. Defaults to {@link CACHE_DEFAULT_TTL_MS}. */
  ttlMs?: number;
}

/**
 * 7 days — matches the backend's `cache-control: public, max-age=…`
 * header for published-lesson detail responses.
 */
export const CACHE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 200 MB — Task 22.2 acceptance criterion. */
export const CACHE_MAX_BYTES = 200 * 1024 * 1024;

interface CachedLessonRow {
  id: string;
  courseId: string;
  title: string;
  contentJson: string;
  mediaManifest: string | null;
  cachedAt: number;
  expiresAt: number;
  accessedAt: number;
  sizeBytes: number;
}

function rowToLesson(row: CachedLessonRow): CachedLesson {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    contentJson: JSON.parse(row.contentJson) as unknown,
    mediaManifest:
      row.mediaManifest === null
        ? null
        : (JSON.parse(row.mediaManifest) as unknown),
    cachedAt: row.cachedAt,
    expiresAt: row.expiresAt,
    accessedAt: row.accessedAt,
    sizeBytes: row.sizeBytes,
  };
}

/**
 * Read a lesson from cache. Returns `null` on miss; returns the row
 * even if it's expired so an offline reader can still see content
 * (the caller should display a "stale" indicator).
 */
export async function getCachedLesson(
  lessonId: string,
): Promise<CachedLesson | null> {
  const { raw } = await openCacheDatabase();
  if (!raw) return null;

  const row = await raw.getFirstAsync<CachedLessonRow>(
    'SELECT * FROM cached_lessons WHERE id = ? LIMIT 1',
    [lessonId],
  );
  if (!row) return null;

  // Bump LRU pointer. Don't await — the read result is ready.
  void raw.runAsync(
    'UPDATE cached_lessons SET accessedAt = ? WHERE id = ?',
    [Date.now(), lessonId],
  );

  return rowToLesson(row);
}

/**
 * Persist a lesson. Replaces any existing row for the same id, so
 * write-through callers don't need to delete first.
 */
export async function putCachedLesson(
  input: CachedLessonInput,
): Promise<void> {
  const { raw } = await openCacheDatabase();
  if (!raw) return;

  const now = Date.now();
  const ttlMs = input.ttlMs ?? CACHE_DEFAULT_TTL_MS;
  const contentJson = JSON.stringify(input.contentJson);
  const mediaManifest =
    input.mediaManifest == null ? null : JSON.stringify(input.mediaManifest);
  const sizeBytes =
    contentJson.length + (mediaManifest ? mediaManifest.length : 0);

  await raw.runAsync(
    `INSERT INTO cached_lessons
      (id, courseId, title, contentJson, mediaManifest, cachedAt, expiresAt, accessedAt, sizeBytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       courseId = excluded.courseId,
       title = excluded.title,
       contentJson = excluded.contentJson,
       mediaManifest = excluded.mediaManifest,
       cachedAt = excluded.cachedAt,
       expiresAt = excluded.expiresAt,
       accessedAt = excluded.accessedAt,
       sizeBytes = excluded.sizeBytes`,
    [
      input.id,
      input.courseId,
      input.title,
      contentJson,
      mediaManifest,
      now,
      now + ttlMs,
      now,
      sizeBytes,
    ],
  );

  // Best-effort eviction. We always run TTL eviction (cheap) and only
  // run LRU when the cache may be over budget.
  await evictExpiredLessons();
  await evictByLruIfOversize();
}

/**
 * Delete every expired entry. Returns the number of rows removed so
 * callers can surface the result in metrics.
 */
export async function evictExpiredLessons(now: number = Date.now()): Promise<number> {
  const { raw } = await openCacheDatabase();
  if (!raw) return 0;

  const result = await raw.runAsync(
    'DELETE FROM cached_lessons WHERE expiresAt < ?',
    [now],
  );
  return result.changes ?? 0;
}

/**
 * Drop the least-recently-accessed entries until the on-disk total
 * fits inside the budget. No-op when cache size is already within the
 * cap.
 */
export async function evictByLruIfOversize(
  maxBytes: number = CACHE_MAX_BYTES,
): Promise<{ removed: number; bytesAfter: number }> {
  const { raw } = await openCacheDatabase();
  if (!raw) return { removed: 0, bytesAfter: 0 };

  const totalRow = await raw.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(sizeBytes) AS total FROM cached_lessons',
  );
  let total = totalRow?.total ?? 0;
  if (total <= maxBytes) return { removed: 0, bytesAfter: total };

  // Walk oldest-first and delete until we are under the budget. We use
  // `accessedAt ASC` so the row that was used the longest ago is
  // dropped first.
  const candidates = await raw.getAllAsync<{ id: string; sizeBytes: number }>(
    'SELECT id, sizeBytes FROM cached_lessons ORDER BY accessedAt ASC',
  );

  let removed = 0;
  for (const row of candidates) {
    if (total <= maxBytes) break;
    await raw.runAsync('DELETE FROM cached_lessons WHERE id = ?', [row.id]);
    total -= row.sizeBytes;
    removed += 1;
  }

  return { removed, bytesAfter: Math.max(total, 0) };
}
