/**
 * Public barrel for the client-side content-protection abstraction
 * (`@/lib/media/protection`). The protected player + `useProtectedMedia` hook
 * (tasks 1.3/1.4) and the web BFF (task 1.2) import from HERE — keep this
 * export surface stable.
 */

export type {
  KeySystem,
  LicenseRequest,
  MediaProtectionProvider,
  PlaybackWatermark,
  ProtectedPlaybackRequest,
  ProtectedPlaybackTicket,
} from './types';
export { KEY_SYSTEMS } from './types';

export { isTicketExpired, ticketTimeToLiveMs } from './ticket-utils';

export {
  DEV_FALLBACK_MARKER,
  MockMediaProtectionProvider,
} from './mock-provider';
export type { MockMediaProtectionProviderOptions } from './mock-provider';
