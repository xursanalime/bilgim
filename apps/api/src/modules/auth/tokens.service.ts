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
