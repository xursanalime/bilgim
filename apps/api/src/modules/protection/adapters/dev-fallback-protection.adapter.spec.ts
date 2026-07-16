import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

import {
  DEV_FALLBACK_MARKER,
  DRM_PROVIDER_NOT_CONFIGURED,
} from '../protection.types';
import { DevFallbackProtectionProvider } from './dev-fallback-protection.adapter';

/**
 * Unit tests for the clearly-flagged DEVELOPMENT fallback binding of
 * `PROTECTION_PROVIDER` (Task 1.2, Req 2.1, 7.2, 7.3).
 *
 * These prove the three behaviours the requirements demand:
 *   - it returns a proxied manifest reference that is flagged
 *     non-production and never a permanent storage URL (Req 1.4, 7.2);
 *   - it refuses to issue a DRM license, failing closed rather than
 *     pretending to be encrypted (Req 7.2, 7.3);
 *   - it returns only a clearly-marked dev watermark session tag.
 */
describe('DevFallbackProtectionProvider', () => {
  function makeProvider(apiUrl = 'https://api.example.test'): {
    provider: DevFallbackProtectionProvider;
  } {
    const config = {
      get: (key: string) => (key === 'API_URL' ? apiUrl : undefined),
    } as unknown as ConfigService;
    return { provider: new DevFallbackProtectionProvider(config) };
  }

  it('is never production-grade (Req 7.2/7.3 — drives fail-closed)', () => {
    const { provider } = makeProvider();
    expect(provider.productionGrade).toBe(false);
  });

  describe('getSignedManifest', () => {    it('returns a proxied manifest reference flagged as non-production', async () => {
      const { provider } = makeProvider();

      const { manifestUrl } = await provider.getSignedManifest('asset-123', 120);

      // Points back at the existing media playback proxy (never the raw
      // R2 storage URL) and carries the dev-fallback marker (Req 1.4, 7.2).
      expect(manifestUrl).toContain('/media/assets/asset-123/url');
      expect(manifestUrl).toContain(`${DEV_FALLBACK_MARKER}=1`);
    });

    it('url-encodes the asset id', async () => {
      const { provider } = makeProvider();

      const { manifestUrl } = await provider.getSignedManifest(
        'asset/../secret',
        120,
      );

      expect(manifestUrl).toContain(encodeURIComponent('asset/../secret'));
      expect(manifestUrl).not.toContain('asset/../secret');
    });

    it('clamps the TTL into the short dev-fallback window', async () => {
      const { provider } = makeProvider();

      const tooShort = await provider.getSignedManifest('a', 1);
      const tooLong = await provider.getSignedManifest('a', 60 * 60);

      expect(tooShort.manifestUrl).toContain('ttl=60');
      // 5 minute ceiling.
      expect(tooLong.manifestUrl).toContain('ttl=300');
    });

    it('falls back to a localhost base url when API_URL is unset', async () => {
      const config = {
        get: () => undefined,
      } as unknown as ConfigService;
      const provider = new DevFallbackProtectionProvider(config);

      const { manifestUrl } = await provider.getSignedManifest('a', 120);

      expect(manifestUrl).toContain('http://localhost:4000');
    });
  });

  describe('issueLicense', () => {
    it('refuses to issue a license and fails closed (Req 7.2/7.3)', async () => {
      const { provider } = makeProvider();

      await expect(
        provider.issueLicense({
          keySystem: 'widevine',
          challenge: Buffer.from('challenge'),
          viewerTag: 'viewer-1',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('uses the stable DRM_PROVIDER_NOT_CONFIGURED error code', async () => {
      const { provider } = makeProvider();

      await expect(
        provider.issueLicense({
          keySystem: 'fairplay',
          challenge: Buffer.alloc(0),
          viewerTag: 'viewer-1',
        }),
      ).rejects.toMatchObject({
        response: { code: DRM_PROVIDER_NOT_CONFIGURED },
      });
    });
  });

  describe('bindWatermark', () => {
    it('returns only a clearly-marked dev-fallback session tag', async () => {
      const { provider } = makeProvider();

      const { sessionTag } = await provider.bindWatermark('asset-1', 'viewer-9');

      expect(sessionTag).toBe(`${DEV_FALLBACK_MARKER}:viewer-9`);
    });
  });
});
