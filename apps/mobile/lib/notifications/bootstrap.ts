/**
 * One-shot bootstrap for the push notifications stack.
 *
 * Called from `app/_layout.tsx` once the auth state has settled and a
 * user is signed in. The bootstrap is idempotent — calling it twice
 * (e.g. after a login → logout → login cycle) is safe; we only
 * re-register the token if it has changed.
 *
 * What it does:
 *   1. Configures Android notification channel (no-op on iOS).
 *   2. Installs the foreground notification handler so banners show
 *      while the app is open.
 *   3. Requests notification permission (idempotent — never re-prompts).
 *   4. Acquires the Expo push token and registers it with the backend.
 *   5. Subscribes to `addNotificationResponseReceivedListener` and
 *      routes taps to deep links via `resolveDeepLink()`.
 *
 * Returns a `BootstrapResult` describing what happened, plus a
 * `cleanup()` function that removes the listener so the layout can
 * unmount it on sign-out.
 */

import * as Notifications from 'expo-notifications';
import type { Router } from 'expo-router';
import { Platform } from 'react-native';

import {
  ensureAndroidChannel,
  ensureNotificationPermissions,
} from './permissions';
import {
  installForegroundHandler,
  resolveDeepLink,
  type NotificationDataPayload,
} from './handler';
import { registerExpoPushToken } from './token';

export interface BootstrapResult {
  permissionGranted: boolean;
  token: string | null;
  cleanup: () => void;
}

export interface BootstrapOptions {
  /**
   * Router from `expo-router`. Required for deep linking on tap.
   * Pass `useRouter()` from the layout component.
   */
  router: Pick<Router, 'push'>;
  /**
   * Optional sink invoked when a notification is received in the
   * foreground (after the OS shows the banner). Useful for cache
   * invalidation in TanStack Query.
   */
  onForegroundNotification?: (payload: NotificationDataPayload) => void;
}

const NO_OP_CLEANUP: BootstrapResult = {
  permissionGranted: false,
  token: null,
  cleanup: () => undefined,
};

export async function bootstrapPushNotifications(
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  if (Platform.OS === 'web') return NO_OP_CLEANUP;

  installForegroundHandler();
  await ensureAndroidChannel();

  const permission = await ensureNotificationPermissions();
  if (!permission.granted) {
    return { permissionGranted: false, token: null, cleanup: () => undefined };
  }

  const token = await registerExpoPushToken();

  // Subscribe to taps. The listener fires both for cold-start taps
  // (the user tapped a notification while the app was killed) and for
  // resumed-from-background taps.
  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content
        .data as NotificationDataPayload;
      const target = resolveDeepLink(data);
      if (target) {
        try {
          options.router.push(target);
        } catch (err) {
          // The router may not be ready immediately on cold start;
          // log but don't crash.
          if (__DEV__) {
            console.warn('[notifications] deep-link push failed:', err);
          }
        }
      }
    },
  );

  // Fire the optional foreground hook for in-app reactions (badge
  // counters, list invalidation).
  const foregroundSub = options.onForegroundNotification
    ? Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content
          .data as NotificationDataPayload;
        options.onForegroundNotification?.(data);
      })
    : null;

  return {
    permissionGranted: true,
    token,
    cleanup: () => {
      responseSub.remove();
      foregroundSub?.remove();
    },
  };
}
