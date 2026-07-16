import {
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IpBlocklistService } from '../blocklist/ip-blocklist.service';
import { SiemService } from '../siem/siem.service';

/**
 * Optional config-bag interface — the service reads only the
 * narrow set of keys the threat-intel surface needs. Defaults to
 * `process.env` but can be swapped for a `ConfigService`-backed
 * adapter in tests so we don't depend on the global env schema
 * (the canonical schema in `config/env.schema.ts` doesn't yet
 * declare these keys; doing so is left to the operations rollout).
 */
export interface ThreatIntelConfig {
  abuseIpDbApiKey?: string | null;
  spamhausFeedUrl?: string | null;
  /**
   * Master kill-switch — when `false` the cron is a no-op even if
   * API keys are configured. Defaults to `false` so CI / local dev
   * never accidentally hits an upstream feed.
   */
  syncEnabled?: boolean;
}

function readDefaultConfig(): ThreatIntelConfig {
  return {
    abuseIpDbApiKey: process.env.ABUSEIPDB_API_KEY ?? null,
    spamhausFeedUrl:
      process.env.SPAMHAUS_FEED_URL ??
      // Backwards-compat with deployments that already set
      // SPAMHAUS_API_KEY — if it's present and non-empty we fall
      // back to the public DROP list URL.
      (process.env.SPAMHAUS_API_KEY
        ? 'https://www.spamhaus.org/drop/drop.txt'
        : null),
    syncEnabled:
      (process.env.THREAT_INTEL_SYNC_ENABLED ?? 'false').toLowerCase() ===
      'true',
  };
}

/**
 * Result of one feed pull. Surfaced for tests and ops dashboards so
 * we can assert the orchestration without inspecting Redis.
 */
export interface ThreatIntelSyncResult {
  feed: string;
  /** True when the sync ran end-to-end without a transport error. */
  ok: boolean;
  /** Number of distinct IPs successfully written to the blocklist. */
  imported: number;
  /** Reason the sync was skipped (no API key, dev mode, etc.). */
  skippedReason?: string;
  /** Error message when the sync failed. */
  error?: string;
}

/**
 * Optional fetcher seam — keeps the service unit-testable without
 * pulling a real `fetch` mock library. The default implementation
 * uses the global `fetch` provided by Node 18+.
 */
export type HttpFetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/** Public feed parsers — kept private to the module. */
interface FeedParser {
  feed: string;
  enabled(config: ThreatIntelConfig): {
    enabled: boolean;
    reason?: string;
  };
  fetch(args: {
    fetcher: HttpFetcher;
    config: ThreatIntelConfig;
  }): Promise<string[]>;
}

/**
 * `ThreatIntelService` — Task 27.5, Req 27.10.
 *
 * Periodically pulls known-bad IP lists from threat intelligence
 * feeds (AbuseIPDB blacklist, Spamhaus DROP) and pushes them into
 * `IpBlocklistService` with a 7-day TTL. The SIEM pipeline gets a
 * `security.threat_intel.sync.*` event for every run so the SOC can
 * see when feeds are stale.
 *
 * **Dev / local posture**: when neither feed has an API key
 * configured the service logs a single WARN line at startup and
 * skips the cron — local development keeps the platform's "no
 * required external dependencies" property.
 *
 * **Cron cadence**: 6 hours. Both feeds publish updates daily but
 * AbuseIPDB rate-limits the free tier to a few thousand entries per
 * day; a 6h cadence stays comfortably inside that budget.
 *
 * **Failure isolation**: each feed runs independently. A failure
 * pulling AbuseIPDB MUST NOT abort the Spamhaus pull, and vice
 * versa.
 */
@Injectable()
export class ThreatIntelService implements OnModuleInit {
  private readonly logger = new Logger(ThreatIntelService.name);

  /** Default TTL applied to imported IPs. Matches Req 27.10. */
  static readonly TTL_SEC = IpBlocklistService.DEFAULT_THREAT_INTEL_TTL_SEC;

  private fetcher: HttpFetcher;
  private readonly feeds: ReadonlyArray<FeedParser>;
  private intelConfig: ThreatIntelConfig;

  constructor(
    private readonly blocklist: IpBlocklistService,
    @Optional() private readonly siem?: SiemService,
  ) {
    // Bind to the global `fetch` lazily so tests that don't use the
    // real network never hit it.
    this.fetcher = globalThis.fetch
      ? (globalThis.fetch.bind(globalThis) as HttpFetcher)
      : async () => {
          throw new Error('fetch is not available in this runtime');
        };
    this.feeds = buildDefaultFeeds();
    this.intelConfig = readDefaultConfig();
  }

  /**
   * Override the HTTP fetcher and config — public seam used by the
   * unit tests so they don't need a network and can drive
   * deterministic feed responses. Production callers MUST NOT touch
   * this.
   */
  configureForTesting(args: {
    fetcher?: HttpFetcher;
    intelConfig?: ThreatIntelConfig;
  }): void {
    if (args.fetcher) this.fetcher = args.fetcher;
    if (args.intelConfig) this.intelConfig = args.intelConfig;
  }

  /**
   * Log a single line at startup so operators know whether the
   * service is in active or no-op mode. The cron itself runs
   * regardless — it just becomes a `skippedReason='no_api_key'`
   * round-trip when nothing is configured.
   */
  onModuleInit(): void {
    if (!this.intelConfig.syncEnabled) {
      this.logger.warn(
        'ThreatIntelService disabled (THREAT_INTEL_SYNC_ENABLED=false). Set the flag plus ABUSEIPDB_API_KEY and/or SPAMHAUS_FEED_URL to activate the periodic sync.',
      );
      return;
    }
    const hasAny = this.feeds.some(
      (feed) => feed.enabled(this.intelConfig).enabled,
    );
    if (!hasAny) {
      this.logger.warn(
        'ThreatIntelService running in NO-OP mode — no API keys configured (set ABUSEIPDB_API_KEY and/or SPAMHAUS_FEED_URL).',
      );
    } else {
      this.logger.log(
        `ThreatIntelService active with ${
          this.feeds.filter((f) => f.enabled(this.intelConfig).enabled).length
        } feed(s).`,
      );
    }
  }

  /**
   * Cron — every 6 hours. Wrapped to never throw; @nestjs/schedule
   * suppresses subsequent ticks' logs if a handler throws an
   * unhandled error.
   */
  @Cron(CronExpression.EVERY_6_HOURS, { name: 'security.threat-intel.sync' })
  async runSync(): Promise<void> {
    try {
      const results = await this.syncAll();
      for (const result of results) {
        if (result.skippedReason) {
          this.logger.debug(
            `runSync: ${result.feed} skipped: ${result.skippedReason}`,
          );
          continue;
        }
        if (!result.ok) {
          this.logger.warn(
            `runSync: ${result.feed} failed: ${result.error ?? 'unknown error'}`,
          );
          continue;
        }
        this.logger.log(
          `runSync: ${result.feed} imported ${result.imported} IP(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `runSync: top-level error: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Pull every configured feed once. Public so ops can trigger an
   * out-of-band sync (e.g. immediately after rotating an API key)
   * and tests can drive the orchestration deterministically.
   */
  async syncAll(): Promise<ThreatIntelSyncResult[]> {
    if (!this.intelConfig.syncEnabled) {
      return this.feeds.map((feed) => ({
        feed: feed.feed,
        ok: false,
        imported: 0,
        skippedReason: 'sync_disabled',
      }));
    }
    const out: ThreatIntelSyncResult[] = [];
    for (const feed of this.feeds) {
      out.push(await this.syncOne(feed));
    }
    return out;
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async syncOne(feed: FeedParser): Promise<ThreatIntelSyncResult> {
    const enabled = feed.enabled(this.intelConfig);
    if (!enabled.enabled) {
      return {
        feed: feed.feed,
        ok: false,
        imported: 0,
        skippedReason: enabled.reason ?? 'disabled',
      };
    }

    await this.emitSyncEvent('security.threat_intel.sync.started', feed.feed);

    let ips: string[] = [];
    try {
      ips = await feed.fetch({
        fetcher: this.fetcher,
        config: this.intelConfig,
      });
    } catch (err) {
      const error = (err as Error).message;
      await this.emitSyncEvent('security.threat_intel.sync.failed', feed.feed, {
        error,
      });
      return { feed: feed.feed, ok: false, imported: 0, error };
    }

    const imported = await this.blocklist.blockBulk(
      ips,
      ThreatIntelService.TTL_SEC,
      `Threat intel feed: ${feed.feed}`,
      `threat_intel:${feed.feed}`,
    );

    await this.emitSyncEvent(
      'security.threat_intel.sync.succeeded',
      feed.feed,
      { imported, fetched: ips.length },
    );

    return { feed: feed.feed, ok: true, imported };
  }

  private async emitSyncEvent(
    type:
      | 'security.threat_intel.sync.started'
      | 'security.threat_intel.sync.succeeded'
      | 'security.threat_intel.sync.failed',
    feed: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.siem) return;
    try {
      const severity = type === 'security.threat_intel.sync.failed'
        ? 'MEDIUM'
        : 'LOW';
      await this.siem.recordEvent({
        type,
        severity,
        ip: 'unknown',
        payload: { feed, ...extra },
      });
    } catch {
      // Telemetry failures must never abort the sync.
    }
  }
}

// =====================================================================
// Built-in feed parsers
// =====================================================================

function buildDefaultFeeds(): ReadonlyArray<FeedParser> {
  return [
    {
      feed: 'abuseipdb',
      enabled: (config) => {
        if (!config.abuseIpDbApiKey) {
          return { enabled: false, reason: 'no_api_key' };
        }
        return { enabled: true };
      },
      fetch: async ({ fetcher, config }) => {
        const apiKey = config.abuseIpDbApiKey ?? '';
        const response = await fetcher(
          'https://api.abuseipdb.com/api/v2/blacklist?confidenceMinimum=90',
          {
            headers: {
              Key: apiKey,
              Accept: 'application/json',
            },
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = (await response.json()) as {
          data?: Array<{ ipAddress?: string }>;
        };
        return (body.data ?? [])
          .map((entry) => entry.ipAddress)
          .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);
      },
    },
    {
      feed: 'spamhaus_drop',
      enabled: (config) => {
        // Spamhaus DROP doesn't require an API key but it does
        // require an explicit opt-in URL to avoid pulling it on
        // every dev install. Operators set SPAMHAUS_FEED_URL to
        // either the public DROP list or their internal mirror.
        if (!config.spamhausFeedUrl) {
          return { enabled: false, reason: 'no_feed_url' };
        }
        return { enabled: true };
      },
      fetch: async ({ fetcher, config }) => {
        const url = config.spamhausFeedUrl ?? '';
        const response = await fetcher(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.text();
        // DROP format is `<cidr> ; SBL<id>` per line — comments
        // start with `;`. We extract any `a.b.c.d/n` or bare
        // `a.b.c.d` token on each line.
        const out: string[] = [];
        for (const rawLine of body.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith(';') || line.startsWith('#')) continue;
          const match =
            line.match(/^(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)/) ?? null;
          if (match && match[1]) out.push(match[1]);
        }
        return out;
      },
    },
  ];
}
