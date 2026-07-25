import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { MediaService } from './media.service';

/**
 * MediaStreamController — authenticated-by-token HLS proxy for VIDEO
 * assets (Req 8.3, 8.4).
 *
 * Deliberately a standalone `@Public()` controller (same reasoning as
 * `MediaPublicController`: `RolesGuard` would 403 these requests before
 * the handler ever runs, since hls.js/Safari can't attach the app's normal
 * `Authorization: Bearer` header to every manifest/segment request they
 * fire). The real authorization boundary is the single-asset, short-lived
 * `token` query param minted by `MediaService.getPlaybackUrls` — which
 * only hands one out after `MediaAccessService.assertCanRead` passes — and
 * verified again on every request here by `MediaService`.
 *
 *   GET /media/stream/:id/hls/master.m3u8
 *   GET /media/stream/:id/hls/:variant/:file
 */
@Controller('media/stream')
export class MediaStreamController {
  constructor(private readonly mediaService: MediaService) {}

  @Public()
  @Get(':id/hls/master.m3u8')
  async getMaster(
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType } = await this.mediaService.getHlsMasterManifest(
      assetId,
      token,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    // Helmet's global default (`Cross-Origin-Resource-Policy: same-origin`,
    // see configure-security.ts) blocks the web app — a different origin —
    // from loading this as a <video> subresource at all (Chrome:
    // net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin). CORP only governs
    // no-cors subresource loads (video/img/audio `src`), not our normal
    // fetch()-based API calls, so relaxing it here doesn't weaken anything
    // else. This is the one route family meant to be embedded cross-origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type(contentType).send(body);
  }

  @Public()
  @Get(':id/hls/:variant/:file')
  async getVariantResource(
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Param('variant') variant: string,
    @Param('file') file: string,
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType } = await this.mediaService.getHlsVariantResource(
      assetId,
      variant,
      file,
      token,
    );
    // Segments/playlists are content-addressed-ish (a fresh transcode gets
    // a fresh assetId/manifest key) so they're safe to cache client-side
    // for the lifetime of the token.
    res.setHeader('Cache-Control', 'private, max-age=3600, immutable');
    // See getMaster() above for why this is required.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type(contentType).send(body);
  }
}
