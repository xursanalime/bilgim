import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

import { DM_MAX_ATTACHMENT_SIZE_BYTES } from './dm.constants';
import { DmService } from './dm.service';

function makeService(asset: Record<string, unknown> | null) {
  const prisma = {
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(asset),
    },
  };
  const service = new DmService(
    prisma as never,
    {} as never, // repo
    {} as never, // redis
    {} as never, // config
    {} as never, // liveChatGateway
    {} as never, // mediaAccess
    {} as never, // r2
  );
  return service as unknown as {
    assertAttachmentAllowed(ownerUserId: string, assetId: string): Promise<void>;
  };
}

describe('DM attachment validation', () => {
  it('accepts an uploaded attachment at exactly 1 GB', async () => {
    const service = makeService({
      ownerUserId: 'owner-1',
      bytes: BigInt(DM_MAX_ATTACHMENT_SIZE_BYTES),
      status: 'UPLOADED',
      kind: 'OTHER',
      originalKey: 'media/file.bin',
    });

    await expect(
      service.assertAttachmentAllowed('owner-1', 'asset-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects an attachment larger than 1 GB', async () => {
    const service = makeService({
      ownerUserId: 'owner-1',
      bytes: BigInt(DM_MAX_ATTACHMENT_SIZE_BYTES) + 1n,
      status: 'UPLOADED',
      kind: 'VIDEO',
      originalKey: 'media/video.mp4',
    });

    try {
      await service.assertAttachmentAllowed('owner-1', 'asset-1');
      fail('expected an oversized attachment to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'DM_ATTACHMENT_TOO_LARGE',
        maxBytes: DM_MAX_ATTACHMENT_SIZE_BYTES,
      });
    }
  });

  it('rejects another user attachment', async () => {
    const service = makeService({
      ownerUserId: 'owner-2',
      bytes: 1024n,
      status: 'READY',
      kind: 'IMAGE',
      originalKey: 'media/image.jpg',
    });

    await expect(
      service.assertAttachmentAllowed('owner-1', 'asset-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
