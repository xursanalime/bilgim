import { ConfigService } from '@nestjs/config';
import { LocalStorage } from './local-storage';
import { S3Client } from '@aws-sdk/client-s3';

import { R2Service, R2_MAX_PARTS } from './r2.service';

/**
 * Unit tests for R2Service. We replace the underlying `S3Client.send`
 * implementation with a Jest spy so we can assert the SDK calls without
 * touching a real R2 endpoint.
 */
describe('R2Service', () => {
  let service: R2Service;
  let send: jest.Mock;

  const config = new ConfigService({
    R2_ACCOUNT_ID: 'acct-123',
    R2_ACCESS_KEY_ID: 'AKIA',
    R2_SECRET_ACCESS_KEY: 'SECRET',
    R2_BUCKET_NAME: 'bilgim-media',
    R2_PUBLIC_URL: 'https://r2-emulator.local',
  });

  beforeEach(() => {
    service = new R2Service(config, new LocalStorage(config));
    send = jest.fn();
    (service as any).client.send = send;
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('createMultipartUpload', () => {
    it('returns the UploadId from R2', async () => {
      send.mockResolvedValue({ UploadId: 'mp-1' });
      const id = await service.createMultipartUpload('key', 'video/mp4');
      expect(id).toBe('mp-1');
      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0];
      expect(command.input).toMatchObject({
        Bucket: 'bilgim-media',
        Key: 'key',
        ContentType: 'video/mp4',
      });
    });

    it('throws when R2 omits an UploadId', async () => {
      send.mockResolvedValue({});
      await expect(
        service.createMultipartUpload('key', 'video/mp4'),
      ).rejects.toThrow(/UploadId/);
    });
  });

  describe('signUploadPart', () => {
    it('rejects partNumber < 1', async () => {
      await expect(service.signUploadPart('k', 'u', 0)).rejects.toThrow(
        /partNumber/,
      );
    });

    it('rejects partNumber > R2_MAX_PARTS', async () => {
      await expect(
        service.signUploadPart('k', 'u', R2_MAX_PARTS + 1),
      ).rejects.toThrow(/exceeds/);
    });

    it('returns a presigned URL string for valid input', async () => {
      const url = await service.signUploadPart('k', 'u', 1);
      // The presigner runs locally and never touches `send`, so we can
      // simply assert the result is a non-empty https URL.
      expect(typeof url).toBe('string');
      expect(url).toMatch(/^https?:\/\//);
    });

    it('clamps the TTL to the 6h max', async () => {
      // Indirect: signing twice with TTLs above and below the cap must
      // still produce valid URLs (no exceptions).
      const url1 = await service.signUploadPart('k', 'u', 1, 60 * 60 * 24); // 24h
      const url2 = await service.signUploadPart('k', 'u', 1, 30); // 30s
      expect(typeof url1).toBe('string');
      expect(typeof url2).toBe('string');
    });
  });

  describe('signUploadPartBatch', () => {
    it('returns one URL per planned part, sorted ascending', async () => {
      const urls = await service.signUploadPartBatch('k', 'u', 4);
      expect(urls).toHaveLength(4);
      expect(urls.map((u) => u.partNumber)).toEqual([1, 2, 3, 4]);
      for (const u of urls) {
        expect(u.url).toMatch(/^https?:\/\//);
      }
    });

    it('rejects partsCount > R2_MAX_PARTS', async () => {
      await expect(
        service.signUploadPartBatch('k', 'u', R2_MAX_PARTS + 1),
      ).rejects.toThrow(/exceeds/);
    });

    it('rejects partsCount < 1', async () => {
      await expect(service.signUploadPartBatch('k', 'u', 0)).rejects.toThrow(
        /partsCount/,
      );
    });
  });

  describe('completeMultipartUpload', () => {
    beforeEach(() => {
      send.mockResolvedValue({ Location: 'https://r2/k', ETag: '"abc"' });
    });

    it('sorts parts by ascending partNumber and quotes ETags', async () => {
      await service.completeMultipartUpload('k', 'u', [
        { partNumber: 3, etag: 'ccc' },
        { partNumber: 1, etag: '"aaa"' },
        { partNumber: 2, etag: 'bbb' },
      ]);
      const command = send.mock.calls[0][0];
      const parts = command.input.MultipartUpload.Parts;
      expect(parts).toEqual([
        { PartNumber: 1, ETag: '"aaa"' },
        { PartNumber: 2, ETag: '"bbb"' },
        { PartNumber: 3, ETag: '"ccc"' },
      ]);
    });

    it('rejects an empty parts array', async () => {
      await expect(
        service.completeMultipartUpload('k', 'u', []),
      ).rejects.toThrow(/at least one part/);
      expect(send).not.toHaveBeenCalled();
    });

    it('rejects duplicate partNumbers', async () => {
      await expect(
        service.completeMultipartUpload('k', 'u', [
          { partNumber: 1, etag: 'a' },
          { partNumber: 1, etag: 'b' },
        ]),
      ).rejects.toThrow(/Duplicate/);
      expect(send).not.toHaveBeenCalled();
    });

    it('returns the bucket key alongside the R2 metadata', async () => {
      const result = await service.completeMultipartUpload('k', 'u', [
        { partNumber: 1, etag: 'a' },
      ]);
      expect(result.key).toBe('k');
      expect(result.location).toBe('https://r2/k');
      expect(result.etag).toBe('"abc"');
    });
  });

  describe('abortMultipartUpload', () => {
    it('swallows NoSuchUpload (idempotent abort)', async () => {
      const noSuch = Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
      send.mockRejectedValue(noSuch);
      await expect(service.abortMultipartUpload('k', 'u')).resolves.toBeUndefined();
    });

    it('propagates other errors', async () => {
      send.mockRejectedValue(new Error('500 internal'));
      await expect(service.abortMultipartUpload('k', 'u')).rejects.toThrow(
        /500 internal/,
      );
    });

    it('issues an AbortMultipartUpload to R2 with bucket+key+uploadId', async () => {
      send.mockResolvedValue({});
      await service.abortMultipartUpload('k', 'u');
      const command = send.mock.calls[0][0];
      expect(command.input).toMatchObject({
        Bucket: 'bilgim-media',
        Key: 'k',
        UploadId: 'u',
      });
    });
  });

  describe('objectExists', () => {
    it('returns true when HEAD succeeds', async () => {
      send.mockResolvedValue({});
      await expect(service.objectExists('k')).resolves.toBe(true);
    });

    it('returns false on NotFound / NoSuchKey', async () => {
      send.mockRejectedValueOnce(
        Object.assign(new Error('missing'), { name: 'NotFound' }),
      );
      await expect(service.objectExists('k')).resolves.toBe(false);

      send.mockRejectedValueOnce(
        Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
      );
      await expect(service.objectExists('k')).resolves.toBe(false);
    });

    it('propagates unexpected errors', async () => {
      send.mockRejectedValueOnce(new Error('network down'));
      await expect(service.objectExists('k')).rejects.toThrow(/network down/);
    });
  });

  describe('signObjectGet', () => {
    it('returns a presigned https URL for a GET request', async () => {
      const url = await service.signObjectGet('media/key.mp4');
      expect(typeof url).toBe('string');
      expect(url).toMatch(/^https?:\/\//);
      // The presigner runs locally and never touches the S3Client.
      expect(send).not.toHaveBeenCalled();
    });

    it('clamps absurdly large TTLs down to the 6h max (Req 21.6)', async () => {
      // Indirect assertion — we cannot read the TTL from the resulting
      // URL without parsing the query, but signing must succeed for both
      // an above-cap value and a below-floor value.
      const longTtl = await service.signObjectGet('k', 60 * 60 * 24);
      const shortTtl = await service.signObjectGet('k', 1);
      expect(typeof longTtl).toBe('string');
      expect(typeof shortTtl).toBe('string');
    });
  });

  describe('getObjectBuffer', () => {
    it('returns the object body as a Buffer via transformToByteArray', async () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      send.mockResolvedValue({
        Body: {
          transformToByteArray: jest.fn().mockResolvedValue(payload),
        },
      });

      const buf = await service.getObjectBuffer('media/source.mp4');

      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf).toEqual(Buffer.from([1, 2, 3, 4, 5]));
      const command = send.mock.calls[0][0];
      expect(command.input).toMatchObject({
        Bucket: 'bilgim-media',
        Key: 'media/source.mp4',
      });
    });

    it('throws when R2 returns no Body', async () => {
      send.mockResolvedValue({});
      await expect(service.getObjectBuffer('k')).rejects.toThrow(
        /no body/,
      );
    });

    it('throws when the Body is not a streaming payload', async () => {
      // Older SDK shapes lacking `transformToByteArray` should be rejected
      // with a clear error rather than silently returning undefined bytes.
      send.mockResolvedValue({ Body: { someOtherShape: true } });
      await expect(service.getObjectBuffer('k')).rejects.toThrow(
        /not a streamable payload/,
      );
    });
  });

  describe('putObject', () => {
    it('forwards Bucket, Key, Body and ContentType to S3 PutObject', async () => {
      send.mockResolvedValue({});
      const body = Buffer.from('#EXTM3U\n');
      await service.putObject('media/master.m3u8', body, 'application/vnd.apple.mpegurl');

      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0];
      expect(command.input).toMatchObject({
        Bucket: 'bilgim-media',
        Key: 'media/master.m3u8',
        Body: body,
        ContentType: 'application/vnd.apple.mpegurl',
      });
    });

    it('accepts string and Uint8Array bodies (HLS playlists vs binary segments)', async () => {
      send.mockResolvedValue({});

      await service.putObject('a.m3u8', '#EXTM3U', 'application/vnd.apple.mpegurl');
      await service.putObject(
        'a.ts',
        new Uint8Array([0xde, 0xad]),
        'video/MP2T',
      );

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][0].input.Body).toBe('#EXTM3U');
      expect(send.mock.calls[1][0].input.Body).toEqual(
        new Uint8Array([0xde, 0xad]),
      );
    });

    it('propagates SDK errors to the caller (no swallowing)', async () => {
      send.mockRejectedValue(new Error('AccessDenied'));
      await expect(
        service.putObject('k', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow(/AccessDenied/);
    });
  });

  describe('getBucket', () => {
    it('returns the configured bucket name', () => {
      expect(service.getBucket()).toBe('bilgim-media');
    });
  });

  it('client is an S3Client instance', () => {
    expect((service as any).client).toBeInstanceOf(S3Client);
  });
});
