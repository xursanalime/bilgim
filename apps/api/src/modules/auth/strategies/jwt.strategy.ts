import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

import { JwtPayload } from '../tokens.service';

/**
 * JwtStrategy — Passport strategy for verifying access tokens on protected
 * routes. Registered with the global JwtAuthGuard via @nestjs/passport.
 *
 * Token sources, in order:
 *   1. Authorization: Bearer <token> header
 *   2. access_token cookie (set by /auth/login for browser clients)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: { cookies?: Record<string, string> }) =>
          request?.cookies?.['access_token'] ?? null,
      ]),
      ignoreExpiration: false,
      // Restrict to HS256 (Task 24.1) — defends against `alg=none` and
      // other algorithm-confusion bypasses on inbound tokens.
      algorithms: ['HS256'],
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Validated payload becomes `request.user`. We don't fetch the user from
   * DB here — downstream guards/controllers can use UsersRepository if they
   * need fresh data.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Invalid token payload',
      });
    }
    return payload;
  }
}
