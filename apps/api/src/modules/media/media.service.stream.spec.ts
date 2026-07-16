import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

import { MediaService } from './media.service';
import { MediaAccessService } from './media-access.service';
import { MediaAssetRepository } from './repositories/media-asset.repository';
import { R2Service } from '../../infra/r2/r2.service';

/**
 * Unit tests for MediaService.openProtectedStream — Task 3.1
 * (content-protection-backend Req 4.1 – 4.4).
 *
 * Confirms the service proxies bytes via R2's stream API and NEVER signs
 * an addressable storage URL, and that a non-entitled caller is rejected
 * before any byte stream is opened.
 */
describe('MediaService.openProtectedStream', () => {
  const ASSET_ID = '33333333-3333-3333-3333-333333333333';
  const KEY = 'media/owner/pdf/2025/01/abc-notes.pdf';

  let mediaService: MediaService;
  let r2: jest.Mocked<R2Service>;
  let assets: jest.Mocked<MediaAssetRepository>;
  let access: jest.Mocked<MediaAccessService>;

  const buildAsset = (overrides: Partial<any> = {}) => ({
    id: ASSET_ID,
    ownerUserId: 'owner-1',
    kind: 'PDF' as const,
    status: 'UPLOADED' as const,
    bytes: BigInt(2048),
    contentType: 'application/pdf',
    originalKey: KEY,
    hlsManifestKey: null,
    thumbnailKey: null,
    durationMs: null,
    metadata: { multipart: { uploadId: 'u', partsCount: 1, fileName: 'notes.pdf' } },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    r2 = {
      getObjectStream: jest.fn().mockResolvedValue({
        body: Readable.from(['bytes']),
        contentType: 'application/pdf',
        contentLength: 2048,
        contentRange: undefined,
        acceptRanges: 'bytes',
        isPartial: false,
      }),
      signObjectGet: jest.fn(),
    } as any;

    assets = {
      findById: jest.fn().mockResolvedValue(buildAsset()),
    } as any;

    access = {
      resolveStreamAccess: jest.fn().mockResolvedValue({ downloadAllowed: false }),
    } as any;

    mediaService = new MediaService(r2, assets, access, { add: jest.fn() } as any);
  });

  it('streams bytes via R2 getObjectStream and never signs a storage URL (Req 4.1)', async () => {
    const result = await mediaService.openProtectedStream(
      { sub: 'student-1', role: 'STUDENT' },
      ASSET_ID,
    );

    expect(r2.getObjectStream).toHaveBeenCalledWith(KEY, undefined);
    expect(r2.signObjectGet).not.toHaveBeenCalled();
    expect(result.downloadAllowed).toBe(false);
    expect(result.fileName).toBe('notes.pdf');
    // The result carries a readable stream, not a URL.
    expect(result).not.toHaveProperty('url');
    expect(typeof (result.stream as Readable).pipe).toBe('function');
  });

  it('propagates a 403 from the entitlement gate without opening a byte stream (Req 4.1/4.4)', async () => {
    access.resolveStreamAccess.mockRejectedValue(
      new ForbiddenException({ code: 'MEDIA_ACCESS_DENIED' }),
    );

    await expect(
      mediaService.openProtectedStream({ sub: 'x', role: 'STUDENT' }, ASSET_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(r2.getObjectStream).not.toHaveBeenCalled();
  });

  it('forwards the Range header to R2 and reports a partial response', async () => {
    r2.getObjectStream.mockResolvedValue({
      body: Readable.from(['partial']),
      contentType: 'application/pdf',
      contentLength: 1024,
      contentRange: 'bytes 0-1023/2048',
      acceptRanges: 'bytes',
      isPartial: true,
    } as any);

    const result = await mediaService.openProtectedStream(
      { sub: 'owner-1', role: 'TEACHER' },
      ASSET_ID,
      'bytes=0-1023',
    );

    expect(r2.getObjectStream).toHaveBeenCalledWith(KEY, 'bytes=0-1023');
    expect(result.isPartial).toBe(true);
    expect(result.contentRange).toBe('bytes 0-1023/2048');
  });

  it('404s when the asset does not exist', async () => {
    assets.findById.mockResolvedValue(null as any);

    await expect(
      mediaService.openProtectedStream({ sub: 'x', role: 'STUDENT' }, ASSET_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
