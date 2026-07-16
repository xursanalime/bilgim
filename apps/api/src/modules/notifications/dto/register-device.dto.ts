import { z } from 'zod';

/**
 * Body schema for `POST /notifications/devices` (Task 22.2, Req 16.1).
 *
 * The mobile app calls this endpoint after the user grants notification
 * permission and `expo-notifications` returns an `ExpoPushToken[...]`.
 * Re-registration with the same `token` is idempotent — the repository
 * upserts on `(userId, token)` and bumps `lastSeenAt`.
 *
 * `platform` is one of the values reported by `expo-device` (`ios`,
 * `android`, `web`). `deviceInfo` is the optional `expo-device`
 * metadata blob (modelName, osName, osVersion, appVersion, locale)
 * — useful for debugging delivery failures without needing extra
 * round-trips.
 */
export const RegisterDeviceSchema = z.object({
  token: z
    .string()
    .min(1)
    .max(512)
    // Expo tokens are usually `ExpoPushToken[<id>]`. We don't enforce
    // the exact format because future Expo SDK changes may tweak the
    // wrapper string and FCM/APNs tokens (used in custom dev builds)
    // do not start with `ExpoPushToken[` at all.
    .trim(),
  platform: z.enum(['ios', 'android', 'web']),
  deviceInfo: z.record(z.unknown()).optional().nullable(),
});

export type RegisterDeviceDto = z.infer<typeof RegisterDeviceSchema>;
