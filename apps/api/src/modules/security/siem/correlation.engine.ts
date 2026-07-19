import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';

import { SiemService } from './siem.service';
import {
  SIEM_CORRELATION_WINDOW_SEC,
  type SiemEventRecord,
  type SiemEventType,
} from './siem.types';

/**
 * Sliding-window correlation rule contract. Each rule receives the
 * triggering event plus the recent windows for IP and user (read
 * lazily from `SiemService`) and returns either `null` or the
 * follow-on event the engine should emit.
 */
interface CorrelationRule {
  /** Stable id for tests and ops dashboards. */
  id: string;
  /**
   * Filter — only invoke `evaluate()` when the trigger event type
   * matches. Reduces work on the high-volume LOW events.
   */
  trigger: ReadonlyArray<SiemEventType>;
  evaluate(args: {
    trigger: SiemEventRecord;
    ipWindow: SiemEventRecord[];
    userWindow: SiemEventRecord[];
  }): CorrelationMatch | null;
}

interface CorrelationMatch {
  type: SiemEventType;
  severity: 'HIGH' | 'CRITICAL';
  details: Record<string, unknown>;
}

/**
 * `CorrelationEngine` — Task 27.5, Req 27.7.
 *
 * Sliding-window event correlation. Each incoming event is evaluated
 * against a small set of curated rules; matches emit a HIGH-severity
 * follow-on `security.correlation.*` event back through the SIEM
 * service, which fans them out to Loki + Sentry.
 *
 * The engine is intentionally synchronous on the request path: the
 * windows it inspects are bounded (15 min, capped at 1000 events
 * per key) and the rule list is short, so a typical evaluation costs
 * a few microseconds plus one Redis `LRANGE`. Pushing this onto a
 * background queue would lose the per-request `traceId` correlation
 * the SOC dashboards rely on.
 *
 * **Re-entrancy**: a correlation match emits a new event, which
 * would re-enter `evaluate()` if we didn't gate it. The engine skips
 * triggers that are themselves correlation events, so the rule
 * fan-out stops at depth 1.
 */
@Injectable()
export class CorrelationEngine {
  private readonly logger = new Logger(CorrelationEngine.name);

  /** Per-(IP, ruleId) suppression so we don't spam matches. */
  private static readonly DEDUP_WINDOW_MS = 5 * 60 * 1000;

  private readonly rules: ReadonlyArray<CorrelationRule>;
  private readonly recentMatches = new Map<string, number>();

  constructor(
    @Optional()
    @Inject(forwardRef(() => SiemService))
    private readonly siem?: SiemService,
  ) {
    this.rules = buildDefaultRules();
  }

  /** Public entry — invoked by `SiemService.recordEvent`. */
  async evaluate(trigger: SiemEventRecord): Promise<void> {
    if (this.isCorrelationEvent(trigger.type)) {
      // Don't recurse — correlation events should not re-trigger
      // rules. Keeps the fan-out at depth 1.
      return;
    }
    if (!this.siem) return;

    const matchingRules = this.rules.filter((rule) =>
      rule.trigger.includes(trigger.type),
    );
    if (matchingRules.length === 0) return;

    // Read the windows once and reuse across rules.
    const [ipWindow, userWindow] = await Promise.all([
      this.siem.readRecentForIp(trigger.ip, SIEM_CORRELATION_WINDOW_SEC),
      trigger.userId
        ? this.siem.readRecentForUser(
            trigger.userId,
            SIEM_CORRELATION_WINDOW_SEC,
          )
        : Promise.resolve<SiemEventRecord[]>([]),
    ]);

    for (const rule of matchingRules) {
      const match = rule.evaluate({ trigger, ipWindow, userWindow });
      if (!match) continue;

      const dedupKey = `${rule.id}:${trigger.ip}:${trigger.userId ?? ''}`;
      if (this.isSuppressed(dedupKey)) continue;
      this.recentMatches.set(dedupKey, Date.now());

      try {
        await this.siem.recordEvent({
          type: match.type,
          severity: match.severity,
          ip: trigger.ip,
          userId: trigger.userId,
          traceId: trigger.traceId,
          payload: {
            ruleId: rule.id,
            triggerEvent: trigger.type,
            triggerOccurredAt: new Date(trigger.occurredAt).toISOString(),
            ...match.details,
          },
        });
      } catch (err) {
        this.logger.warn(
          `evaluate: emit failed for rule ${rule.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private isCorrelationEvent(type: SiemEventType): boolean {
    return type.startsWith('security.correlation.');
  }

  private isSuppressed(key: string): boolean {
    const last = this.recentMatches.get(key);
    if (!last) return false;
    if (Date.now() - last > CorrelationEngine.DEDUP_WINDOW_MS) {
      this.recentMatches.delete(key);
      return false;
    }
    return true;
  }
}

// =====================================================================
// Default rule set
// =====================================================================

/**
 * Curated rules called out in Task 27.5:
 *
 *   - **CREDENTIAL_STUFFING** — 5+ failed logins from the same IP
 *     across distinct accounts in 15 min. Already covered by
 *     `BruteForceService` (24h IP block at >=10), but the SIEM
 *     mirror surfaces the lower threshold for SOC visibility.
 *
 *   - **SESSION_HIJACK_SUSPECT** — failed login + IP change for the
 *     same user inside a 5 min window. Hints at session-token theft
 *     without an MFA challenge.
 *
 *   - **COORDINATED_ATTACK** — WAF detection + bot signal + auth
 *     failure from the same IP in the same window. Single sources
 *     spinning up multiple attack vectors warrant a CRITICAL alert.
 *
 *   - **AUTOMATED_SCANNER** — single IP touching 10+ honeypot
 *     endpoints. The honeypot controller already blocks on the
 *     first hit, but the cardinality threshold catches distributed
 *     scanners using round-robin IPs only after they've burned
 *     enough requests for the SOC to fingerprint.
 */
function buildDefaultRules(): ReadonlyArray<CorrelationRule> {
  return [
    {
      id: 'credential-stuffing-burst',
      trigger: ['security.auth.login.failed'],
      evaluate: ({ ipWindow }) => {
        const fails = ipWindow.filter(
          (e) => e.type === 'security.auth.login.failed',
        );
        if (fails.length < 5) return null;
        const distinct = new Set(
          fails
            .map((e) =>
              typeof e.payload?.['email'] === 'string'
                ? (e.payload['email'] as string)
                : null,
            )
            .filter((v): v is string => v !== null),
        );
        if (distinct.size < 5) return null;
        return {
          type: 'security.correlation.credential_stuffing',
          severity: 'HIGH',
          details: {
            failedLogins: fails.length,
            distinctAccounts: distinct.size,
            windowSec: SIEM_CORRELATION_WINDOW_SEC,
          },
        };
      },
    },
    {
      id: 'session-hijack-suspect',
      trigger: ['security.auth.login.failed', 'security.auth.session.ip_changed'],
      evaluate: ({ trigger, userWindow }) => {
        if (!trigger.userId) return null;
        // Look for both an auth failure AND an IP change inside a
        // 5 min slice for the same user.
        const fiveMinAgo = trigger.occurredAt - 5 * 60 * 1000;
        const recent = userWindow.filter((e) => e.occurredAt >= fiveMinAgo);
        const hasFail = recent.some(
          (e) => e.type === 'security.auth.login.failed',
        );
        const ipChanges = recent.filter(
          (e) => e.type === 'security.auth.session.ip_changed',
        );
        const distinctIps = new Set(recent.map((e) => e.ip));
        if (!hasFail || (ipChanges.length === 0 && distinctIps.size < 2))
          return null;
        return {
          type: 'security.correlation.session_hijack_suspect',
          severity: 'HIGH',
          details: {
            distinctIps: distinctIps.size,
            ipChangeEvents: ipChanges.length,
            windowSec: 5 * 60,
          },
        };
      },
    },
    {
      id: 'coordinated-attack',
      trigger: [
        'security.auth.login.failed',
        'security.waf.block',
        'security.waf.detected',
        'security.bot.detected',
      ],
      evaluate: ({ ipWindow }) => {
        const hasWaf = ipWindow.some(
          (e) =>
            e.type === 'security.waf.block' ||
            e.type === 'security.waf.detected',
        );
        const hasBot = ipWindow.some(
          (e) => e.type === 'security.bot.detected',
        );
        const hasAuthFail = ipWindow.some(
          (e) => e.type === 'security.auth.login.failed',
        );
        if (!(hasWaf && hasBot && hasAuthFail)) return null;
        return {
          type: 'security.correlation.coordinated_attack',
          severity: 'CRITICAL',
          details: {
            wafSignals: ipWindow.filter(
              (e) =>
                e.type === 'security.waf.block' ||
                e.type === 'security.waf.detected',
            ).length,
            botSignals: ipWindow.filter(
              (e) => e.type === 'security.bot.detected',
            ).length,
            authFailures: ipWindow.filter(
              (e) => e.type === 'security.auth.login.failed',
            ).length,
            windowSec: SIEM_CORRELATION_WINDOW_SEC,
          },
        };
      },
    },
    {
      id: 'automated-scanner',
      trigger: ['security.honeypot.hit'],
      evaluate: ({ ipWindow }) => {
        const hits = ipWindow.filter(
          (e) => e.type === 'security.honeypot.hit',
        );
        if (hits.length < 10) return null;
        const distinctPaths = new Set(
          hits
            .map((e) =>
              typeof e.payload?.['path'] === 'string'
                ? (e.payload['path'] as string)
                : null,
            )
            .filter((v): v is string => v !== null),
        );
        return {
          type: 'security.correlation.automated_scanner',
          severity: 'HIGH',
          details: {
            honeypotHits: hits.length,
            distinctPaths: distinctPaths.size,
            windowSec: SIEM_CORRELATION_WINDOW_SEC,
          },
        };
      },
    },
  ];
}
