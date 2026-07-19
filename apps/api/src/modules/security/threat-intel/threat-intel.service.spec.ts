import {
  ThreatIntelService,
  type HttpFetcher,
  type ThreatIntelConfig,
} from './threat-intel.service';
import { IpBlocklistService } from '../blocklist/ip-blocklist.service';

/**
 * Unit tests for `ThreatIntelService` (Task 27.5, Req 27.10).
 *
 * Covers:
 *   - No-op when sync is disabled / no API keys configured.
 *   - Spamhaus DROP feed parser strips comments, extracts CIDRs.
 *   - AbuseIPDB JSON parser yields the IP list.
 *   - Bulk-import path forwards to `IpBlocklistService.blockBulk`.
 *   - One feed's failure does not abort the other.
 *   - SIEM events are emitted at the start / end of each sync.
 */

function makeBlocklist() {
  return {
    blockBulk: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<IpBlocklistService>;
}

function makeSiem() {
  return {
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };
}

function makeFetcher(
  responses: Record<string, { ok: boolean; status?: number; body: unknown }>,
): HttpFetcher {
  return jest.fn(async (url: string) => {
    const match =
      Object.keys(responses).find((prefix) => url.startsWith(prefix)) ?? url;
    const response = responses[match];
    if (!response) {
      throw new Error(`unexpected url: ${url}`);
    }
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
      text: async () => String(response.body),
    };
  }) as unknown as HttpFetcher;
}

const SPAMHAUS_FIXTURE = `
; Spamhaus DROP List 2024-01-01
; (c) 2024 The Spamhaus Project
1.10.16.0/20 ; SBL232395
1.32.128.0/18 ; SBL286275

# trailing comment
2.56.192.0/22 ; SBL451111
`;

const ABUSEIPDB_FIXTURE = {
  data: [
    { ipAddress: '8.8.8.9', confidenceScore: 95 },
    { ipAddress: '1.2.3.4', confidenceScore: 100 },
    { foo: 'bar' }, // ignored — no ipAddress
  ],
};

// ---------------------------------------------------------------------

describe('ThreatIntelService — disabled / no-op', () => {
  it('returns sync_disabled for every feed when THREAT_INTEL_SYNC_ENABLED=false', async () => {
    const blocklist = makeBlocklist();
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      intelConfig: { syncEnabled: false } as ThreatIntelConfig,
    });

    const results = await service.syncAll();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.skippedReason === 'sync_disabled')).toBe(
      true,
    );
    expect(blocklist.blockBulk).not.toHaveBeenCalled();
  });

  it('returns no_api_key for AbuseIPDB when key is absent', async () => {
    const blocklist = makeBlocklist();
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      intelConfig: {
        syncEnabled: true,
        abuseIpDbApiKey: null,
        spamhausFeedUrl: null,
      },
    });

    const results = await service.syncAll();
    expect(results.find((r) => r.feed === 'abuseipdb')?.skippedReason).toBe(
      'no_api_key',
    );
    expect(
      results.find((r) => r.feed === 'spamhaus_drop')?.skippedReason,
    ).toBe('no_feed_url');
    expect(blocklist.blockBulk).not.toHaveBeenCalled();
  });
});

describe('ThreatIntelService — Spamhaus DROP parser', () => {
  it('extracts CIDRs from DROP feed and bulk-imports them', async () => {
    const blocklist = makeBlocklist();
    blocklist.blockBulk.mockResolvedValue(3);
    const fetcher = makeFetcher({
      'https://www.spamhaus.org/drop/drop.txt': {
        ok: true,
        body: SPAMHAUS_FIXTURE,
      },
    });
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        abuseIpDbApiKey: null,
        spamhausFeedUrl: 'https://www.spamhaus.org/drop/drop.txt',
      },
    });

    const [, spamhaus] = await service.syncAll();
    expect(spamhaus!.ok).toBe(true);
    expect(spamhaus!.imported).toBe(3);
    expect(blocklist.blockBulk).toHaveBeenCalledTimes(1);
    const ips = blocklist.blockBulk.mock.calls[0]![0];
    expect(ips).toEqual([
      '1.10.16.0/20',
      '1.32.128.0/18',
      '2.56.192.0/22',
    ]);
  });

  it('returns ok: false when Spamhaus returns a non-2xx', async () => {
    const blocklist = makeBlocklist();
    const fetcher = makeFetcher({
      'https://feed.example': {
        ok: false,
        status: 503,
        body: 'Service Unavailable',
      },
    });
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        spamhausFeedUrl: 'https://feed.example',
      },
    });

    const [, spamhaus] = await service.syncAll();
    expect(spamhaus!.ok).toBe(false);
    expect(spamhaus!.error).toContain('HTTP 503');
    expect(blocklist.blockBulk).not.toHaveBeenCalled();
  });
});

describe('ThreatIntelService — AbuseIPDB parser', () => {
  it('extracts ipAddress from each blacklist entry', async () => {
    const blocklist = makeBlocklist();
    blocklist.blockBulk.mockResolvedValue(2);
    const fetcher = makeFetcher({
      'https://api.abuseipdb.com': {
        ok: true,
        body: ABUSEIPDB_FIXTURE,
      },
    });
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        abuseIpDbApiKey: 'fake-key',
      },
    });

    const [abuseIp] = await service.syncAll();
    expect(abuseIp!.ok).toBe(true);
    expect(abuseIp!.imported).toBe(2);
    expect(blocklist.blockBulk).toHaveBeenCalledWith(
      ['8.8.8.9', '1.2.3.4'],
      ThreatIntelService.TTL_SEC,
      expect.stringContaining('abuseipdb'),
      'threat_intel:abuseipdb',
    );
  });

  it('passes the API key in the Key header', async () => {
    const blocklist = makeBlocklist();
    const fetcher = makeFetcher({
      'https://api.abuseipdb.com': {
        ok: true,
        body: { data: [] },
      },
    });
    const fetcherSpy = fetcher as unknown as jest.Mock;
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        abuseIpDbApiKey: 'super-secret',
      },
    });

    await service.syncAll();
    const init = fetcherSpy.mock.calls[0]![1] as {
      headers?: Record<string, string>;
    };
    expect(init.headers).toMatchObject({
      Key: 'super-secret',
      Accept: 'application/json',
    });
  });
});

describe('ThreatIntelService — failure isolation', () => {
  it('still pulls Spamhaus when AbuseIPDB throws', async () => {
    const blocklist = makeBlocklist();
    blocklist.blockBulk.mockResolvedValue(1);
    const fetcher = makeFetcher({
      'https://api.abuseipdb.com': {
        ok: false,
        status: 500,
        body: 'oops',
      },
      'https://feed.example': {
        ok: true,
        body: SPAMHAUS_FIXTURE,
      },
    });
    const service = new ThreatIntelService(blocklist);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        abuseIpDbApiKey: 'k',
        spamhausFeedUrl: 'https://feed.example',
      },
    });

    const [abuseIp, spamhaus] = await service.syncAll();
    expect(abuseIp!.ok).toBe(false);
    expect(spamhaus!.ok).toBe(true);
    expect(blocklist.blockBulk).toHaveBeenCalledTimes(1);
  });
});

describe('ThreatIntelService — SIEM events', () => {
  it('emits started / succeeded events for a successful pull', async () => {
    const blocklist = makeBlocklist();
    blocklist.blockBulk.mockResolvedValue(2);
    const siem = makeSiem();
    const fetcher = makeFetcher({
      'https://feed.example': { ok: true, body: SPAMHAUS_FIXTURE },
    });
    const service = new ThreatIntelService(blocklist, siem as never);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        spamhausFeedUrl: 'https://feed.example',
      },
    });

    await service.syncAll();

    const types = siem.recordEvent.mock.calls.map(
      (c: unknown[]) => (c[0] as { type: string }).type,
    );
    expect(types).toEqual(
      expect.arrayContaining([
        'security.threat_intel.sync.started',
        'security.threat_intel.sync.succeeded',
      ]),
    );
  });

  it('emits failed event when the feed throws', async () => {
    const blocklist = makeBlocklist();
    const siem = makeSiem();
    const fetcher = makeFetcher({
      'https://feed.example': { ok: false, status: 500, body: 'err' },
    });
    const service = new ThreatIntelService(blocklist, siem as never);
    service.configureForTesting({
      fetcher,
      intelConfig: {
        syncEnabled: true,
        spamhausFeedUrl: 'https://feed.example',
      },
    });

    await service.syncAll();

    const types = siem.recordEvent.mock.calls.map(
      (c: unknown[]) => (c[0] as { type: string }).type,
    );
    expect(types).toContain('security.threat_intel.sync.failed');
  });
});
