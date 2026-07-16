import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaybackSession, Prisma, PrismaClient } from '@prisma/client';

// Read-only import of the protection module's provider-flag helper. The
// admin surface never touches the provider port itself — it only needs
// to know whether a real DRM_Provider is configured so the anomaly seam
// can fall back to a clearly-flagged dev no-op (Req 6.3, 7.2).
import { isDevFallbackProviderFlag } from '../protection';
import { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
import {
  IngestAnomalySignalsDto,
  LookupSessionsQueryDto,
} from './dto';
import { PaginatedResult } from './admin.service';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Learner identity behind a viewing session, masked for admin display.
 * Email/name are masked because the leak-investigation surface needs to
 * *identify* the learner (userId is authoritative) without splaying raw
 * PII across the admin UI / audit trail.
 */
export interface ProtectionLearnerIdentity {
  userId: string;
  maskedEmail: string;
  maskedName: string;
  role: string;
  status: string;
}

/** One PlaybackSession resolved back to a learner identity (Req 6.4). */
export interface ProtectionSessionLookupRow {
  session: {
    id: string;
    assetId: string;
    lessonId: string | null;
    viewerUserId: string;
    enrollmentId: string | null;
    viewerTag: string;
    drmKeySystem: string | null;
    ip: string | null;
    userAgent: string | null;
    issuedAt: Date;
    expiresAt: Date;
  };
  learner: ProtectionLearnerIdentity | null;
  enrollment: {
    id: string;
    groupId: string;
    status: string;
  } | null;
  asset: {
    id: string;
    kind: string;
    status: string;
  } | null;
}

/** Outcome of an anomaly-signal ingest (Req 6.3). */
export interface IngestAnomalySignalsResult {
  /** Number of signals accepted from the caller. */
  accepted: number;
  /** Number of signals actually persisted/forwarded to a provider. */
  ingested: number;
  /**
   * True when no real DRM_Provider is configured and the batch was
   * accepted-and-dropped by the dev no-op rather than forwarded. The
   * field is explicit so neither an operator nor a log reader mistakes
   * the dev seam for production-grade anomaly handling (Req 7.2).
   */
  devNoop: boolean;
}

/**
 * Mask an email for admin display: `user@example.com` → `u***@e***.com`.
 * Mirrors the format used by `security/pii` so the admin surface reads
 * consistently with the rest of the platform's PII handling.
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return '***@***';

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  const domainParts = domain.split('.');
  const tld = domainParts.pop() ?? '';
  const domainName = domainParts.join('.');

  const maskedLocal = local.length > 0 ? `${local[0]}***` : '***';
  const maskedDomain = domainName.length > 0 ? `${domainName[0]}***` : '***';

  return `${maskedLocal}@${maskedDomain}.${tld}`;
}

/**
 * Mask a display name: keep the first character of each whitespace-token,
 * e.g. `Jane Doe` → `J*** D***`. Empty/blank names collapse to `***`.
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '***';
  return trimmed
    .split(/\s+/)
    .map((part) => (part.length > 0 ? `${part[0]}***` : '***'))
    .join(' ');
}

/**
 * AdminProtectionSessionsService — leak detection & response support
 * (content-protection-backend, Task 4.2 / Req 6.3, 6.4).
 *
 * Two responsibilities:
 *
 *   1. **Watermark/session → learner lookup (Req 6.4).** Given a
 *      `viewerTag` recovered from a leaked recording (or a `viewerUserId`
 *      / `assetId`), resolve the recorded `PlaybackSession` rows back to
 *      the learner identity that was bound to the stream. Every lookup
 *      touches learner PII, so every lookup is written to the admin
 *      audit log (who looked up which marker, and how many rows it
 *      matched) — the audit row records the *marker*, never the resolved
 *      PII, keeping the trail minimal.
 *
 *   2. **Provider anomaly/concurrency ingestion (Req 6.3).** A
 *      provider-agnostic seam that accepts concurrency/anomaly signals.
 *      The DRM_Provider is an Open Question (requirements OQ1), so this
 *      is implemented as a vendor-neutral DTO + a dev no-op: until a real
 *      provider adapter is wired, signals are accepted, audited, and
 *      dropped (clearly flagged `devNoop: true`) rather than hardcoding a
 *      vendor integration.
 *
 * The service performs **reads only** over `PlaybackSession` / `User` /
 * `Enrollment` / `MediaAsset` plus the append-only audit write; it never
 * mutates a viewing session.
 */
@Injectable()
export class AdminProtectionSessionsService {
  private readonly logger = new Logger(AdminProtectionSessionsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly adminAuditService: AdminAuditService,
    private readonly configService: ConfigService,
  ) {}

  // ==================================================================
  // Watermark / session → learner lookup (Req 6.4)
  // ==================================================================

  /**
   * Look up the `PlaybackSession` rows matching a watermark/session
   * marker and resolve each back to its learner identity.
   *
   * Always audit-logged (PII access). Returns an empty page — never an
   * error — when the marker matches nothing, so an investigator can tell
   * "no such session" apart from a failure.
   */
  async lookupSessions(
    actorId: string,
    query: LookupSessionsQueryDto,
    context: { ip?: string | null } = {},
  ): Promise<PaginatedResult<ProtectionSessionLookupRow>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.PlaybackSessionWhereInput = {
      ...(query.viewerTag !== undefined && { viewerTag: query.viewerTag }),
      ...(query.viewerUserId !== undefined && {
        viewerUserId: query.viewerUserId,
      }),
      ...(query.assetId !== undefined && { assetId: query.assetId }),
    };

    const [sessions, total] = await Promise.all([
      this.prisma.playbackSession.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.playbackSession.count({ where }),
    ]);

    const items = await this.resolveSessions(sessions);

    // PII access: record who looked up what marker and how many rows it
    // matched. We log the *marker*, never the resolved learner PII.
    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.PROTECTION_SESSION_LOOKUP,
      'PlaybackSession/lookup',
      {
        filter: {
          ...(query.viewerTag !== undefined && { viewerTag: query.viewerTag }),
          ...(query.viewerUserId !== undefined && {
            viewerUserId: query.viewerUserId,
          }),
          ...(query.assetId !== undefined && { assetId: query.assetId }),
        },
        matched: total,
      },
      { ip: context.ip ?? null },
    );

    this.logger.log(
      `Protection session lookup by admin ${actorId}: matched=${total}`,
    );

    return { items, page, pageSize, total };
  }

  /**
   * Look up a single `PlaybackSession` by its id and resolve the learner
   * identity. Throws `404` when the id is unknown (a single-resource GET
   * is expected to 404, unlike the marker-search above which returns an
   * empty page). Audit-logged because it touches learner PII.
   */
  async getSessionById(
    actorId: string,
    sessionId: string,
    context: { ip?: string | null } = {},
  ): Promise<ProtectionSessionLookupRow> {
    const session = await this.prisma.playbackSession.findUnique({
      where: { id: sessionId },
    });

    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.PROTECTION_SESSION_LOOKUP,
      `PlaybackSession/${sessionId}`,
      { sessionId, matched: session ? 1 : 0 },
      { ip: context.ip ?? null },
    );

    if (!session) {
      throw new NotFoundException({
        code: 'PLAYBACK_SESSION_NOT_FOUND',
        message: `Playback session ${sessionId} not found`,
      });
    }

    const [row] = await this.resolveSessions([session]);
    // `resolveSessions` always returns one row per input session.
    return row as ProtectionSessionLookupRow;
  }

  // ==================================================================
  // Provider anomaly / concurrency ingestion (Req 6.3) — dev no-op seam
  // ==================================================================

  /**
   * Ingest provider concurrency/anomaly signals (Req 6.3).
   *
   * This is the provider-agnostic seam. Because the DRM_Provider is an
   * Open Question, there is no vendor integration to forward to yet: when
   * no real provider is configured the batch is accepted, audited, and
   * dropped (`devNoop: true`). A real adapter slots in here — validate
   * the signals (already done by the Zod DTO), correlate them to
   * `PlaybackSession` rows by `sessionId` / `viewerTag` / `assetId`, and
   * persist/forward — without changing the controller or DTO contract.
   */
  async ingestAnomalySignals(
    actorId: string,
    dto: IngestAnomalySignalsDto,
    context: { ip?: string | null } = {},
  ): Promise<IngestAnomalySignalsResult> {
    const devNoop = this.isDevFallback();
    const accepted = dto.signals.length;
    // Dev seam: nothing is persisted/forwarded until a real provider
    // adapter is wired. Once one exists, replace this branch with the
    // adapter call and set `ingested` to the forwarded count.
    const ingested = devNoop ? 0 : 0;

    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.PROTECTION_ANOMALY_INGESTED,
      'ProtectionAnomalySignals/ingest',
      {
        ...(dto.source !== undefined && { source: dto.source }),
        accepted,
        ingested,
        devNoop,
        kinds: dto.signals.map((s) => s.kind),
      },
      { ip: context.ip ?? null },
    );

    if (devNoop) {
      this.logger.warn(
        `Anomaly signals accepted by DEV NO-OP seam (no DRM_Provider configured): accepted=${accepted} by admin ${actorId}`,
      );
    } else {
      this.logger.log(
        `Anomaly signals ingested: accepted=${accepted} ingested=${ingested} by admin ${actorId}`,
      );
    }

    return { accepted, ingested, devNoop };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Resolve a batch of sessions into lookup rows, batch-fetching the
   * referenced users / enrollments / assets to avoid an N+1 read.
   * `PlaybackSession` holds only scalar FKs (`viewerUserId`,
   * `enrollmentId`) to keep the trace table cheap, so the joins are done
   * here.
   */
  private async resolveSessions(
    sessions: PlaybackSession[],
  ): Promise<ProtectionSessionLookupRow[]> {
    if (sessions.length === 0) return [];

    const userIds = [...new Set(sessions.map((s) => s.viewerUserId))];
    const enrollmentIds = [
      ...new Set(
        sessions
          .map((s) => s.enrollmentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const assetIds = [...new Set(sessions.map((s) => s.assetId))];

    const [users, enrollments, assets] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
        },
      }),
      enrollmentIds.length > 0
        ? this.prisma.enrollment.findMany({
            where: { id: { in: enrollmentIds } },
            select: { id: true, groupId: true, status: true },
          })
        : Promise.resolve(
            [] as Array<{ id: string; groupId: string; status: string }>,
          ),
      this.prisma.mediaAsset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, kind: true, status: true },
      }),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));
    const enrollmentById = new Map(enrollments.map((e) => [e.id, e]));
    const assetById = new Map(assets.map((a) => [a.id, a]));

    return sessions.map((s) => {
      const user = userById.get(s.viewerUserId);
      const enrollment =
        s.enrollmentId !== null ? enrollmentById.get(s.enrollmentId) : undefined;
      const asset = assetById.get(s.assetId);

      return {
        session: {
          id: s.id,
          assetId: s.assetId,
          lessonId: s.lessonId,
          viewerUserId: s.viewerUserId,
          enrollmentId: s.enrollmentId,
          viewerTag: s.viewerTag,
          drmKeySystem: s.drmKeySystem,
          ip: s.ip,
          userAgent: s.userAgent,
          issuedAt: s.issuedAt,
          expiresAt: s.expiresAt,
        },
        learner: user
          ? {
              userId: user.id,
              maskedEmail: maskEmail(user.email),
              maskedName: maskName(user.fullName),
              role: user.role,
              status: user.status,
            }
          : null,
        enrollment: enrollment
          ? {
              id: enrollment.id,
              groupId: enrollment.groupId,
              status: enrollment.status,
            }
          : null,
        asset: asset
          ? { id: asset.id, kind: asset.kind, status: asset.status }
          : null,
      };
    });
  }

  /**
   * Whether the platform is running on the clearly-flagged development
   * fallback (no real DRM_Provider configured). Reads the `DRM_PROVIDER`
   * flag defensively via the protection module's helper.
   */
  private isDevFallback(): boolean {
    const flag = this.configService.get<string>('DRM_PROVIDER');
    return isDevFallbackProviderFlag(flag);
  }
}
