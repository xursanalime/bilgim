import { ForbiddenException } from '@nestjs/common';
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
import { PlaybackSessionRepository } from './repositories/playback-session.repository';
import {
  DrmKeySystem,
  IssueLicenseInput,
  ProtectionProvider,
} from './protection.types';
import { WatermarkIdentityService } from './watermark-identity.service';

/**
 * Property-based tests for the content-protection backend — Task 2.4.
 *
 * Drives the REAL `PlaybackTicketService` and the REAL
 * `LicenseProxyController` over mocked dependencies (mirroring the
 * established unit-spec mocking style) and asserts the two security
 * invariants from `design.md`:
 *
 *   • Property 1 — "No media URL without entitlement" (Req 1.2, 1.1, 1.4).
 *   • Property 2 — "Keys stay server-side"            (Req 2.2, 2.3, 2.4).
 *
 * fast-check generates a fresh world per run (arbitrary entitlement
 * states, viewer/asset ids, ticket-validity outcomes, key systems) and we
 * re-assert the invariant on every replay.
 */

// ===========================================================================
// Shared leak detectors
// ===========================================================================

/**
 * Patterns that betray a permanent / directly addressable storage URL or a
 * server-side secret. A match anywhere in a client-facing payload is a
 * Property 1 / Property 2 violation.
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
// Property 1 — No media URL without entitlement
// ===========================================================================

describe('Property 1 — No media URL without entitlement [Validates: Requirements 1.2, 1.1, 1.4]', () => {
  type EntitlementState =
    | 'APPROVED'
    | 'NOT_APPROVED'
    | 'NO_ENROLLMENT'
    | 'REVOKED';

  const NON_APPROVED: EntitlementState[] = [
    'NOT_APPROVED',
    'NO_ENROLLMENT',
    'REVOKED',
  ];

  const CONFIG_VALUES: Record<string, unknown> = {
    PLAYBACK_TICKET_TTL_SECONDS: 120,
    PLAYBACK_TICKET_SIGNING_SECRET:
      'pbt-property-playback-ticket-signing-secret-0123456789',
    JWT_SECRET: 'pbt-property-jwt-secret-0123456789-abcdef',
    WATERMARK_FORMAT: '{maskedEmail} • {sessionId}',
    // A production-shaped API base. The service must NOT emit any absolute
    // URL of its own; the (mocked) provider returns an opaque reference so
    // a leak can only come from the SUT, never the dev-fallback proxy.
    API_URL: 'https://api.bilgim.uz',
  };

  function buildConfig(): ConfigService {
    return {
      get: <T>(key: string): T | undefined => CONFIG_VALUES[key] as T,
    } as unknown as ConfigService;
  }

  interface Harness {
    service: PlaybackTicketService;
    resolvePlaybackAccess: jest.Mock;
    getSignedManifest: jest.Mock;
    persistedSessions: Array<{ id: string; viewerTag: string }>;
  }

  /**
   * Build a harness around the REAL PlaybackTicketService. The
   * `ProtectionProvider` is mocked to return an OPAQUE, scheme-less
   * manifest reference: this isolates the property to the service's own
   * output, so any absolute URL / storage signature appearing in the
   * ticket is unambiguously a leak introduced by the SUT.
   */
  function buildHarness(
    state: EntitlementState,
    opts: { assetId: string; downloadAllowed: boolean; enrollmentId: string },
  ): Harness {
    const config = buildConfig();

    const resolvePlaybackAccess = jest.fn(async () => {
      if (state === 'APPROVED') {
        return {
          downloadAllowed: opts.downloadAllowed,
          enrollmentId: opts.enrollmentId,
        };
      }
      // Non-APPROVED entitlement → the access service throws, exactly as in
      // production (MEDIA_ACCESS_DENIED). The state name rides along so a
      // counterexample reveals which entitlement state slipped through.
      throw new ForbiddenException({
        code: 'MEDIA_ACCESS_DENIED',
        message: `Access denied (${state})`,
      });
    });

    const access = { resolvePlaybackAccess } as unknown as MediaAccessService;

    const assets = {
      findById: jest.fn(
        async (id: string): Promise<MediaAsset> =>
          ({ id, kind: 'VIDEO', status: 'UPLOADED' }) as MediaAsset,
      ),
    } as unknown as MediaAssetRepository;

    const persistedSessions: Array<{ id: string; viewerTag: string }> = [];
    const sessions = {
      create: jest.fn(async (input: { id: string; viewerTag: string }) => {
        persistedSessions.push({ id: input.id, viewerTag: input.viewerTag });
        return { ...input, issuedAt: new Date() };
      }),
    } as unknown as PlaybackSessionRepository;

    const watermark = new WatermarkIdentityService(config, sessions);

    const getSignedManifest = jest.fn(
      async (assetId: string, ttlSec: number) => ({
        // Opaque, NON-addressable proxied reference (no scheme, no host,
        // no storage key). Stands in for what a real provider adapter
        // returns through the port.
        manifestUrl: `mref:${encodeURIComponent(assetId)}:ttl${ttlSec}`,
      }),
    );
    const provider = {
      getSignedManifest,
      issueLicense: jest.fn(),
      bindWatermark: jest.fn(async () => ({})),
    } as unknown as ProtectionProvider;

    const service = new PlaybackTicketService(
      config,
      access,
      assets,
      watermark,
      provider,
    );

    return { service, resolvePlaybackAccess, getSignedManifest, persistedSessions };
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

  it('P1a: a NON-APPROVED viewer is denied (403) with NO payload and NO PlaybackSession persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_APPROVED),
        viewerArb,
        fc.uuid(),
        fc.option(fc.uuid(), { nil: undefined }),
        fc.boolean(),
        async (state, viewer, assetId, lessonId, downloadAllowed) => {
          const h = buildHarness(state, {
            assetId,
            downloadAllowed,
            enrollmentId: 'enr-x',
          });

          const viewerPayload: JwtPayload = {
            sub: viewer.sub,
            email: viewer.email,
            role: 'STUDENT',
          };

          let threw: unknown;
          let returned: unknown;
          try {
            returned = await h.service.issueTicket({
              viewer: viewerPayload,
              assetId,
              lessonId,
            });
          } catch (err) {
            threw = err;
          }

          // Denied with a 403 authorization error...
          expect(returned).toBeUndefined();
          expect(threw).toBeInstanceOf(ForbiddenException);

          // ...and the entitlement gate short-circuited EVERYTHING: no
          // manifest reference signed, no PlaybackSession persisted (so no
          // media URL of any kind was produced).
          expect(h.getSignedManifest).not.toHaveBeenCalled();
          expect(h.persistedSessions).toHaveLength(0);
        },
      ),
      { numRuns: 250 },
    );
  });

  it('P1b: an APPROVED viewer gets a ticket whose every string field leaks NO permanent/addressable storage URL, and a PlaybackSession is persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        viewerArb,
        fc.uuid(),
        fc.option(fc.uuid(), { nil: undefined }),
        fc.boolean(),
        fc.uuid(),
        async (viewer, assetId, lessonId, downloadAllowed, enrollmentId) => {
          const h = buildHarness('APPROVED', {
            assetId,
            downloadAllowed,
            enrollmentId,
          });

          const viewerPayload: JwtPayload = {
            sub: viewer.sub,
            email: viewer.email,
            role: 'STUDENT',
          };

          const ticket = await h.service.issueTicket({
            viewer: viewerPayload,
            assetId,
            lessonId,
          });

          // A ticket is returned with a (short-lived) manifest reference.
          expect(typeof ticket.manifestRef).toBe('string');
          expect(ticket.manifestRef.length).toBeGreaterThan(0);

          // No string field anywhere in the client-facing ticket exposes a
          // permanent/addressable storage URL or a server-side secret
          // (Req 1.4). This includes the manifest reference, license
          // endpoints (must be API-relative), watermark label/tag, and the
          // signed ticket token itself.
          assertNoLeak(collectStrings(ticket));

          // License endpoints are API-relative paths, never vendor URLs.
          for (const ep of Object.values(ticket.licenseEndpoints)) {
            expect(ep.startsWith('/media/assets/')).toBe(true);
          }

          // downloadAllowed mirrors the server-authoritative grant.
          expect(ticket.downloadAllowed).toBe(downloadAllowed);

          // Entitlement was resolved BEFORE any manifest reference existed.
          expect(h.resolvePlaybackAccess).toHaveBeenCalledTimes(1);
          expect(h.getSignedManifest).toHaveBeenCalledTimes(1);

          // Exactly one PlaybackSession persisted, bound to the ticket tag.
          expect(h.persistedSessions).toHaveLength(1);
          expect(h.persistedSessions[0]!.viewerTag).toBe(ticket.watermark.tag);
        },
      ),
      { numRuns: 250 },
    );
  });
});

// ===========================================================================
// Property 2 — Keys stay server-side
// ===========================================================================

describe('Property 2 — Keys stay server-side [Validates: Requirements 2.2, 2.3, 2.4]', () => {
  const ASSET_ID = 'asset-prop2';
  const VIEWER_ID = 'viewer-prop2';

  const KEY_SYSTEMS: DrmKeySystem[] = ['widevine', 'fairplay', 'playready'];

  type ValidityOutcome =
    | 'VALID'
    | 'VERIFIER_THROWS'
    | 'EXPIRED'
    | 'ASSET_MISMATCH'
    | 'VIEWER_MISMATCH'
    | 'ENTITLEMENT_NOT_APPROVED'
    | 'MISSING_TICKET';

  const user: JwtPayload = {
    sub: VIEWER_ID,
    email: 'viewer@bilgim.uz',
    role: 'STUDENT',
  };

  function baseClaims(): VerifiedPlaybackTicket {
    return {
      assetId: ASSET_ID,
      lessonId: 'lesson-1',
      viewerUserId: VIEWER_ID,
      viewerTag: 'v***@bilgim.uz • sess-1',
      enrollmentId: 'enr-1',
      entitlementApproved: true,
      expiresAt: Date.now() + 60_000,
    };
  }

  function makeRes(): Response & { setHeader: jest.Mock } {
    return {
      setHeader: jest.fn(),
    } as unknown as Response & { setHeader: jest.Mock };
  }

  function buildController(
    outcome: ValidityOutcome,
    licenseBytes: Buffer,
  ): {
    controller: LicenseProxyController;
    issueLicense: jest.Mock;
    verifyTicket: jest.Mock;
  } {
    const issueLicense = jest.fn(
      async (_input: IssueLicenseInput): Promise<Buffer> => licenseBytes,
    );

    const verifyTicket = jest.fn(
      async (_signed: string): Promise<VerifiedPlaybackTicket> => {
        switch (outcome) {
          case 'VERIFIER_THROWS':
            throw new Error('forged/invalid ticket');
          case 'EXPIRED':
            return { ...baseClaims(), expiresAt: Date.now() - 1_000 };
          case 'ASSET_MISMATCH':
            return { ...baseClaims(), assetId: 'a-different-asset' };
          case 'VIEWER_MISMATCH':
            return { ...baseClaims(), viewerUserId: 'a-different-viewer' };
          case 'ENTITLEMENT_NOT_APPROVED':
            return {
              ...baseClaims(),
              entitlementApproved: false,
              entitlementStatus: 'PENDING',
            };
          case 'VALID':
          default:
            return baseClaims();
        }
      },
    );

    const provider = {
      getSignedManifest: jest.fn(),
      issueLicense,
      bindWatermark: jest.fn(),
    } as unknown as ProtectionProvider;

    const verifier = { verifyTicket } as unknown as PlaybackTicketVerifier;

    return {
      controller: new LicenseProxyController(provider, verifier),
      issueLicense: issueLicense as jest.Mock,
      verifyTicket: verifyTicket as jest.Mock,
    };
  }

  const CHALLENGE_B64 = Buffer.from('eme-challenge-bytes').toString('base64');
  const SIGNED_TICKET = 'signed.playback.ticket';

  // Opaque license blob the (mocked) provider returns. Random bytes stand
  // in for a real vendor license — passed through verbatim, nothing else.
  const licenseArb = fc
    .uint8Array({ minLength: 1, maxLength: 96 })
    .map((a) => Buffer.from(a));

  it('P2a: license bytes are returned ONLY for a valid ticket+entitlement; all other outcomes refuse with 403 and NO bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<ValidityOutcome>(
          'VALID',
          'VERIFIER_THROWS',
          'EXPIRED',
          'ASSET_MISMATCH',
          'VIEWER_MISMATCH',
          'ENTITLEMENT_NOT_APPROVED',
          'MISSING_TICKET',
        ),
        fc.constantFrom(...KEY_SYSTEMS),
        licenseArb,
        async (outcome, keySystem, licenseBytes) => {
          const { controller, issueLicense } = buildController(
            outcome,
            licenseBytes,
          );
          const res = makeRes();

          // MISSING_TICKET → no header and no body ticket field.
          const ticketHeader =
            outcome === 'MISSING_TICKET' ? undefined : SIGNED_TICKET;

          let returned: Buffer | undefined;
          let threw: unknown;
          try {
            returned = await controller.issueLicense(
              ASSET_ID,
              keySystem,
              user,
              { challenge: CHALLENGE_B64 },
              ticketHeader,
              res,
            );
          } catch (err) {
            threw = err;
          }

          if (outcome === 'VALID') {
            // Pass-through: EXACTLY the provider's opaque blob, nothing
            // wrapped or added.
            expect(threw).toBeUndefined();
            expect(returned).toBe(licenseBytes);
            expect(issueLicense).toHaveBeenCalledTimes(1);

            // The provider received the server-derived viewerTag (never a
            // client-chosen identity).
            const input = issueLicense.mock.calls[0]![0] as IssueLicenseInput;
            expect(input.viewerTag).toBe(baseClaims().viewerTag);
            expect(input.keySystem).toBe(keySystem);

            // No client-facing header leaks a provider key/credential/URL —
            // only the opaque-binary content headers are set.
            const headerStrings = res.setHeader.mock.calls.flatMap((c) =>
              c.map(String),
            );
            assertNoLeak(headerStrings);
            expect(res.setHeader).toHaveBeenCalledWith(
              'Content-Type',
              'application/octet-stream',
            );
            expect(res.setHeader).toHaveBeenCalledWith(
              'Cache-Control',
              'no-store',
            );
          } else {
            // Every invalid/expired/mismatched/missing outcome → refuse:
            // 403, NO license bytes, provider NEVER reached (Req 2.4).
            expect(returned).toBeUndefined();
            expect(threw).toBeInstanceOf(ForbiddenException);
            expect(issueLicense).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 250 },
    );
  });

  it('P2b: even when the provider hands back a blob, the client-facing response is ONLY that opaque blob plus opaque-binary headers (no extra leak)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KEY_SYSTEMS),
        licenseArb,
        async (keySystem, licenseBytes) => {
          const { controller } = buildController('VALID', licenseBytes);
          const res = makeRes();

          const returned = await controller.issueLicense(
            ASSET_ID,
            keySystem,
            user,
            { challenge: CHALLENGE_B64 },
            SIGNED_TICKET,
            res,
          );

          // The response body IS the provider blob by identity — the
          // controller serializes nothing else to the client.
          expect(returned).toBe(licenseBytes);

          // Only two headers, both opaque-binary, neither leaking secrets.
          const headerNames = res.setHeader.mock.calls.map((c) => c[0]);
          expect(new Set(headerNames)).toEqual(
            new Set(['Content-Type', 'Cache-Control']),
          );
          assertNoLeak(res.setHeader.mock.calls.flatMap((c) => c.map(String)));
        },
      ),
      { numRuns: 150 },
    );
  });
});
