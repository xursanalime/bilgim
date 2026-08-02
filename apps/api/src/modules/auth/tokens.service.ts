import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /**
   * Token discriminator. Present on every token minted after the
   * `typ`-confusion fix; `undefined` on tokens issued by an older build,
   * which `JwtStrategy` still accepts during the rollout window (they
   * carry `email` + `role`, which a media-stream token never does).
   */
  typ?: 'access';
  /** Issued-at (epoch seconds), stamped by `jsonwebtoken`. */
  iat?: number;
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
 * Reject anything that is not a user session token.
 *
 * All JWTs in this app are HS256 under the same `JWT_SECRET`, so the
 * payload shape is the only thing separating a session token from a
 * media-stream token. Because a stream token travels in a `?token=` query
 * param (browser history, access logs, `Referer`), accepting one as a
 * session would turn "saw a video URL" into "holds a session".
 *
 * Two independent checks, so a token minted before `typ` existed still
 * works while a stream token can never pass:
 *   1. `typ`, when present, must be exactly `'access'`.
 *   2. `email` + `role` must be present — a `MediaStreamTokenPayload`
 *      carries neither.
 *
 * Throws a plain `Error`; callers map it to their own 401/`WsException`.
 */
export function assertAccessTokenShape(
  payload: JwtPayload | undefined | null,
): asserts payload is JwtPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid token payload');
  }
  if (payload.typ !== undefined && payload.typ !== 'access') {
    throw new Error(`Not an access token (typ=${String(payload.typ)})`);
  }
  if (!payload.sub || !payload.email || !payload.role) {
    throw new Error('Not an access token (missing session claims)');
  }
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
    // `typ: 'access'` is what lets verifiers distinguish a session token
    // from the media-stream token minted below — both are HS256 under the
    // same `JWT_SECRET`, so without a discriminator a stream token (which
    // travels in a URL query param) would authenticate as a session.
    return this.jwtService.signAsync(
      { ...payload, typ: 'access' } satisfies JwtPayload,
      {
        algorithm: 'HS256',
        expiresIn,
      },
    );
  }

  /**
   * Verify and decode a JWT access token. Verification is restricted to
   * HS256 to keep `alg` substitution attacks out of the trust boundary.
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
      algorithms: ['HS256'],
    });
    assertAccessTokenShape(payload);
    return payload;
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
