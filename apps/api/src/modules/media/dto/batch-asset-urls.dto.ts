import { z } from 'zod';

/**
 * Body for `POST /media/assets/batch-urls`.
 *
 * Chat bubbles used to call `GET /media/assets/:id` and
 * `GET /media/assets/:id/url` once *per attachment* — a 20-media chat
 * page issued 40 round-trips just to render. This endpoint resolves
 * metadata + a signed playback URL for many assets in one request.
 * Capped at 50 — well above any realistic single page of chat
 * history, but bounded so a client can't force the server to sign an
 * unbounded number of R2 URLs in one call.
 */
export const BatchAssetUrlsSchema = z.object({
  assetIds: z
    .array(z.string().uuid())
    .min(1, 'assetIds must contain at least one id')
    .max(50, 'assetIds must contain at most 50 ids'),
});

export type BatchAssetUrlsDto = z.infer<typeof BatchAssetUrlsSchema>;
