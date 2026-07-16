import { createHmac } from 'crypto';

import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAsset } from '@prisma/client';
import type { Response } from 'express';
import * as fc from 'fast-check';

import type { JwtPayload } from '../auth/tokens.service';
import { MediaAccessService } from '../media/media-access.service';
import { MediaAssetRepository } from '../media/repositories/media-asset.repository';
import {
  LicenseProxyController,
  PlaybackTicketVerifier,
  VerifiedPlaybackTicket,
} from './license-proxy.controller';
import { PlaybackTicketService } from './playback-ticket.service';
import { CreatePlaybackSessionInput } from './repositories/playback-session.repository';
import { PlaybackSessionRepository } from './repositories/playback-session.repository';
import {
  DrmKeySystem,
  IssueLicenseInput,
  PROTECTION_PROVIDER_UNAVAILABLE,
  ProtectionProvider,
} from './protection.types';
import { WatermarkIdentityService } from './watermark-identity.service';

/**
 * Property-based tests for the content-protection backend — Task 5.2.
 *
 * Drives the REAL `PlaybackTicketService` (and, for the security review,
 * the REAL `LicenseProxyController`) over mocked dependencies — mirroring
 * the established Task 2.4 harness/mocking style — and asserts:
 *
 *   • Property 5 — "Fail closed in production"            (Req 7.3).
 *   • Property 4 — "Watermark bound to session server-side" (Req 3.1).
 *   • Security review — no vendor key/credential/manifest URL leaks to any
 *     client-facing response                                (Req 2.2).
 *
 * fast-check generates a fresh world per run (arbitrary entitled
 * viewers/assets, environments, provider grades, and client-supplied
 * junk) and re-asserts the invariant on every replay.
 */

// ===========================================================================
// Shared leak detectors (reused from the Task 2.4 harness style)
// ===========================================================================

/**
 * Patterns that betray a permanent / directly addressable storage URL or a
 * server-side secret. A match anywhere in a client-facing payload is a
 * Property 2 / security-review (Req 2.2) violation.
 */
const LEAK_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'absolute http(s) URL', re: /https?:\/\//i },
  { name: 'S3 signature', re: /X-Amz-Signature/i },
  { name: 'S3 credential', re: /X-Amz-Credential/i },
  { name: 'R2 storage host', re: /r2\.cloudflarestorage/i },
  { name: 'S3 storage host', re: /\.s3[.-]/i },
  { name: 'api key', re: /api[_-]?key/i },
  { name: 'secret', re: /secret/i },
  { name: 'credential', re: /credential/i },
  { name: 'bearer token', re: /bearer\s/i },
  // Stand-ins for vendor license endpoints / content keys we plant in the
  // mocked provider so any accidental serialization is caught.
  { name: 'vendor license host', re: /drm-vendor\./i },
  { name: 'vendor content key', re: /VENDOR_CONTENT_KEY/i },
];

/** Recursively collect every string contained in a value. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

/** Assert no string in the payload matches any leak pattern. */
function assertNoLeak(strings: string[]): void {
  for (const s of strings) {
    for (const { name, re } of LEAK_PATTERNS) {
      if (re.test(s)) {
        throw new Error(
          `Leak detected (${name}) in client-facing payload: ${JSON.stringify(
            s,
          )}`,
        );
      }
    }
  }
}

// ===========================================================================
// Shared config + signing material
// ===========================================================================

const SIGNING_SECRET = 'pbt-failclosed-playback-ticket-signing-secret-0123456789';
const JWT_SECRET = 'pbt-failclosed-jwt-secret-0123456789-abcdef';

const BASE_CONFIG_VALUES: Record<string, unknown> = {
  PLAYBACK_TICKET_TTL_SECONDS: 120,
  PLAYBACK_TICKET_SIGNING_SECRET: SIGNING_SECRET,
  JWT_SECRET,
  WATERMARK_FORMAT: '{maskedEmail} • {sessionId}',
  API_URL: 'https://api.bilgim.uz',
};

/**
 * Build a ConfigService stub. `nodeEnv` is injected as the validated
 * `NODE_ENV` value so the SUT's `isProduction()` (which prefers the
 * ConfigService value) is driven deterministically.
 */
function buildConfig(nodeEnv: string): ConfigService {
  const values: Record<string, unknown> = {
    ...BASE_CONFIG_VALUES,
    NODE_ENV: nodeEnv,
  };
  return {
    get: <T>(key: string): T | undefined => values[key] as T,
  } as unknown as ConfigService;
}

/**
 * Recompute the server-side watermark binding tag exactly as
 * `WatermarkIdentityService.deriveTag` does: HMAC-SHA256 over the
 * (userId, enrollmentId, sessionId) triple keyed by the server secret,
 * hex, truncated to 32 chars. Used to prove the tag is a pure function of
 * the SESSION identity and never of any client-supplied input.
 */
function expectedTag(
  userId: string,
  enrollmentId: string | undefined,
  sessionId: string,
): string {
  const material = `${userId}:${enrollmentId ?? ''}:${sessionId}`;
  return createHmac('sha256', SIGNING_SECRET)
    .update(material)
    .digest('hex')
    .slice(0, 32);
}

interface PersistedSession {
  id: string;
  viewerUserId: string;
  enrollmentId: string | null;
  viewerTag: string;
}

interface Harness {
  service: PlaybackTicketService;
  resolvePlaybackAccess: jest.Mock;
  getSignedManifest: jest.Mock;
  sessionCreate: jest.Mock;
  bindWatermark: jest.Mock;
  persistedSessions: PersistedSession[];
}

interface HarnessOpts {
  nodeEnv: string;
  productionGrade: boolean;
  assetId: string;
  enrollmentId: string;
  downloadAllowed: boolean;
  /** When false the entitlement gate throws 403 (default true = APPROVED). */
  entitled?: boolean;
}

/**
 * Build a harness around the REAL `PlaybackTicketService`. The
 * `ProtectionProvider` is mocked to (a) advertise `productionGrade` per
 * the run and (b) return an OPAQUE manifest reference — plus we plant a
 * vendor-shaped secret/URL on the provider object so the security-review
 * sweep would catch any accidental serialization.
 */
function buildHarness(opts: HarnessOpts): Harness {
  const config = buildConfig(opts.nodeEnv);

  const entitled = opts.entitled ?? true;
  const resolvePlaybackAccess = jest.fn(async () => {
    if (entitled) {
      return {
        downloadAllowed: opts.downloadAllowed,
        enrollmentId: opts.enrollmentId,
      };
    }
    throw new ForbiddenException({
      code: 'MEDIA_ACCESS_DENIED',
      message: 'Access denied',
    });
  });
  const access = { resolvePlaybackAccess } as unknown as MediaAccessService;

  const assets = {
    findById: jest.fn(
      async (id: string): Promise<MediaAsset> =>
        ({ id, kind: 'VIDEO', status: 'UPLOADED' }) as MediaAsset,
    ),
  } as unknown as MediaAssetRepository;

  const persistedSessions: PersistedSession[] = [];
  const sessionCreate = jest.fn(async (input: CreatePlaybackSessionInput) => {
    persistedSessions.push({
      id: input.id,
      viewerUserId: input.viewerUserId,
      enrollmentId: input.enrollmentId ?? null,
      viewerTag: input.viewerTag,
    });
    return { ...input, issuedAt: new Date() };
  });
  const sessions = {
    create: sessionCreate,
  } as unknown as PlaybackSessionRepository;

  const watermark = new WatermarkIdentityService(config, sessions);

  const getSignedManifest = jest.fn(
    async (assetId: string, ttlSec: number) => ({
      manifestUrl: `mref:${encodeURIComponent(assetId)}:ttl${ttlSec}`,
    }),
  );
  const bindWatermark = jest.fn(async () => ({}));
  const provider = {
    productionGrade: opts.productionGrade,
    getSignedManifest,
    issueLicense: jest.fn(),
    bindWatermark,
    // Vendor-shaped secrets/URLs planted on the port object. They must NEVER
    // surface in a client-facing payload (security review, Req 2.2).
    __vendorLicenseUrl: 'https://drm-vendor.example/license',
    __vendorContentKey: 'VENDOR_CONTENT_KEY_abcdef0123456789',
  } as unknown as ProtectionProvider;

  const service = new PlaybackTicketService(
    config,
    access,
    assets,
    watermark,
    provider,
  );

  return {
    service,
    resolvePlaybackAccess,
    getSignedManifest,
    sessionCreate,
    bindWatermark,
    persistedSessions,
  };
}

const viewerArb = fc.record({
  sub: fc.uuid(),
  email: fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
      fc.constantFrom('com', 'uz', 'io', 'net'),
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`),
});

const NON_PRODUCTION_ENVS = ['development', 'test', 'dev', 'staging', ''] as const;

// process.env.NODE_ENV is driven via the ConfigService stub, but we also
// pin + restore it so a defensive `process.env` read inside the SUT can
// never bleed into (or out of) other suites.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

// ===========================================================================
// Property 5 — Fail closed in production
// ===========================================================================

describe('Property 5 — Fail closed in production [Validates: Requirements 7.3]', () => {
  it('P5a: production + NON-production-grade provider → ALWAYS 503 PROTECTION_PROVIDER_UNAVAILABLE, NO manifest signed, NO session persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        viewerArb,
        fc.uuid(),
        fc.option(fc.uuid(), { nil: undefined }),
        fc.boolean(),
        fc.uuid(),
        async (viewer, assetId, lessonId, downloadAllowed, enrollmentId) => {
          // Drive both the ConfigService stub and process.env to production.
          process.env.NODE_ENV = 'production';
          const h = buildHarness({
            nodeEnv: 'production',
            productionGrade: false,
            assetId,
            enrollmentId,
            downloadAllowed,
          });

          const viewerPayload: JwtPayload = {
            sub: viewer.sub,
            email: viewer.email,
            role: 'STUDENT',
          };

          let returned: unknown;
          let threw: unknown;
          try {
            returned = await h.service.issueTicket({
              viewer: viewerPayload,
              assetId,
              lessonId,
            });
          } catch (err) {
            threw = err;
          }

          // Fails closed: 503 with the actionable PROTECTION_PROVIDER_UNAVAILABLE
          // code, and NOTHING is returned.
          expect(returned).toBeUndefined();
          expect(threw).toBeInstanceOf(ServiceUnavailableException);
          const body = (threw as ServiceUnavailableException).getResponse();
          expect((body as { code?: string }).code).toBe(
            PROTECTION_PROVIDER_UNAVAILABLE,
          );

          // No unprotected fallback served: the fail-closed gate runs BEFORE
          // any manifest reference / watermark / session row is produced.
          expect(h.getSignedManifest).not.toHaveBeenCalled();
          expect(h.sessionCreate).not.toHaveBeenCalled();
          expect(h.bindWatermark).not.toHaveBeenCalled();
          expect(h.persistedSessions).toHaveLength(0);
        },
      ),
      { numRuns: 250 },
    );
  });

  it('P5b: production + production-grade provider → succeeds (entitled viewer gets a ticket + one persisted session)', async () => {
    await fc.assert(
      fc.asyncProperty(
        viewerArb,
        fc.uuid(),
        fc.boolean(),
        fc.uuid(),
        async (viewer, assetId, downloadAllowed, enrollmentId) => {
          process.env.NODE_ENV = 'production';
          const h = buildHarness({
            nodeEnv: 'production',
            productionGrade: true,
            assetId,
            enrollmentId,
            downloadAllowed,
          });

          const ticket = await h.service.issueTicket({
            viewer: { sub: viewer.sub, email: viewer.email, role: 'STUDENT' },
            assetId,
          });

          expect(typeof ticket.manifestRef).toBe('string');
          expect(h.getSignedManifest).toHaveBeenCalledTimes(1);
          expect(h.persistedSessions).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('P5c: non-production + NON-production-grade provider → the flagged dev fallback succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        viewerArb,
        fc.uuid(),
        fc.constantFrom(...NON_PRODUCTION_ENVS),
        fc.boolean(),
        fc.uuid(),
        async (viewer, assetId, nodeEnv, downloadAllowed, enrollmentId) => {
          process.env.NODE_ENV = nodeEnv;
          const h = buildHarness({
            nodeEnv,
            productionGrade: false,
            assetId,
            enrollmentId,
            downloadAllowed,
          });

          const ticket = await h.service.issueTicket({
            viewer: { sub: viewer.sub, email: viewer.email, role: 'STUDENT' },
            assetId,
          });

          // In dev/test the clearly-flagged fallback still issues a ticket.
          expect(typeof ticket.manifestRef).toBe('string');
          expect(h.getSignedManifest).toHaveBeenCalledTimes(1);
          expect(h.persistedSessions).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ===========================================================================
// Property 4 — Watermark bound to session server-side
// ===========================================================================

describe('Property 4 — Watermark bound to session server-side [Validates: Requirements 3.1, 3.3, 6.1]', () => {
  // Arbitrary CLIENT-SUPPLIED junk that the server MUST ignore when deriving
  // the watermark identity. Only ip/userAgent are client-influenced inputs to
  // issueTicket (forensic context); no field accepts a client-chosen tag.
  const junkArb = fc.string({ minLength: 1, maxLength: 40 });

  it('P4: every issued ticket carries a session-derived watermark tag; exactly one PlaybackSession is persisted bound to that tag; client-supplied junk is ignored', async () => {
    await fc.assert(
      fc.asyncProperty(
        viewerArb,
        fc.uuid(),
        fc.option(fc.uuid(), { nil: undefined }),
        fc.uuid(),
        fc.boolean(),
        junkArb, // client-supplied ip
        junkArb, // client-supplied userAgent
        async (
          viewer,
          assetId,
          lessonId,
          enrollmentId,
          downloadAllowed,
          junkIp,
          junkUserAgent,
        ) => {
          // Use the non-production fallback so an entitled viewer always gets
          // a ticket (Property 4 is orthogonal to the fail-closed gate).
          process.env.NODE_ENV = 'test';
          const h = buildHarness({
            nodeEnv: 'test',
            productionGrade: false,
            assetId,
            enrollmentId,
            downloadAllowed,
          });

          const ticket = await h.service.issueTicket({
            viewer: { sub: viewer.sub, email: viewer.email, role: 'STUDENT' },
            assetId,
            lessonId,
            ip: junkIp,
            userAgent: junkUserAgent,
          });

          // Exactly ONE PlaybackSession persisted per issued ticket (Req 6.1).
          expect(h.persistedSessions).toHaveLength(1);
          const row = h.persistedSessions[0]!;

          // The persisted row is bound to the ticket's tag, and to the
          // authenticated SESSION identity — not to any client input.
          expect(row.viewerTag).toBe(ticket.watermark.tag);
          expect(row.viewerUserId).toBe(viewer.sub);
          expect(row.enrollmentId).toBe(enrollmentId);

          // The tag is the server-side HMAC over (userId, enrollmentId,
          // sessionId). Recover sessionId from the overlay label
          // ('{maskedEmail} • {sessionId}') and recompute the tag: it must
          // match, proving the tag is a pure function of the SESSION
          // identity (Req 3.1).
          const sessionId = ticket.watermark.label.split(' • ')[1] ?? '';
          expect(sessionId).toBe(row.id);
          expect(ticket.watermark.tag).toBe(
            expectedTag(viewer.sub, enrollmentId, sessionId),
          );

          // The tag is an opaque 32-hex marker derived server-side (its
          // value is fully pinned by the `expectedTag(session...)` equality
          // above, so it cannot be a function of any client-supplied input).
          // It is additionally never byte-equal to client-supplied junk.
          expect(ticket.watermark.tag).toMatch(/^[0-9a-f]{32}$/);
          for (const junk of [junkIp, junkUserAgent, lessonId ?? '']) {
            if (junk.length > 0) {
              expect(ticket.watermark.tag).not.toBe(junk);
            }
          }

          // The visible label masks PII (never the raw email local-part).
          const [local] = viewer.email.split('@');
          if ((local ?? '').length > 1) {
            expect(ticket.watermark.label.includes(viewer.email)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ===========================================================================
// Security review — no vendor key / credential / manifest URL leaks (Req 2.2)
// ===========================================================================

describe('Security review — no vendor key/URL leaks to client responses [Validates: Requirements 2.2]', () => {
  it('SR1: PlaybackTicketService.issueTicket output never leaks a vendor key/credential/manifest URL', async () => {
    await fc.assert(
      fc.asyncProperty(
        viewerArb,
        fc.uuid(),
        fc.option(fc.uuid(), { nil: undefined }),
        fc.boolean(),
        fc.uuid(),
        async (viewer, assetId, lessonId, downloadAllowed, enrollmentId) => {
          process.env.NODE_ENV = 'production';
          const h = buildHarness({
            nodeEnv: 'production',
            productionGrade: true,
            assetId,
            enrollmentId,
            downloadAllowed,
          });

          const ticket = await h.service.issueTicket({
            viewer: { sub: viewer.sub, email: viewer.email, role: 'STUDENT' },
            assetId,
            lessonId,
          });

          // No string field anywhere in the client-facing ticket exposes a
          // vendor key/credential/URL or a permanent storage URL.
          assertNoLeak(collectStrings(ticket));

          // License endpoints are API-relative paths, never vendor URLs.
          for (const ep of Object.values(ticket.licenseEndpoints)) {
            expect(ep.startsWith('/media/assets/')).toBe(true);
          }
        },
      ),
      { numRuns: 250 },
    );
  });

  it('SR2: LicenseProxyController output (body + headers) is only the opaque blob and opaque-binary headers — no vendor key/URL leak', async () => {
    const KEY_SYSTEMS: DrmKeySystem[] = ['widevine', 'fairplay', 'playready'];
    const ASSET_ID = 'asset-sr2';
    const VIEWER_ID = 'viewer-sr2';
    const user: JwtPayload = {
      sub: VIEWER_ID,
      email: 'viewer@bilgim.uz',
      role: 'STUDENT',
    };
    const CHALLENGE_B64 = Buffer.from('eme-challenge-bytes').toString('base64');
    const SIGNED_TICKET = 'signed.playback.ticket';

    const licenseArb = fc
      .uint8Array({ minLength: 1, maxLength: 96 })
      .map((a) => Buffer.from(a));

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KEY_SYSTEMS),
        licenseArb,
        async (keySystem, licenseBytes) => {
          const issueLicense = jest.fn(
            async (_input: IssueLicenseInput): Promise<Buffer> => licenseBytes,
          );
          const provider = {
            productionGrade: true,
            getSignedManifest: jest.fn(),
            issueLicense,
            bindWatermark: jest.fn(),
            __vendorLicenseUrl: 'https://drm-vendor.example/license',
            __vendorContentKey: 'VENDOR_CONTENT_KEY_abcdef0123456789',
          } as unknown as ProtectionProvider;

          const verifyTicket = jest.fn(
            async (): Promise<VerifiedPlaybackTicket> => ({
              assetId: ASSET_ID,
              lessonId: 'lesson-1',
              viewerUserId: VIEWER_ID,
              viewerTag: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
              enrollmentId: 'enr-1',
              entitlementApproved: true,
              expiresAt: Date.now() + 60_000,
            }),
          );
          const verifier = {
            verifyTicket,
          } as unknown as PlaybackTicketVerifier;

          const controller = new LicenseProxyController(provider, verifier);
          const res = {
            setHeader: jest.fn(),
          } as unknown as Response & { setHeader: jest.Mock };

          const returned = await controller.issueLicense(
            ASSET_ID,
            keySystem,
            user,
            { challenge: CHALLENGE_B64 },
            SIGNED_TICKET,
            res,
          );

          // The body IS the opaque provider blob by identity — nothing else.
          expect(returned).toBe(licenseBytes);

          // Only opaque-binary headers, none leaking a vendor key/URL.
          const headerNames = res.setHeader.mock.calls.map((c) => c[0]);
          expect(new Set(headerNames)).toEqual(
            new Set(['Content-Type', 'Cache-Control']),
          );
          assertNoLeak(res.setHeader.mock.calls.flatMap((c) => c.map(String)));
        },
      ),
      { numRuns: 200 },
    );
  });
});
