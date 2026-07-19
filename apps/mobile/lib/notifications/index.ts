/**
 * Push notifications barrel — public surface for `apps/mobile/app/_layout`.
 *
 * Implementation lives in:
 *   - `./permissions` — request permission, return granted/denied
 *   - `./token` — getExpoPushToken + register with backend
 *   - `./handler` — foreground/background notification handlers + deep-link
 *   - `./bootstrap` — hook called once at app startup
 *
 * Re-exports are kept narrow so the layout file does not pull in the
 * Expo Notifications native module unless it actually needs to call
 * the bootstrap.
 */

export {
  bootstrapPushNotifications,
  type BootstrapResult,
} from './bootstrap';
export {
  registerExpoPushToken,
  unregisterExpoPushToken,
  getStoredPushToken,
} from './token';
export {
  resolveDeepLink,
  type DeepLinkTarget,
  type NotificationDataPayload,
} from './handler';
