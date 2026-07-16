export { AdminModule } from './admin.module';
export { AdminService } from './admin.service';
export { AdminOpsService } from './admin-ops.service';
export { AdminEnglishCatalogService } from './english-catalog.service';
export type { ModuleCatalogEntry } from './english-catalog.service';
export { AdminProtectionSessionsService } from './protection-sessions.service';
export type {
  ProtectionLearnerIdentity,
  ProtectionSessionLookupRow,
  IngestAnomalySignalsResult,
} from './protection-sessions.service';
export type {
  AdminUserSummary,
  PaginatedResult,
} from './admin.service';
export type {
  AdminTeacherSummary,
  AdminPaymentRow,
  AdminSystemStats,
} from './admin-ops.service';
export { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
export type { AuditAction, AuditContext } from './admin-audit.service';
export {
  ListUsersQuerySchema,
  type ListUsersQueryDto,
  UpdateUserStatusSchema,
  type UpdateUserStatusDto,
  CreateSpecialtySchema,
  type CreateSpecialtyDto,
  UpdateSpecialtySchema,
  type UpdateSpecialtyDto,
  BulkUpsertSpecialtyModulesAdminSchema,
  type BulkUpsertSpecialtyModulesAdminDto,
  ListAuditLogsQuerySchema,
  type ListAuditLogsQueryDto,
  CreatePlanSchema,
  type CreatePlanDto,
  UpdatePlanSchema,
  type UpdatePlanDto,
  ListTeachersQuerySchema,
  type ListTeachersQueryDto,
  ListPaymentsQuerySchema,
  type ListPaymentsQueryDto,
  ListFailedDeliveriesQuerySchema,
  type ListFailedDeliveriesQueryDto,
  ListPendingOutboxQuerySchema,
  type ListPendingOutboxQueryDto,
} from './dto';
