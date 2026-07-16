/**
 * SQLite database adapter for the offline cache (Task 22.2, Req 16.1).
 *
 * Schema lives in this file — every table is created by `CREATE TABLE
 * IF NOT EXISTS` so the migration is idempotent and can run on every
 * cold start. We use `expo-sqlite`'s modern (`/next`-style) API which
 * is the default in SDK 51.
 *
 * Storage location: `expo-sqlite` puts the file under the app sandbox
 * (`{documentDir}/SQLite/bilgim_cache.db`). This is automatically
 * cleaned when the user uninstalls; we don't need to track it ourselves.
 *
 * Web platform: `expo-sqlite` falls back to a no-op shim on web. We
 * surface that as a caching layer that always misses, so callers can
 * still use the same API surface across platforms.
 */

import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

export const CACHE_DB_NAME = 'bilgim_cache.db';

export interface CacheDatabase {
  /**
   * Returns the underlying SQLite database, or `null` on platforms
   * where `expo-sqlite` is unavailable (web). Callers should treat
   * `null` as "cache disabled" and skip both reads and writes.
   */
  raw: SQLite.SQLiteDatabase | null;
}

let cached: CacheDatabase | null = null;

const SCHEMA_STATEMENTS: string[] = [
  // Cached lessons. Keyed by lesson id; we keep the contentJson and a
  // mediaManifest blob so the offline screen can list assets that were
  // pre-fetched (e.g. video transcripts, slide URLs).
  `CREATE TABLE IF NOT EXISTS cached_lessons (
    id TEXT PRIMARY KEY NOT NULL,
    courseId TEXT NOT NULL,
    title TEXT NOT NULL,
    contentJson TEXT NOT NULL,
    mediaManifest TEXT,
    cachedAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    accessedAt INTEGER NOT NULL,
    sizeBytes INTEGER NOT NULL DEFAULT 0
  )`,
  // LRU index — orders by accessedAt so eviction can scan from the
  // tail in a single SELECT.
  `CREATE INDEX IF NOT EXISTS idx_cached_lessons_accessed
    ON cached_lessons (accessedAt)`,
  // TTL index — supports `WHERE expiresAt < ?`.
  `CREATE INDEX IF NOT EXISTS idx_cached_lessons_expires
    ON cached_lessons (expiresAt)`,
  // Per-course filter (lessons grouped by their course on the home tab).
  `CREATE INDEX IF NOT EXISTS idx_cached_lessons_course
    ON cached_lessons (courseId)`,
];

/**
 * Open (and migrate) the cache database. Idempotent — subsequent
 * callers receive the same `CacheDatabase` instance.
 */
export async function openCacheDatabase(): Promise<CacheDatabase> {
  if (cached) return cached;

  if (Platform.OS === 'web') {
    cached = { raw: null };
    return cached;
  }

  const db = await SQLite.openDatabaseAsync(CACHE_DB_NAME);
  // Apply schema. `execAsync` runs multiple statements separated by ";".
  await db.execAsync(SCHEMA_STATEMENTS.map((s) => `${s};`).join('\n'));

  cached = { raw: db };
  return cached;
}
