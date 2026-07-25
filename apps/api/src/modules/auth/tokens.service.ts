import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

/**
 * Payload for a short-lived, single-asset media streaming token. Unlike
 * `JwtPayload` (a full user session), this only proves "the holder was
 * authorized, at mint time, to stream HLS segments for asset `sub`" — it
 * carries no email/role and is never accepted by the normal auth guard.
 */
export interface MediaStreamTokenPayload {
  sub: string;
  typ: 'media-stream';
}

/**
 * TokensService — handles JWT generation/verification and opaque token creation.
 * Used for access tokens, refresh tokens, and email verification tokens.
 *
 * Task 24.1 hardening:
 *   - JWT signing algorithm pinned to HS256 (symmetric, secret from env).
 *   - Access TTL sourced from `JWT_ACCESS_TTL` (default 15m).
 *   - Refresh tokens are opaque (random 32-byte hex) with 30d lifetime
 *     enforced at the session row in the DB.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a JWT access token. Algorithm is pinned to HS256 to defend
   * against the classic `alg=none` / `alg` confusion class of attacks.
   * TTL is read from `JWT_ACCESS_TTL` (default 15m).
   */
  async generateAccessToken(payload: JwtPayload): Promise<string> {
    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_TTL') ?? '15m';
    return this.jwtService.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn,
    });
  }

  /**
   * Verify and decode a JWT access token. Verification is restricted to
   * HS256 to keep `alg` substitution attacks out of the trust boundary.
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      algorithms: ['HS256'],
    });
  }

  /**
   * Mint a media-stream token scoped to a single `MediaAsset`. hls.js and
   * Safari's native HLS engine can't attach custom Authorization headers to
   * every manifest/segment request they make, so this token travels as a
   * `?token=` query param instead — signed and expiry-bound, but otherwise
   * unprivileged (it proves nothing beyond "may stream this one asset").
   */
  async generateMediaStreamToken(
    assetId: string,
    ttlSeconds: number,
  ): Promise<string> {
    const payload: MediaStreamTokenPayload = { sub: assetId, typ: 'media-stream' };
    return this.jwtService.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
    });
  }

  /** Verify a media-stream token. Throws if expired, malformed, or forged. */
  async verifyMediaStreamToken(token: string): Promise<MediaStreamTokenPayload> {
    const payload = await this.jwtService.verifyAsync<MediaStreamTokenPayload>(
      token,
      { algorithms: ['HS256'] },
    );
    if (payload.typ !== 'media-stream') {
      throw new Error('Not a media-stream token');
    }
    return payload;
  }

  /**
   * Generate a cryptographically secure random token (hex string).
   * Used for email verification and password reset tokens.
   */
  generateRandomToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Hash a token using SHA-256 for secure storage.
   * We store hashed tokens in DB so that even if DB is compromised,
   * the raw tokens cannot be recovered.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
