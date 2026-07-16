import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CompletePartInput, R2ObjectStream, SignedPartUrl } from './r2.service';

/**
 * LocalStorage — filesystem-backed object store used as a drop-in for R2 when
 * `STORAGE_DRIVER=local` (development / single-box deployments where the
 * machine itself is the media server). Mirrors the subset of the S3/R2
 * surface `R2Service` exposes so the higher layers stay unchanged.
 *
 * Layout (under STORAGE_DIR, default `<cwd>/.local-storage`):
 *   <root>/<key>            — the finalized object bytes
 *   <root>/<key>.cmeta      — sidecar holding the object's content-type
 *   <root>/.uploads/<id>/   — in-flight multipart parts (part-<n>) + meta
 *
 * "Presigned" URLs point back at this API's own `/storage/*` routes carrying
 * a short-lived HMAC token (op + key + exp), so the browser PUTs parts and the
 * web BFF GETs bytes without a real S3 signer. The signing secret defaults to
 * `JWT_SECRET` but can be overridden with `STORAGE_SIGNING_SECRET`.
 */
@Injectable()
export class LocalStorage {
  private readonly logger = new Logger(LocalStorage.name);
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    const dir = this.config.get<string>('STORAGE_DIR');
    this.root = dir && dir.length > 0
      ? path.resolve(dir)
      : path.resolve(process.cwd(), '.local-storage');

    const apiUrl =
      this.config.get<string>('API_PUBLIC_URL') ??
      `http://localhost:${this.config.get<string>('API_PORT') ?? '4000'}`;
    this.baseUrl = apiUrl.replace(/\/+$/, '');

    this.secret =
      this.config.get<string>('STORAGE_SIGNING_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'local-storage-dev-secret';
  }

  // ── path safety ────────────────────────────────────────────────

  /** Resolve a storage key to an absolute path, refusing path traversal. */
  private resolveKey(key: string): string {
    const clean = key.replace(/^\/+/, '');
    const abs = path.resolve(this.root, clean);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error(`Invalid storage key (path traversal): ${key}`);
    }
    return abs;
  }

  private uploadDir(uploadId: string): string {
    // uploadId is server-generated hex — still resolve defensively.
    const abs = path.resolve(this.root, '.uploads', uploadId);
    const base = path.resolve(this.root, '.uploads') + path.sep;
    if (!abs.startsWith(base)) throw new Error('Invalid uploadId');
    return abs;
  }

  // ── HMAC tokens ────────────────────────────────────────────────

  signToken(params: {
    op: 'put' | 'get';
    key: string;
    uploadId?: string;
    partNumber?: number;
    expiresInSeconds: number;
  }): string {
    const exp = Math.floor(Date.now() / 1000) + params.expiresInSeconds;
    const payload = this.tokenPayload(params.op, params.key, exp, params.uploadId, params.partNumber);
    const sig = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${exp}.${sig}`;
  }

  verifyToken(
    token: string | undefined,
    op: 'put' | 'get',
    key: string,
    uploadId?: string,
    partNumber?: number,
  ): boolean {
    if (!token) return false;
    const [expStr, sig] = token.split('.');
    if (!expStr || !sig) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const payload = this.tokenPayload(op, key, exp, uploadId, partNumber);
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private tokenPayload(
    op: string,
    key: string,
    exp: number,
    uploadId?: string,
    partNumber?: number,
  ): string {
    return [op, key, uploadId ?? '', partNumber ?? '', exp].join(':');
  }

  // ── URL builders ───────────────────────────────────────────────

  buildPartUrl(key: string, uploadId: string, partNumber: number, ttl: number): string {
    const token = this.signToken({ op: 'put', key, uploadId, partNumber, expiresInSeconds: ttl });
    const q = new URLSearchParams({
      key,
      uploadId,
      partNumber: String(partNumber),
      token,
    });
    return `${this.baseUrl}/api/v1/storage/part?${q.toString()}`;
  }

  buildObjectUrl(key: string, ttl: number): string {
    const token = this.signToken({ op: 'get', key, expiresInSeconds: ttl });
    const q = new URLSearchParams({ key, token });
    return `${this.baseUrl}/api/v1/storage/object?${q.toString()}`;
  }

  // ── multipart lifecycle ────────────────────────────────────────

  async createMultipartUpload(_key: string, contentType: string): Promise<string> {
    const uploadId = createHash('sha1')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex');
    const dir = this.uploadDir(uploadId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'content-type'), contentType, 'utf8');
    return uploadId;
  }

  async writePart(
    uploadId: string,
    partNumber: number,
    body: Readable,
  ): Promise<string> {
    const dir = this.uploadDir(uploadId);
    await fs.mkdir(dir, { recursive: true });
    const partPath = path.join(dir, `part-${partNumber}`);
    const hash = createHash('md5');
    // Tee the stream to disk + hash for the ETag.
    const ws = createWriteStream(partPath);
    await pipeline(
      body,
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk as Buffer);
          yield chunk;
        }
      },
      ws,
    );
    return `"${hash.digest('hex')}"`;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletePartInput[],
  ): Promise<{ key: string; location: string | undefined; etag: string | undefined }> {
    const dir = this.uploadDir(uploadId);
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });

    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const out = createWriteStream(target);
    try {
      for (const part of sorted) {
        const partPath = path.join(dir, `part-${part.partNumber}`);
        await pipeline(createReadStream(partPath), out, { end: false });
      }
    } finally {
      out.end();
      await new Promise<void>((resolve) => out.on('close', () => resolve()));
    }

    // Persist the content-type sidecar from the upload meta (if any).
    try {
      const ct = await fs.readFile(path.join(dir, 'content-type'), 'utf8');
      await fs.writeFile(`${target}.cmeta`, ct, 'utf8');
    } catch {
      /* no content-type recorded */
    }

    await fs.rm(dir, { recursive: true, force: true });
    return { key, location: this.buildObjectUrl(key, 600), etag: undefined };
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    await fs.rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  // ── reads ──────────────────────────────────────────────────────

  async objectExists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key));
  }

  getObjectReadStream(key: string): Readable {
    return createReadStream(this.resolveKey(key));
  }

  async getContentType(key: string): Promise<string | undefined> {
    try {
      const ct = await fs.readFile(`${this.resolveKey(key)}.cmeta`, 'utf8');
      return ct.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Open a (possibly ranged) read stream + metadata, mirroring R2ObjectStream. */
  async getObjectStream(key: string, range?: string): Promise<R2ObjectStream> {
    const target = this.resolveKey(key);
    const stat = await fs.stat(target);
    const size = stat.size;
    const contentType = await this.getContentType(key);

    let start = 0;
    let end = size - 1;
    let isPartial = false;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1]) start = Number(m[1]);
        if (m[2]) end = Number(m[2]);
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        if (start > end) start = 0;
        isPartial = true;
      }
    }

    const body = createReadStream(target, { start, end });
    const result: R2ObjectStream = {
      body,
      acceptRanges: 'bytes',
      isPartial,
      contentLength: end - start + 1,
    };
    if (contentType) result.contentType = contentType;
    if (isPartial) result.contentRange = `bytes ${start}-${end}/${size}`;
    return result;
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      typeof body === 'string' ? body : Buffer.from(body),
    );
    await fs.writeFile(`${target}.cmeta`, contentType, 'utf8');
  }

  /** Presigned-GET helpers used by the controller. */
  signUploadPart(key: string, uploadId: string, partNumber: number, ttl: number): string {
    return this.buildPartUrl(key, uploadId, partNumber, ttl);
  }

  signUploadPartBatch(
    key: string,
    uploadId: string,
    partsCount: number,
    ttl: number,
  ): SignedPartUrl[] {
    const urls: SignedPartUrl[] = [];
    for (let n = 1; n <= partsCount; n++) {
      urls.push({ partNumber: n, url: this.buildPartUrl(key, uploadId, n, ttl) });
    }
    return urls;
  }

  signObjectGet(key: string, ttl: number): string {
    return this.buildObjectUrl(key, ttl);
  }
}
