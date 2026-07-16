/**
 * Background sync barrel.
 *
 * The module:
 *   1. Defines a single TaskManager task name (`bilgim.background-sync`).
 *   2. Registers a periodic background fetch (every 15 minutes — the
 *      shortest interval iOS will honour) that calls `runSyncOnce`.
 *   3. Exposes `runSyncOnce` so screens can perform a manual pull-to-
 *      refresh sweep without going through the OS scheduler.
 *
 * Task 22.2 specifies the sync should refresh:
 *   - notifications inbox (unread count + first page)
 *   - schedule changes (expansion point — full schedule lives in a
 *     later task; for now we read the unread-count side-effect)
 *   - recent lessons metadata (we touch the cached lessons' TTL by
 *     re-fetching their detail, which updates accessedAt as a side
 *     effect of the cache write).
 */

export {
  BACKGROUND_SYNC_TASK,
  registerBackgroundSync,
  unregisterBackgroundSync,
} from './background-task';
export { runSyncOnce, type SyncResult } from './run-sync';
