export { ProtectionModule } from './protection.module';
export {
  PROTECTION_PROVIDER,
  DRM_PROVIDER_NOT_CONFIGURED,
  DEV_FALLBACK_MARKER,
  isDevFallbackProviderFlag,
} from './protection.types';
export type {
  ProtectionProvider,
  IssueLicenseInput,
  DrmKeySystem,
} from './protection.types';
export { DevFallbackProtectionProvider } from './adapters/dev-fallback-protection.adapter';
export { WatermarkIdentityService } from './watermark-identity.service';
export type {
  AuthenticatedViewer,
  WatermarkIdentity,
  DeriveWatermarkInput,
  BindWatermarkSessionInput,
  BoundWatermarkSession,
} from './watermark-identity.service';
export { PlaybackSessionRepository } from './repositories/playback-session.repository';
export type { CreatePlaybackSessionInput } from './repositories/playback-session.repository';
export { PlaybackTicketService } from './playback-ticket.service';
export type {
  PlaybackTicket,
  TicketClaims,
  IssueTicketInput,
} from './playback-ticket.service';
export { PlaybackTicketController } from './playback-ticket.controller';
export type { PlaybackTicketRequest } from './playback-ticket.controller';
