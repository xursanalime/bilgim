import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAsset } from '@prisma/client';

import { MediaAccessService } from '../media/media-access.service';
import { MediaAssetRepository } from '../media/repositories/media-asset.repository';
import { DevFallbackProtectionProvider } from './adapters/dev-fallback-protection.adapter';
import { JwtPayload } from '../auth/tokens.service';
import { PlaybackTicketService } from './playback-ticket.service';
import { PlaybackSessionRepository } from './repositories/playback-session.repository';
import { PROTECTION_PROVIDER_UNAVAILABLE, ProtectionProvider } from './protection.types';
import { WatermarkIdentityService } from './watermark-identity.service';

/**
 * Unit tests for PlaybackTicketService — Task 2.1
 * (content-protection-backend Req 1.1–1.4, 3.1, 3.3;
 * design Property 1 "No media URL without entitlement" + Property 4
 * "watermark bound to session server-side").
 *
 * Coverage:
 *   - an ENTITLED viewer gets a ticket whose only media reference is a
 *     short-lived signed manifest reference (no permanent storage URL);
 *   - a NON-entitled viewer gets a 403 and NO payload — and no manifest
 *     reference / PlaybackSession is ever produced (Property 1);
 *   - the ticket carries the watermark label + tag, `downloadAllowed`,
 *     and an expiry (Req 1.1, 3.3, Property 4);
 *   - `verifyTicket` round-trips the claims and rejects tampered /
 *     expired tickets (Req 1.3).
 */
describe('PlaybackTicketService', () => {
  const ASSET_ID = '11111111-1111-1111-1111-111111111111';
  const LESSON_ID = '22222222-2222-2222-2222-222222222222';

  const VIEWER: JwtPayload = {
    sub: 'student-1',
    email: 'alice@example.com',
    role: 'STUDENT',
  };

  /** Patterns that would betray a permanent / directly addressable URL. */
  const PERMANENT_URL_PATTERNS = [
    /X-Amz-Signature/i,
    /X-Amz-Credential/i,
    /r2\.cloudflarestorage/i,
    /\.s3\./i,
  ];

  const CONFIG_VALUES: Record<string, unknown> = {
    PLAYBACK_TICKET_TTL_SECONDS: 120,
    PLAYBACK_TICKET_SIGNING_SECRET:
      'unit-test-playback-ticket-signing-secret-0123456789',
    JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef',
    WATERMARK_FORMAT: '{maskedEmail} • {sessionId}',
    API_URL: 'https://api.bilgim.test',
  };

  function buildConfig(): ConfigService {
    return {
      get: <T>(key: string): T | undefined => CONFIG_VALUES[key] as T,
    } as unknown as ConfigService;
  }

  function buildAsset(): MediaAsset {
    return { id: ASSET_ID, kind: 'VIDEO', status: 'UPLOADED' } as MediaAsset;
  }

  interface Harness {
    service: PlaybackTicketService;
    access: jest.Mocked<Pick<MediaAccessService, 'resolvePlaybackAccess'>>;
    assets: jest.Mocked<Pick<MediaAssetRepository, 'findById'>>;
    sessions: jest.Mocked<Pick<PlaybackSessionRepository, 'create'>>;
    provider: DevFallbackProtectionProvider;
    getSignedManifestSpy: jest.SpyInstance;
  }

  function buildHarness(): Harness {
    const config = buildConfig();

    const access = {
      resolvePlaybackAccess: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<MediaAccessService, 'resolvePlaybackAccess'>
    >;

    const assets = {
      findById: jest.fn().mockResolvedValue(buildAsset()),
    } as unknown as jest.Mocked<Pick<MediaAssetRepository, 'findById'>>;

    const sessions = {
      create: jest.fn(async (input: { id: string }) => ({
        ...input,
        issuedAt: new Date(),
      })),
    } as unknown as jest.Mocked<Pick<PlaybackSessionRepository, 'create'>>;

    const watermark = new WatermarkIdentityService(
      config,
      sessions as unknown as PlaybackSessionRepository,
    );

    const provider = new DevFallbackProtectionProvider(config);
    const getSignedManifestSpy = jest.spyOn(provider, 'getSignedManifest');

    const service = new PlaybackTicketService(
      config,
      access as unknown as MediaAccessService,
      assets as unknown as MediaAssetRepository,
      watermark,
      provider,
    );

    return { service, access, assets, sessions, provider, getSignedManifestSpy };
  }

  it('issues a ticket to an entitled viewer with no permanent media URL (Req 1.1/1.4, Property 1)', async () => {
    const h = buildHarness();
    h.access.resolvePlaybackAccess.mockResolvedValue({
      downloadAllowed: false,
      enrollmentId: 'enr-1',
    });

    const ticket = await h.service.issueTicket({
      viewer: VIEWER,
      assetId: ASSET_ID,
      lessonId: LESSON_ID,
    });

    // The only media reference is the short-lived manifest reference.
    expect(typeof ticket.manifestRef).toBe('string');
    expect(ticket.manifestRef.length).toBeGreaterThan(0);

    // No field anywhere in the ticket leaks a permanent/addressable URL.
    const serialized = JSON.stringify(ticket);
    for (const pattern of PERMANENT_URL_PATTERNS) {
      expect(serialized).not.toMatch(pattern);
    }

    // Entitlement was resolved before any manifest reference was produced.
    expect(h.access.resolvePlaybackAccess).toHaveBeenCalledWith(
      { sub: VIEWER.sub, role: VIEWER.role },
      expect.objectContaining({ id: ASSET_ID }),
    );
    expect(h.getSignedManifestSpy).toHaveBeenCalledTimes(1);
  });

  it('denies a non-entitled viewer with 403 and returns NO payload (Req 1.2, Property 1)', async () => {
    const h = buildHarness();
    h.access.resolvePlaybackAccess.mockRejectedValue(
      new ForbiddenException({ code: 'MEDIA_ACCESS_DENIED' }),
    );

    await expect(
      h.service.issueTicket({ viewer: VIEWER, assetId: ASSET_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Nothing was returned: no manifest reference signed, no session row
    // persisted — the entitlement gate short-circuits everything.
    expect(h.getSignedManifestSpy).not.toHaveBeenCalled();
    expect(h.sessions.create).not.toHaveBeenCalled();
  });

  it('carries the watermark label/tag, downloadAllowed, and an expiry (Req 1.1/3.3, Property 4)', async () => {
    const h = buildHarness();
    h.access.resolvePlaybackAccess.mockResolvedValue({
      downloadAllowed: true,
      enrollmentId: 'enr-9',
    });

    const before = Date.now();
    const ticket = await h.service.issueTicket({
      viewer: VIEWER,
      assetId: ASSET_ID,
    });

    // Watermark identity is derived from the session (masked email).
    expect(ticket.watermark.label).toContain('a***@example.com');
    expect(ticket.watermark.tag).toMatch(/^[0-9a-f]{32}$/);

    // downloadAllowed mirrors the server-authoritative grant.
    expect(ticket.downloadAllowed).toBe(true);

    // Expiry is a future ISO timestamp and a PlaybackSession was persisted
    // with that expiry (Property 4 — bound server-side).
    const expiresMs = Date.parse(ticket.expiresAt);
    expect(expiresMs).toBeGreaterThan(before);
    expect(h.sessions.create).toHaveBeenCalledTimes(1);
    const persisted = h.sessions.create.mock.calls[0]![0] as {
      viewerUserId: string;
      viewerTag: string;
      expiresAt: Date;
    };
    expect(persisted.viewerUserId).toBe(VIEWER.sub);
    expect(persisted.viewerTag).toBe(ticket.watermark.tag);
  });

  it('exposes a License_Proxy endpoint per keySystem, never a vendor URL (Req 2.2)', async () => {
    const h = buildHarness();
    h.access.resolvePlaybackAccess.mockResolvedValue({ downloadAllowed: false });

    const ticket = await h.service.issueTicket({
      viewer: VIEWER,
      assetId: ASSET_ID,
    });

    expect(ticket.licenseEndpoints.widevine).toBe(
      `/media/assets/${ASSET_ID}/license/widevine`,
    );
    expect(ticket.licenseEndpoints.fairplay).toBe(
      `/media/assets/${ASSET_ID}/license/fairplay`,
    );
    expect(ticket.licenseEndpoints.playready).toBe(
      `/media/assets/${ASSET_ID}/license/playready`,
    );
  });

  it('throws 404 for an unknown asset before any entitlement check', async () => {
    const h = buildHarness();
    (h.assets.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      h.service.issueTicket({ viewer: VIEWER, assetId: ASSET_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.access.resolvePlaybackAccess).not.toHaveBeenCalled();
  });

  describe('fail closed in production (Req 7.3, design Property 5)', () => {
    /** Build a config whose `NODE_ENV` can be overridden per test. */
    function buildConfigForEnv(nodeEnv: string): ConfigService {
      const values: Record<string, unknown> = {
        ...CONFIG_VALUES,
        NODE_ENV: nodeEnv,
      };
      return {
        get: <T>(key: string): T | undefined => values[key] as T,
      } as unknown as ConfigService;
    }

    function buildServiceWith(
      nodeEnv: string,
      provider: ProtectionProvider,
    ): {
      service: PlaybackTicketService;
      access: jest.Mocked<Pick<MediaAccessService, 'resolvePlaybackAccess'>>;
      sessions: jest.Mocked<Pick<PlaybackSessionRepository, 'create'>>;
    } {
      const config = buildConfigForEnv(nodeEnv);

      const access = {
        resolvePlaybackAccess: jest.fn().mockResolvedValue({
          downloadAllowed: false,
          enrollmentId: 'enr-1',
        }),
      } as unknown as jest.Mocked<
        Pick<MediaAccessService, 'resolvePlaybackAccess'>
      >;

      const assets = {
        findById: jest.fn().mockResolvedValue(buildAsset()),
      } as unknown as jest.Mocked<Pick<MediaAssetRepository, 'findById'>>;

      const sessions = {
        create: jest.fn(async (input: { id: string }) => ({
          ...input,
          issuedAt: new Date(),
        })),
      } as unknown as jest.Mocked<Pick<PlaybackSessionRepository, 'create'>>;

      const watermark = new WatermarkIdentityService(
        config,
        sessions as unknown as PlaybackSessionRepository,
      );

      const service = new PlaybackTicketService(
        config,
        access as unknown as MediaAccessService,
        assets as unknown as MediaAssetRepository,
        watermark,
        provider,
      );

      return { service, access, sessions };
    }

    /** A real, production-grade DRM_Provider stand-in. */
    function productionGradeProvider(): {
      provider: ProtectionProvider;
      getSignedManifest: jest.Mock;
    } {
      const getSignedManifest = jest.fn(async () => ({
        manifestUrl: '/proxied/manifest/ref',
      }));
      const provider = {
        productionGrade: true,
        getSignedManifest,
        issueLicense: jest.fn(),
        bindWatermark: jest.fn(async () => ({})),
      } as unknown as ProtectionProvider;
      return { provider, getSignedManifest };
    }

    it('refuses to issue a ticket in production with the dev fallback and serves NO manifest (503)', async () => {
      const devFallback = new DevFallbackProtectionProvider(
        buildConfigForEnv('production'),
      );
      const getSignedManifestSpy = jest.spyOn(devFallback, 'getSignedManifest');
      const { service, sessions } = buildServiceWith('production', devFallback);

      await expect(
        service.issueTicket({ viewer: VIEWER, assetId: ASSET_ID }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      // Fail closed: no manifest reference signed, no PlaybackSession row.
      expect(getSignedManifestSpy).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('uses the actionable PROTECTION_PROVIDER_UNAVAILABLE error code', async () => {
      const devFallback = new DevFallbackProtectionProvider(
        buildConfigForEnv('production'),
      );
      const { service } = buildServiceWith('production', devFallback);

      await expect(
        service.issueTicket({ viewer: VIEWER, assetId: ASSET_ID }),
      ).rejects.toMatchObject({
        response: { code: PROTECTION_PROVIDER_UNAVAILABLE },
      });
    });

    it('still issues a ticket in development with the flagged dev fallback', async () => {
      const devFallback = new DevFallbackProtectionProvider(
        buildConfigForEnv('development'),
      );
      const getSignedManifestSpy = jest.spyOn(devFallback, 'getSignedManifest');
      const { service, sessions } = buildServiceWith(
        'development',
        devFallback,
      );

      const ticket = await service.issueTicket({
        viewer: VIEWER,
        assetId: ASSET_ID,
      });

      expect(typeof ticket.manifestRef).toBe('string');
      expect(getSignedManifestSpy).toHaveBeenCalledTimes(1);
      expect(sessions.create).toHaveBeenCalledTimes(1);
    });

    it('issues a ticket in production with a production-grade provider', async () => {
      const { provider, getSignedManifest } = productionGradeProvider();
      const { service, sessions } = buildServiceWith('production', provider);

      const ticket = await service.issueTicket({
        viewer: VIEWER,
        assetId: ASSET_ID,
      });

      expect(ticket.manifestRef).toBe('/proxied/manifest/ref');
      expect(getSignedManifest).toHaveBeenCalledTimes(1);
      expect(sessions.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyTicket', () => {
    it('round-trips the signed claims for an entitled ticket', async () => {
      const h = buildHarness();
      h.access.resolvePlaybackAccess.mockResolvedValue({
        downloadAllowed: true,
        enrollmentId: 'enr-1',
      });

      const ticket = await h.service.issueTicket({
        viewer: VIEWER,
        assetId: ASSET_ID,
        lessonId: LESSON_ID,
      });

      const claims = h.service.verifyTicket(ticket.ticket);

      expect(claims.assetId).toBe(ASSET_ID);
      expect(claims.lessonId).toBe(LESSON_ID);
      expect(claims.viewerUserId).toBe(VIEWER.sub);
      expect(claims.viewerTag).toBe(ticket.watermark.tag);
      expect(claims.enrollmentId).toBe('enr-1');
      expect(claims.downloadAllowed).toBe(true);
      expect(claims.expiresAt).toBeGreaterThan(Date.now());
    });

    it('rejects a tampered ticket', async () => {
      const h = buildHarness();
      h.access.resolvePlaybackAccess.mockResolvedValue({
        downloadAllowed: false,
      });

      const ticket = await h.service.issueTicket({
        viewer: VIEWER,
        assetId: ASSET_ID,
      });

      // Flip a character in the payload segment.
      const [payload, sig] = ticket.ticket.split('.');
      const tamperedPayload =
        payload!.slice(0, -1) + (payload!.endsWith('A') ? 'B' : 'A');
      const tampered = `${tamperedPayload}.${sig}`;

      expect(() => h.service.verifyTicket(tampered)).toThrow(ForbiddenException);
    });

    it('rejects a ticket with a forged signature', async () => {
      const h = buildHarness();
      h.access.resolvePlaybackAccess.mockResolvedValue({
        downloadAllowed: false,
      });

      const ticket = await h.service.issueTicket({
        viewer: VIEWER,
        assetId: ASSET_ID,
      });

      const [payload] = ticket.ticket.split('.');
      const forged = `${payload}.not-a-valid-signature`;

      expect(() => h.service.verifyTicket(forged)).toThrow(ForbiddenException);
    });

    it('rejects an expired ticket (Req 1.3)', async () => {
      const h = buildHarness();
      h.access.resolvePlaybackAccess.mockResolvedValue({
        downloadAllowed: false,
      });

      const ticket = await h.service.issueTicket({
        viewer: VIEWER,
        assetId: ASSET_ID,
      });
      const expiresMs = Date.parse(ticket.expiresAt);

      // Move "now" past the ticket's expiry.
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(expiresMs + 1_000);
      try {
        expect(() => h.service.verifyTicket(ticket.ticket)).toThrow(
          ForbiddenException,
        );
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('rejects a malformed ticket', () => {
      const h = buildHarness();
      expect(() => h.service.verifyTicket('not-a-ticket')).toThrow(
        ForbiddenException,
      );
      expect(() => h.service.verifyTicket('')).toThrow(ForbiddenException);
    });
  });
});
