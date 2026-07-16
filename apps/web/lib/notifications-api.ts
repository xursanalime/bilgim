/**
 * Public re-export of the notifications API client (Task 25.6).
 *
 * The original client lives at `lib/api/notifications.ts`. The task
 * checklist asks for a `notifications-api.ts` module under `apps/web/lib`,
 * so this file forwards the typed surface under a single import.
 *
 * Endpoints wrapped (see `apps/api/src/modules/notifications/...`):
 *   GET    /notifications              → cursor-paginated inbox
 *   GET    /notifications/unread-count → bell badge
 *   PATCH  /notifications/:id/read     → mark single as read
 *   POST   /notifications/mark-all-read
 *   GET    /notifications/preferences
 *   PATCH  /notifications/preferences
 *   PUT    /notifications/preferences/:kind/:channel
 *
 * Note: the task description references `PATCH /notifications/read-all`,
 * but the API enforces `POST /notifications/mark-all-read`. The wrapper
 * `notificationsApi.markAllRead()` keeps the call site path-agnostic.
 */

export {
  notificationsApi,
  NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KIND_LABELS_UZ,
  NOTIFICATION_CHANNEL_LABELS_UZ,
  type NotificationItem,
  type NotificationKind,
  type NotificationChannel,
  type NotificationListResponse,
  type NotificationPreference,
  type BulkUpdateResponse,
} from './api/notifications';
