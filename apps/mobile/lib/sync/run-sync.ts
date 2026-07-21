/**
 * The actual sync implementation. Pulled out of the TaskManager
 * registration so it can be invoked directly from a pull-to-refresh
 * handler.
 *
 * Refreshes (Task 22.2):
 *   1. Notifications unread-count (cheap — just a GET).
 *   2. Notifications first page so the inbox screen can render
 *      without an extra round-trip when the user opens it.
 *   3. Recent cached lessons — we re-fetch detail for every lesson
 *      whose row exists in `cached_lessons`, which:
 *        - bumps `accessedAt` (LRU sees it as recent),
 *        - refreshes content + TTL,
 *        - drops dead rows (404s skip silently because `prefetchLesson`
 *          swallows errors).
 *      Capped at the most recent 10 lessons so a 15-min sync stays
 *      fast on cellular.
 *
 * The sync NEVER throws — failures are logged and surfaced via the
 * returned `SyncResult` so callers can decide whether to retry. iOS's
 * `expo-background-fetch` callback expects us to report a result code,
 * which `background-task.ts` derives from this.
 */

import { openCacheDatabase } from '../cache/db';
import { prefetchLesson } from '../../services/lessons';
import {
  getUnreadCount,
  listNotifications,
} from '../../services/notifications';

export interface SyncResult {
  ok: boolean;
  unreadCount?: number;
  notificationsFetched?: number;
  lessonsRefreshed?: number;
  errors: string[];
}

const RECENT_LESSONS_LIMIT = 10;

export async function runSyncOnce(): Promise<SyncResult> {
  const errors: string[] = [];
  const result: SyncResult = { ok: true, errors };

  // ── 1. Notifications unread count ─────────────────────────────
  try {
    const { count } = await getUnreadCount();
    result.unreadCount = count;
  } catch (err) {
    result.ok = false;
    errors.push(`unread-count: ${describe(err)}`);
  }

  // ── 2. Notifications first page ──────────────────────────────
  try {
    const page = await listNotifications({ limit: 20 });
    result.notificationsFetched = page.items.length;
  } catch (err) {
    result.ok = false;
    errors.push(`notifications: ${describe(err)}`);
  }

  // ── 3. Recent lessons (write-through refresh) ────────────────
  try {
    const refreshed = await refreshRecentLessons();
    result.lessonsRefreshed = refreshed;
  } catch (err) {
    // Cache failures should not flip the whole sync to "failed";
    // network failures inside `prefetchLesson` are already swallowed.
    errors.push(`lessons: ${describe(err)}`);
  }

  return result;
}

async function refreshRecentLessons(): Promise<number> {
  const { raw } = await openCacheDatabase();
  if (!raw) return 0;

  const rows = await raw.getAllAsync<{ id: string }>(
    `SELECT id FROM cached_lessons
       ORDER BY accessedAt DESC
       LIMIT ?`,
    [RECENT_LESSONS_LIMIT],
  );

  await Promise.all(rows.map((r) => prefetchLesson(r.id)));
  return rows.length;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
