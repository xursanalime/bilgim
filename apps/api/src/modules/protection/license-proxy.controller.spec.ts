import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/tokens.service';
import {
  DRM_PROVIDER_NOT_CONFIGURED,
  IssueLicenseInput,
  ProtectionProvider,
} from './protection.types';
import {
  LicenseProxyController,
  PlaybackTicketVerifier,
  VerifiedPlaybackTicket,
} from './license-proxy.controller';

/**
 * Unit tests for the License_Proxy (Task 2.3, Req 2.1–2.5; design
 * Property 2 — "keys stay server-side").
 *
 * `PlaybackTicketService` (Task 2.1) and the `ProtectionProvider` are
 * MOCKED so these tests never depend on the concurrently authored ticket
 * service internals or any real DRM vendor.
 */
describe('LicenseProxyController', () => {
  const ASSET_ID = 'asset-123';
  const VIEWER_ID = 'user-1';
  const LICENSE_BYTES = Buffer.from('OPAQUE_LICENSE_BLOB_𝟶𝟷𝟸𝟹');

  const user: JwtPayload = {
    sub: VIEWER_ID,
    email: 'alice@example.com',
    role: 'STUDENT',
  };

  function validClaims(
    overrides: Partial<VerifiedPlaybackTicket> = {},
  ): VerifiedPlaybackTicket {
    return {
      assetId: ASSET_ID,
      lessonId: 'lesson-9',
      viewerUserId: VIEWER_ID,
      viewerTag: 'a***@example.com • sess-7',
      enrollmentId: 'enr-1',
      entitlementApproved: true,
      expiresAt: Date.now() + 60_000,
      ...overrides,
    };
  }

  function makeRes(): Response & {
    setHeader: jest.Mock;
  } {
    return {
      setHeader: jest.fn(),
    } as unknown as Response & { setHeader: jest.Mock };
  }

  function makeController(opts?: {
    provider?: Partial<ProtectionProvider>;
    verifier?: Partial<PlaybackTicketVerifier>;
  }): {
    controller: LicenseProxyController;
    issueLicense: jest.Mock;
    verifyTicket: jest.Mock;
  } {
    const issueLicense = jest.fn(
      async (_input: IssueLicenseInput): Promise<Buffer> => LICENSE_BYTES,
    );
    const verifyTicket = jest.fn(
      async (_signed: string): Promise<VerifiedPlaybackTicket> => validClaims(),
    );

    const provider: ProtectionProvider = {
      getSignedManifest: jest.fn(),
      issueLicense,
      bindWatermark: jest.fn(),
      ...opts?.provider,
    } as ProtectionProvider;

    const verifier: PlaybackTicketVerifier = {
      verifyTicket,
      ...opts?.verifier,
    } as PlaybackTicketVerifier;

    return {
      controller: new LicenseProxyController(provider, verifier),
      issueLicense: issueLicense as jest.Mock,
      verifyTicket: verifyTicket as jest.Mock,
    };
  }

  const SIGNED_TICKET = 'signed.playback.ticket';
  const CHALLENGE_B64 = Buffer.from('eme-challenge').toString('base64');

  describe('valid ticket + entitlement', () => {
    it('returns the opaque license bytes from the provider', async () => {
      const { controller, issueLicense } = makeController();
      const res = makeRes();

      const result = await controller.issueLicense(
        ASSET_ID,
        'widevine',
        user,
        { challenge: CHALLENGE_B64 },
        SIGNED_TICKET,
        res,
      );

      expect(result).toEqual(LICENSE_BYTES);
      expect(issueLicense).toHaveBeenCalledTimes(1);
      const input = issueLicense.mock.calls[0][0] as IssueLicenseInput;
      expect(input.keySystem).toBe('widevine');
      expect(input.viewerTag).toBe(validClaims().viewerTag);
      expect(Buffer.isBuffer(input.challenge)).toBe(true);
      expect(input.challenge.toString()).toBe('eme-challenge');
    });

    it('sets opaque, non-cacheable response headers', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.issueLicense(
        ASSET_ID,
        'fairplay',
        user,
        { challenge: CHALLENGE_B64 },
        SIGNED_TICKET,
        res,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/octet-stream',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('leaks NO provider key, credential, or URL in the response', async () => {
      // Provider returns ONLY the opaque license blob. Even if a buggy
      // provider tried to attach secrets, the controller returns just the
      // bytes — assert nothing secret-shaped is present.
      const { controller } = makeController();
      const res = makeRes();

      const result = await controller.issueLicense(
        ASSET_ID,
        'playready',
        user,
        { challenge: CHALLENGE_B64 },
        SIGNED_TICKET,
        res,
      );

      const asText = result.toString('utf8');
      expect(asText).not.toMatch(/http/i);
      expect(asText).not.toMatch(/api[_-]?key/i);
      expect(asText).not.toMatch(/secret/i);
      expect(asText).not.toMatch(/credential/i);
      // The response is exactly the provider's opaque blob, nothing more.
      expect(result).toBe(LICENSE_BYTES);
    });

    it('accepts the ticket from the body when no header is present', async () => {
      const { controller, verifyTicket } = makeController();
      const res = makeRes();

      await controller.issueLicense(
        ASSET_ID,
        'widevine',
        user,
        { challenge: CHALLENGE_B64, ticket: SIGNED_TICKET },
        undefined,
        res,
      );

      expect(verifyTicket).toHaveBeenCalledWith(SIGNED_TICKET);
    });

    it('accepts a raw Buffer body as the challenge', async () => {
      const { controller, issueLicense } = makeController();
      const res = makeRes();

      await controller.issueLicense(
        ASSET_ID,
        'widevine',
        user,
        Buffer.from('raw-eme-bytes'),
        SIGNED_TICKET,
        res,
      );

      const input = issueLicense.mock.calls[0][0] as IssueLicenseInput;
      expect(input.challenge.toString()).toBe('raw-eme-bytes');
    });
  });

  describe('invalid / expired ticket → 403, no license', () => {
    it('rejects when the verifier throws (forged/invalid ticket)', async () => {
      const { controller, issueLicense } = makeController({
        verifier: {
          verifyTicket: jest.fn(async () => {
            throw new Error('bad signature');
          }),
        },
      });
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(issueLicense).not.toHaveBeenCalled();
    });

    it('rejects an expired ticket (defense in depth)', async () => {
      const { controller, issueLicense } = makeController({
        verifier: {
          verifyTicket: jest.fn(async () =>
            validClaims({ expiresAt: Date.now() - 1_000 }),
          ),
        },
      });
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toMatchObject({
        response: { code: 'TICKET_EXPIRED' },
      });
      expect(issueLicense).not.toHaveBeenCalled();
    });

    it('rejects when the ticket is for a different asset', async () => {
      const { controller, issueLicense } = makeController({
        verifier: {
          verifyTicket: jest.fn(async () =>
            validClaims({ assetId: 'other-asset' }),
          ),
        },
      });
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toMatchObject({ response: { code: 'TICKET_ASSET_MISMATCH' } });
      expect(issueLicense).not.toHaveBeenCalled();
    });

    it('rejects when the ticket belongs to a different viewer', async () => {
      const { controller, issueLicense } = makeController({
        verifier: {
          verifyTicket: jest.fn(async () =>
            validClaims({ viewerUserId: 'someone-else' }),
          ),
        },
      });
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toMatchObject({ response: { code: 'TICKET_VIEWER_MISMATCH' } });
      expect(issueLicense).not.toHaveBeenCalled();
    });

    it('rejects when no ticket is supplied at all', async () => {
      const { controller, verifyTicket, issueLicense } = makeController();
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          undefined,
          res,
        ),
      ).rejects.toMatchObject({ response: { code: 'MISSING_PLAYBACK_TICKET' } });
      expect(verifyTicket).not.toHaveBeenCalled();
      expect(issueLicense).not.toHaveBeenCalled();
    });

    it('rejects when the entitlement is explicitly not approved', async () => {
      const { controller, issueLicense } = makeController({
        verifier: {
          verifyTicket: jest.fn(async () =>
            validClaims({
              entitlementApproved: false,
              entitlementStatus: 'PENDING',
            }),
          ),
        },
      });
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toMatchObject({
        response: { code: 'ENTITLEMENT_NOT_APPROVED' },
      });
      expect(issueLicense).not.toHaveBeenCalled();
    });
  });

  describe('unsupported key system → 400', () => {
    it('rejects an unknown key system before touching the ticket/provider', async () => {
      const { controller, verifyTicket, issueLicense } = makeController();
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'clearkey',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(verifyTicket).not.toHaveBeenCalled();
      expect(issueLicense).not.toHaveBeenCalled();
    });
  });

  describe('dev fallback provider → 503 (fail closed)', () => {
    it('surfaces the actionable DRM_PROVIDER_NOT_CONFIGURED error', async () => {
      const { controller } = makeController({
        provider: {
          issueLicense: jest.fn(async () => {
            throw new ServiceUnavailableException({
              code: DRM_PROVIDER_NOT_CONFIGURED,
              message: 'No DRM provider configured.',
            });
          }),
        },
      });
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          { challenge: CHALLENGE_B64 },
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toMatchObject({
        response: { code: DRM_PROVIDER_NOT_CONFIGURED },
      });
    });
  });

  describe('missing challenge → 400', () => {
    it('rejects when no challenge is provided', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await expect(
        controller.issueLicense(
          ASSET_ID,
          'widevine',
          user,
          {},
          SIGNED_TICKET,
          res,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
