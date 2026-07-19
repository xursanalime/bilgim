/**
 * `modules/security/gdpr` — Task 30.4 (GDPR Data Subject Rights).
 *
 * Public surface:
 *   - `GdprService` — main service for handling data subject requests
 *     (access, rectification, erasure, portability) with 30-day SLA.
 *   - `GdprController` — REST endpoints for submitting and managing
 *     GDPR data subject requests.
 *   - Types and interfaces for GDPR request lifecycle.
 */
export {
  GdprService,
  GDPR_REQUEST_STORE,
  USER_DATA_COLLECTORS,
  type GdprRequestStore,
  type UserDataCollector,
} from './gdpr.service';

export { GdprController } from './gdpr.controller';

export {
  DataSubjectRequestType,
  RequestStatus,
  ExportFormat,
  GDPR_SLA_DAYS,
  type DataSubjectRequest,
  type DataSubjectRequestMetadata,
  type AccessRequestMetadata,
  type RectificationRequestMetadata,
  type ErasureRequestMetadata,
  type PortabilityRequestMetadata,
  type CreateAccessRequestDto,
  type CreateRectificationRequestDto,
  type CreateErasureRequestDto,
  type CreatePortabilityRequestDto,
  type GdprExportData,
  type SlaStatus,
} from './gdpr-request.types';
