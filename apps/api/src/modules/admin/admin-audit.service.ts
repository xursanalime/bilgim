import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Optional context fields recorded alongside the action — currently the
 * caller's IP only, but the column on `AdminAuditLog` is intentionally
 * generic so additional context (user agent, request id) can be added
 * without schema migrations.
 */
export interface AuditContext {
  ip?: string | null;
}

/**
 * AdminAuditService — single write-path for `AdminAuditLog` rows
 * (Req 24.5, 21.9).
 *
 * Every admin mutation MUST flow through `log()`. Keeping the table
 * append-only and central makes it a reliable audit surface and frees
 * callers from worrying about schema details. The service accepts an
 * optional `Prisma.TransactionClient` so the audit row can be written
 * inside the same transaction as the mutation it describes — that is
 * the only way to guarantee the audit log is exactly as truthful as the
 * data it shadows.
 *
 * The action vocabulary is a flat list of dot-separated identifiers
 * mirroring the outbox-event style used elsewhere on the platform
 * (e.g. `user.status.changed`, `specialty.created`). The constants are
 * exported so the rest of the module references the same strings.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Append an audit-log entry. `payload` is stored verbatim in the
   * `payload Jsonb` column — callers should pass already-redacted data
   * (no raw secrets, no full user PII beyond the bare minimum needed
   * for moderation review).
   *
   * Failures are not allowed to mask the underlying mutation: if the
   * write throws inside a transaction the whole transaction rolls back,
   * but at the call site we surface the error to the caller verbatim so
   * the route still fails closed (no silent "succeeded but unaudited").
   */
  async log(
    actorId: string | null,
    action: string,
    target: string | null,
    payload: unknown,
    context: AuditContext = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.adminAuditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        target: target ?? null,
        // Prisma's `JsonNull` vs `null` distinction is irrelevant here —
        // either yields a NULL `payload` column. We pass undefined so
        // Prisma applies the column default when the caller has nothing
        // to record.
        ...(payload !== null &&
          payload !== undefined && {
            payload: payload as Prisma.InputJsonValue,
          }),
        ...(context.ip !== undefined && { ip: context.ip }),
      },
    });
    this.logger.debug(
      `audit: actor=${actorId ?? 'system'} action=${action} target=${target ?? '-'}`,
    );
  }
}

/**
 * Canonical action strings — kept centralised so service callers and
 * downstream consumers (UI, SIEM exports) speak the same vocabulary.
 */
export const AUDIT_ACTIONS = {
  USER_STATUS_CHANGED: 'user.status.changed',
  USER_BANNED: 'user.banned',
  USER_UNBANNED: 'user.unbanned',
  USER_ROLE_CHANGED: 'user.role.changed',
  SPECIALTY_CREATED: 'specialty.created',
  SPECIALTY_UPDATED: 'specialty.updated',
  SPECIALTY_DELETED: 'specialty.deleted',
  SPECIALTY_MODULES_UPDATED: 'specialty.modules.updated',
  PLAN_CREATED: 'plan.created',
  PLAN_UPDATED: 'plan.updated',
  // Operations actions (Task 23.1)
  NOTIFICATION_DELIVERY_RETRIED: 'notification.delivery.retried',
  // Reports / exports (Task 23.3)
  REPORT_EXPORTED: 'report.exported',
  // MFA lifecycle (Task 29.1)
  MFA_TOTP_ENABLED: 'mfa.totp.enabled',
  MFA_TOTP_DISABLED: 'mfa.totp.disabled',
  MFA_WEBAUTHN_REGISTERED: 'mfa.webauthn.registered',
  MFA_CREDENTIAL_REVOKED: 'mfa.credential.revoked',
  MFA_BACKUP_CODES_GENERATED: 'mfa.backup_codes.generated',
  MFA_BACKUP_CODE_USED: 'mfa.backup_code.used',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
