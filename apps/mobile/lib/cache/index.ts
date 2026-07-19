/**
 * Offline cache barrel — public surface for screens and services.
 *
 * Implementation:
 *   - `./db` — opens (and migrates) the SQLite database.
 *   - `./lessons-cache` — write-through cache for lesson detail.
 *
 * Sizes & policies are documented in their owning module so callers
 * don't need to remember TTL/LRU semantics. The default cap is 200 MB
 * (Task 22.2 acceptance criterion).
 */

export {
  openCacheDatabase,
  CACHE_DB_NAME,
  type CacheDatabase,
} from './db';
export {
  getCachedLesson,
  putCachedLesson,
  evictExpiredLessons,
  evictByLruIfOversize,
  CACHE_DEFAULT_TTL_MS,
  CACHE_MAX_BYTES,
  type CachedLesson,
  type CachedLessonInput,
} from './lessons-cache';
