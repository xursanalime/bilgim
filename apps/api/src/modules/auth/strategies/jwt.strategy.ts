import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

import { SessionValidatorService } from '../session-validator.service';
import { JwtPayload } from '../tokens.service';

/**
 * JwtStrategy — Passport strategy for verifying access tokens on protected
 * routes. Registered with the global JwtAuthGuard via @nestjs/passport.
 *
 * Tokens are read from `Authorization: Bearer <token>`. Browser clients do
 * not send the token themselves at all: it lives in an httpOnly cookie
 * that only the Next.js BFF (`apps/web/app/api/proxy`) can read, and the
 * BFF attaches this header on their behalf.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly sessions: SessionValidatorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Restrict to HS256 (Task 24.1) — defends against `alg=none` and
      // other algorithm-confusion bypasses on inbound tokens.
      algorithms: ['HS256'],
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * A valid signature is necessary but not sufficient. `SessionValidator`
   * re-reads the user and rejects tokens belonging to suspended/deleted
   * accounts or issued before the account's last revocation, then returns
   * the *current* role — so a demoted admin loses authority immediately
   * rather than when their token happens to expire.
   *
   * It also rejects any token that is not a user session token (the
   * media-stream token minted by `TokensService` is HS256 under the same
   * secret and travels in a URL query param, so it must never be usable
   * here).
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    try {
      return await this.sessions.validate(payload);
    } catch (err) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: (err as Error).message || 'Invalid token payload',
      });
    }
  }
}
