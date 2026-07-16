/**
 * Expo push token retrieval + backend registration.
 *
 * Flow (Task 22.2, Req 16.1):
 *   1. Acquire an `ExpoPushToken[<id>]` via `Notifications.getExpoPushTokenAsync()`.
 *   2. Cache it in `expo-secure-store` so we can call `DELETE
 *      /notifications/devices/:token` on logout without re-fetching it
 *      from Expo first.
 *   3. POST it to `/notifications/devices` together with `expo-device`
 *      metadata (model, OS, app version) so support engineers can debug
 *      delivery failures.
 *
 * The token is stored via `secureStorage` (not `MMKV` / `AsyncStorage`)
 * because it is a stable identity-bearing string — anyone with the
 * token can deliver pushes to the device. SecureStore uses the iOS
 * Keychain / Android Keystore and is the same store the auth tokens
 * use, so its security model is well understood.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiClient } from '../api-client';
import { secureStorage } from '../secure-storage';

const PUSH_TOKEN_KEY = 'bilgim_push_token';

interface RegisterResponse {
  id: string;
  platform: 'ios' | 'android' | 'web';
  lastSeenAt: string;
}

function resolveProjectId(): string | null {
  const easProjectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null;
  if (typeof easProjectId === 'string' && easProjectId.length > 0) {
    return easProjectId;
  }
  return null;
}

function resolvePlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * Retrieve the Expo push token. Returns `null` when the runtime cannot
 * issue one — this happens on the iOS simulator (no APNs), on web, and
 * when EAS project id is missing in development builds.
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) {
    // Push tokens are not issued on simulators / emulators because the
    // Apple/Google services that mint them require a real device.
    return null;
  }

  const projectId = resolveProjectId();
  try {
    // `getExpoPushTokenAsync` accepts an optional `{ projectId }` pair;
    // when it is missing on a custom dev build the call throws — we
    // handle that path below.
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return result.data;
  } catch (err) {
    // Don't crash the whole app if the token cannot be acquired (e.g.
    // simulator, no Google Play Services, missing EAS config); the
    // user can still use the app, they just won't receive pushes.
    if (__DEV__) {
      console.warn('[notifications] getExpoPushTokenAsync failed:', err);
    }
    return null;
  }
}

/**
 * Build the `deviceInfo` blob sent to the backend. Captures everything
 * that helps support engineers debug delivery without joining tables.
 */
function buildDeviceInfo(): Record<string, unknown> {
  return {
    modelName: Device.modelName ?? null,
    osName: Device.osName ?? null,
    osVersion: Device.osVersion ?? null,
    deviceName: Device.deviceName ?? null,
    appVersion: Constants.expoConfig?.version ?? null,
    appBuild:
      (Constants.expoConfig?.ios?.buildNumber as string | undefined) ??
      ((Constants.expoConfig?.android?.versionCode ?? null) as
        | number
        | null
        | undefined) ??
      null,
    locale: typeof navigator !== 'undefined' ? navigator.language : null,
  };
}

/**
 * Acquire and register the push token with the backend.
 * Returns the registered token, or `null` if registration could not
 * be completed (no token, network error, or backend rejected).
 */
export async function registerExpoPushToken(): Promise<string | null> {
  const token = await getExpoPushToken();
  if (!token) return null;

  try {
    await apiClient.post<RegisterResponse>('/notifications/devices', {
      token,
      platform: resolvePlatform(),
      deviceInfo: buildDeviceInfo(),
    });
    await secureStorage.set(PUSH_TOKEN_KEY, token);
    return token;
  } catch (err) {
    if (__DEV__) {
      console.warn('[notifications] backend registration failed:', err);
    }
    return null;
  }
}

/**
 * Unregister the device's push token from the backend. Used during
 * logout so the server stops trying to deliver notifications to a
 * device whose user has changed.
 */
export async function unregisterExpoPushToken(): Promise<void> {
  const token = await secureStorage.get(PUSH_TOKEN_KEY);
  if (!token) return;
  try {
    await apiClient.delete<{ deleted: boolean }>(
      `/notifications/devices/${encodeURIComponent(token)}`,
    );
  } catch (err) {
    // We swallow the error and clear the local cache anyway — if the
    // server has already forgotten the token (e.g. revoked due to
    // DeviceNotRegistered) the DELETE returns 404 which is fine.
    if (__DEV__) {
      console.warn('[notifications] backend unregistration failed:', err);
    }
  } finally {
    await secureStorage.remove(PUSH_TOKEN_KEY);
  }
}

/** Best-effort access to the cached token without round-tripping Expo. */
export async function getStoredPushToken(): Promise<string | null> {
  return secureStorage.get(PUSH_TOKEN_KEY);
}
