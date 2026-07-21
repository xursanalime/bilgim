/**
 * Permission flow for push notifications.
 *
 * On Android the system grants notifications by default; on iOS the user
 * has to explicitly approve. We always re-check (rather than blindly
 * asking on every cold boot) so users who have already been asked don't
 * see a permission popup on every launch.
 *
 * Web is a no-op — `expo-notifications` does not work in the web
 * runtime; the bootstrap caller short-circuits with `granted: false`.
 *
 * Exports:
 *   - `ensureNotificationPermissions()` — idempotent permission request.
 *     Returns `granted: true` only when the user has actively allowed
 *     notifications on the OS level.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export interface PermissionResult {
  granted: boolean;
  /** `true` iff we asked the OS during this call (vs read a cached state). */
  prompted: boolean;
}

export async function ensureNotificationPermissions(): Promise<PermissionResult> {
  if (Platform.OS === 'web') {
    return { granted: false, prompted: false };
  }

  const existing = await Notifications.getPermissionsAsync();
  if (
    existing.granted ||
    existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return { granted: true, prompted: false };
  }

  if (existing.canAskAgain === false) {
    // The user has previously denied and selected "Don't ask again".
    // The app must direct them to system settings — done by callers.
    return { granted: false, prompted: false };
  }

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      // PROVISIONAL keeps notifications quiet (no banner) until the user
      // promotes them — useful for onboarding without a permission
      // gauntlet.
      allowProvisional: false,
    },
  });

  return {
    granted:
      requested.granted ||
      requested.ios?.status ===
        Notifications.IosAuthorizationStatus.PROVISIONAL,
    prompted: true,
  };
}

/**
 * On Android we want a default channel so notifications have correct
 * priority + LED color even before the OS surfaces our channel name.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Umumiy xabarnomalar',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#00E87A',
  });
}
