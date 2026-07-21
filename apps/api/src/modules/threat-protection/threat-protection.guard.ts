import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import {
  InspectableRequest,
  THREAT_PROTECTION_CONSTANTS,
  ThreatProtectionService,
  WafBlockEntry,
  WafBlockReason,
  WafDetection,
} from './threat-protection.service';

/**
 * Action label written into `AdminAuditLog.action`. Kept centralised so
 * the admin UI / SIEM consumers know to look for one stable string.
 */
export const WAF_AUDIT_ACTIONS = {
  REQUEST_BLOCKED: 'waf.request.blocked',
  IP_BLOCKED: 'waf.ip.blocked',
  IP_UNBLOCKED: 'waf.ip.unblocked',
} as const;

/**
 * Global guard that runs before every controller (Task 27.1).
 *
 * Order of operations on each request:
 *   1. **Allow-list bypass** — internal CIDRs from `WAF_ALLOWLIST` and
 *      loopback skip every check. This is intentionally checked first
 *      so an internal monitoring agent can't accidentally lock itself
 *      out by hitting a tripwire.
 *   2. **Persistent blocklist** — if `waf:blocked:{ip}` exists, return
 *      403 immediately. The blocklist TTL is the single source of
 *      truth for "still blocked"; we don't second-guess it.
 *   3. **Burst counter** — every request bumps `waf:burst:{ip}`. When
 *      the count crosses `BURST_REQUESTS` inside `BURST_WINDOW_SEC`,
 *      we add the IP to the blocklist for `HOT_BLOCK_TTL_SEC` and
 *      return 403 *for the offending request*.
 *   4. **Connection cap** — concurrent connection counter. Same shape
 *      as burst, but counts in-flight requests.
 *   5. **Signature inspection** — runs the WAF rule table. A match
 *      returns 403 + emits an audit-log row. Repeat offenders (3 hits
 *      inside the window) are added to the blocklist.
 *
 * All audit-log writes are best-effort: a failure to write the row
 * MUST NOT mask the WAF block. The guard therefore wraps the prisma
 * call in try/catch and logs (but does not re-throw) on failure.
 */
@Injectable()
export class ThreatProtectionGuard implements CanActivate {
  private readonly logger = new Logger(ThreatProtectionGuard.name);

  constructor(
    private readonly threatProtection: ThreatProtectionService,
    @Optional() private readonly prisma?: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<InspectableRequest>();
    const ip = extractIp(request);

    // 1) Allow-list bypass.
    if (this.threatProtection.isAllowed(ip)) {
      return true;
    }

    // 2) Persistent block check.
    const existingBlock = await this.threatProtection.getBlockEntry(ip);
    if (existingBlock) {
      throw new HttpException(
        {
          code: 'IP_BLOCKED',
          message: 'Access denied — your IP has been blocked',
          reason: existingBlock.reason,
          expiresAt: existingBlock.expiresAt,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 3) Burst-rate check.
    const burstCount = await this.threatProtection.recordRequest(ip);
    if (burstCount > THREAT_PROTECTION_CONSTANTS.BURST_REQUESTS) {
      const entry = await this.threatProtection.blockIp(
        ip,
        'RATE_LIMIT_BURST',
        THREAT_PROTECTION_CONSTANTS.HOT_BLOCK_TTL_SEC,
      );
      this.logBlock(ip, request, 'RATE_LIMIT_BURST', { burstCount });
      throw new HttpException(
        {
          code: 'IP_BLOCKED',
          message:
            'Access denied — request rate exceeded. IP temporarily blocked.',
          reason: 'RATE_LIMIT_BURST',
          expiresAt: entry?.expiresAt,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 4) Connection-flood check.
    const connectionCount = await this.threatProtection.acquireConnection(ip);
    let connectionReleased = false;
    const release = async () => {
      if (connectionReleased) return;
      connectionReleased = true;
      await this.threatProtection.releaseConnection(ip);
    };

    if (
      connectionCount > THREAT_PROTECTION_CONSTANTS.MAX_CONCURRENT_CONNECTIONS
    ) {
      // Decrement straight away: this request will not run.
      await release();
      this.logBlock(ip, request, 'CONNECTION_FLOOD', { connectionCount });
      throw new HttpException(
        {
          code: 'IP_BLOCKED',
          message:
            'Access denied — too many concurrent connections from this IP',
          reason: 'CONNECTION_FLOOD',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Wire the response 'finish'/'close' events so the connection
    // counter decrements when the request ends. We attach to the
    // underlying socket because the Nest response object is not
    // reliably available here.
    this.attachConnectionRelease(context, release);

    // 5) Signature inspection.
    const detection = this.threatProtection.inspect(request);
    if (detection) {
      const offenderCount = await this.threatProtection.recordSignatureHit(ip);
      let blockEntry: WafBlockEntry | null = null;
      if (
        offenderCount >=
        THREAT_PROTECTION_CONSTANTS.REPEAT_OFFENDER_THRESHOLD
      ) {
        blockEntry = await this.threatProtection.blockIp(
          ip,
          'SIGNATURE_MATCH',
          THREAT_PROTECTION_CONSTANTS.SIGNATURE_BLOCK_TTL_SEC,
          { signatureId: detection.signatureId },
        );
      }
      this.logSignature(ip, request, detection, offenderCount, !!blockEntry);
      throw new HttpException(
        {
          code: 'WAF_BLOCKED',
          message: 'Request blocked by Web Application Firewall',
          signatureId: detection.signatureId,
          category: detection.category,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }

  // -----------------------------------------------------------------
  // Audit logging — best-effort, never blocks the WAF response
  // -----------------------------------------------------------------

  private async logSignature(
    ip: string,
    request: InspectableRequest,
    detection: WafDetection,
    offenderCount: number,
    autoBlocked: boolean,
  ): Promise<void> {
    if (!this.prisma) return;
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          actorId: null,
          action: WAF_AUDIT_ACTIONS.REQUEST_BLOCKED,
          target: ip,
          payload: {
            signatureId: detection.signatureId,
            category: detection.category,
            matchedAgainst: detection.matchedAgainst,
            sample: detection.sample,
            method: request.method ?? null,
            url: request.originalUrl ?? request.url ?? null,
            offenderCount,
            autoBlocked,
          },
          ip,
        },
      });
    } catch (err) {
      this.logger.warn(
        `WAF audit-log write failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  private async logBlock(
    ip: string,
    request: InspectableRequest,
    reason: WafBlockReason,
    extra: Record<string, unknown>,
  ): Promise<void> {
    if (!this.prisma) return;
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          actorId: null,
          action: WAF_AUDIT_ACTIONS.IP_BLOCKED,
          target: ip,
          payload: {
            reason,
            method: request.method ?? null,
            url: request.originalUrl ?? request.url ?? null,
            ...extra,
          },
          ip,
        },
      });
    } catch (err) {
      this.logger.warn(
        `WAF audit-log write failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Wire the connection-counter release into the response lifecycle.
   * If we can't get a hold of the response object (test contexts,
   * websockets), we eagerly release so the counter doesn't drift.
   */
  private attachConnectionRelease(
    context: ExecutionContext,
    release: () => Promise<void>,
  ): void {
    try {
      const response = context.switchToHttp().getResponse();
      const target = response?.on ? response : response?.res ?? null;
      if (target && typeof target.on === 'function') {
        const onDone = () => {
          void release();
        };
        target.on('finish', onDone);
        target.on('close', onDone);
        return;
      }
    } catch (err) {
      this.logger.debug(
        `attachConnectionRelease: falling back to eager release: ${(err as Error).message}`,
      );
    }
    // Fall-back: release on the next tick. Slightly inflates the
    // counter under load but never leaks.
    setImmediate(() => {
      void release();
    });
  }
}

/**
 * Pull the client IP out of the request, honouring the same shape the
 * rate-limit interceptor uses so we get the same number on both
 * layers. Returns the literal `'unknown'` when nothing is available
 * — that bucket then collects mis-routed / proxied traffic so the
 * blocklist still applies.
 */
function extractIp(request: InspectableRequest & { connection?: { remoteAddress?: string }; socket?: { remoteAddress?: string } }): string {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return (
    request.ip ??
    request.connection?.remoteAddress ??
    request.socket?.remoteAddress ??
    'unknown'
  );
}
