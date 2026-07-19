import { MediaAssetsController } from './media-assets.controller';
import { MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS, MediaService } from './media.service';

/**
 * Unit tests for MediaAssetsController — Task 11.3.
 *
 *   GET /media/assets/:id/url
 *
 * Verifies the controller forwards the JWT subject + role to
 * MediaService.getPlaybackUrls and applies the default TTL when the
 * client does not supply one (Req 21.6).
 */
describe('MediaAssetsController', () => {
  const userId = 'user-1';
  const assetId = 'asset-1';

  let mediaService: jest.Mocked<MediaService>;
  let controller: MediaAssetsController;

  beforeEach(() => {
    mediaService = {
      getPlaybackUrls: jest.fn().mockResolvedValue({
        assetId,
        kind: 'VIDEO',
        status: 'READY',
        url: 'https://r2/sign/master',
        type: 'manifest',
        urls: [],
        expiresInSeconds: MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
        expiresAt: new Date().toISOString(),
      }),
    } as any;
    controller = new MediaAssetsController(mediaService);
  });

  it('forwards the JWT actor (sub + role) and asset id to MediaService', async () => {
    await controller.getPlaybackUrl(
      { sub: userId, email: 'u@e.com', role: 'STUDENT' },
      assetId,
      {},
    );

    expect(mediaService.getPlaybackUrls).toHaveBeenCalledWith(
      { sub: userId, role: 'STUDENT' },
      assetId,
      MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
    );
  });

  it('uses the client-supplied expiresIn when present', async () => {
    await controller.getPlaybackUrl(
      { sub: userId, email: 'u@e.com', role: 'TEACHER' },
      assetId,
      { expiresIn: 1800 },
    );

    expect(mediaService.getPlaybackUrls).toHaveBeenCalledWith(
      { sub: userId, role: 'TEACHER' },
      assetId,
      1800,
    );
  });
});
