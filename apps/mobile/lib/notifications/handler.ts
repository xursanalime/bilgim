/**
 * Notification handlers — foreground display, tap-to-deep-link routing.
 *
 * The fan-out worker on the backend sends every Notification with a
 * `data` payload that mirrors the in-app envelope:
 *
 *   data: { kind, notificationId, lessonId?, groupId?, assignmentId?, … }
 *
 * `kind` is one of the `NotificationKind` enum values from Prisma. We
 * route taps to the appropriate `expo-router` path (Task 22.1 layout):
 *
 *   - LESSON_PUBLISHED      → /(tabs)/courses (placeholder until lesson detail)
 *   - SCHEDULE_CHANGED      → /(tabs)/courses
 *   - HOMEWORK_ASSIGNED     → /(tabs)/courses
 *   - HOMEWORK_GRADED       → /(tabs)/courses
 *   - LIVE_STARTED          → /(tabs)/courses
 *   - LIVE_REMINDER         → /(tabs)/courses
 *   - everything else       → /(tabs) (home)
 *
 * The integration with the navigation tree happens in
 * `bootstrapPushNotifications` (which calls `router.push(target)` from
 * the singleton router instance).
 */

import * as Notifications from 'expo-notifications';

export interface NotificationDataPayload {
  kind?: string;
  notificationId?: string;
  lessonId?: string;
  groupId?: string;
  assignmentId?: string;
  liveSessionId?: string;
  scheduleId?: string;
  [key: string]: unknown;
}

export type DeepLinkTarget = string;

/**
 * Configure the foreground handler. By default, when the app is open
 * Expo silently drops the system banner — we override that so users see
 * the alert/sound regardless of foreground state.
 */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Resolve a deep-link path from a notification's `data` payload.
 * Returns `null` when the payload doesn't include enough info to deep
 * link (we keep the user on whatever screen they were on).
 */
export function resolveDeepLink(
  data: NotificationDataPayload | undefined | null,
): DeepLinkTarget | null {
  if (!data) return null;
  switch (data.kind) {
    case 'LESSON_PUBLISHED':
    case 'SCHEDULE_CHANGED':
    case 'LIVE_STARTED':
    case 'LIVE_REMINDER':
    case 'HOMEWORK_ASSIGNED':
    case 'HOMEWORK_GRADED':
      // The exact lesson/group/assignment screens are scaffolded in
      // later tasks (lesson detail, schedule, homework). For now we
      // route to the courses tab, where the targeted screens will
      // hang off as nested routes.
      return '/(tabs)/courses';
    case 'ENROLLMENT_APPROVED':
    case 'ENROLLMENT_REJECTED':
    case 'PAYMENT_SUCCEEDED':
    case 'PAYMENT_FAILED':
    case 'TRIAL_ENDING':
    case 'SUBSCRIPTION_PAST_DUE':
    case 'AI_REVIEW_READY':
      return '/(tabs)';
    default:
      return null;
  }
}
