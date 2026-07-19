/**
 * Background sync task — registered with `expo-task-manager` and
 * scheduled by `expo-background-fetch` (Task 22.2, Req 16.1).
 *
 * Periodicity: iOS only honours intervals ≥ 15 minutes; Android may run
 * the task more often but we ask for 15 minutes to keep both platforms
 * predictable.
 *
 * Task lifecycle:
 *   - The TaskManager task body MUST be declared at module-import time
 *     (top-level) so the OS can resolve it after a cold-start wake.
 *     We therefore call `defineTask()` unconditionally as a side
 *     effect of importing this module.
 *   - `registerBackgroundSync()` is idempotent and returns the
 *     scheduling result so callers can surface it in dev tooling.
 *
 * Web platform: TaskManager is unsupported. `register*` / `unregister*`
 * become no-ops.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { runSyncOnce } from './run-sync';

export const BACKGROUND_SYNC_TASK = 'edubridge.background-sync';

const FIFTEEN_MINUTES_S = 15 * 60;

if (Platform.OS !== 'web') {
  // Define the task body at module load time so iOS can resolve it
  // after a cold-start wake. Subsequent calls are ignored by Expo
  // (the second `defineTask` for the same name is a no-op).
  if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
    TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
      try {
        const result = await runSyncOnce();
        return result.ok
          ? BackgroundFetch.BackgroundFetchResult.NewData
          : BackgroundFetch.BackgroundFetchResult.Failed;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }
}

/**
 * Schedule the periodic background sync. Idempotent — calling twice
 * just re-applies the schedule.
 *
 * Returns `null` on web (where it's a no-op) or the underlying
 * `BackgroundFetch.Status` on native.
 */
export async function registerBackgroundSync(): Promise<
  BackgroundFetch.BackgroundFetchStatus | null
> {
  if (Platform.OS === 'web') return null;

  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return status;
  }

  await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: FIFTEEN_MINUTES_S,
    stopOnTerminate: false,
    startOnBoot: true,
  });
  return status;
}

/** Unregister the periodic task — used during logout / dev hot reload. */
export async function unregisterBackgroundSync(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}
