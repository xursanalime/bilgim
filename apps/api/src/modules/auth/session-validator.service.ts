import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { RedisService } from '../../infra/redis/redis.service';
import { assertAccessTokenShape, type JwtPayload } from './tokens.service';

/**
 * How long a validated principal stays cached. Short enough that a
 * suspension or role change takes effect almost immediately, long enough
 * that a burst of requests from one user costs a single query.
 */
export const SESSION_CACHE_TTL_SECONDS = 30;

const CACHE_PREFIX = 'session:principal:';

/** The subset of `User` the validator needs. */
interface PrincipalSnapshot {
  id: string;
  email: string;
  role: string;
  status: string;
  /** Epoch ms, or 0 when the user has never revoked. */
  revokedAtMs: number;
}

/**
 * Turns a *cryptographically valid* access token into a *currently valid*
 * principal.
 *
 * `JwtStrategy` used to return the raw JWT payload as `request.user`
 * without ever touching the database. Three problems followed from that:
 *
 *   1. **No revocation.** Logout and password reset revoke `Session` rows,
 *      but an access token is a stateless JWT — a stolen one kept working
 *      for the rest of its TTL.
 *   2. **No suspension.** A SUSPENDED or DELETED user kept full access
 *      until their token expired.
 *   3. **Stale role.** A demoted ADMIN kept admin authority, because
 *      `RolesGuard` reads the role straight off the token.
 *
 * This service closes all three: it re-reads the user, enforces
 * `status === 'ACTIVE'`, rejects tokens issued before
 * `User.sessionsRevokedAt`, and returns the **database** role rather than
 * the token's, so `RolesGuard` always sees current authority.
 *
 * The lookup is cached in Redis for {@link SESSION_CACHE_TTL_SECONDS} and
 * invalidated eagerly by {@link revokeAllSessions}, so the common path
 * stays a single Redis GET. When Redis is unavailable the cache degrades
 * to a direct query — never to "allow".
 */
@Injectable()
export class SessionValidatorService {
  private readonly logger = new Logger(SessionValidatorService.name);

  constructor(
    private readonly prisma: PrismaClient,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Validate `payload` against current database state.
   *
   * Returns the principal to attach as `request.user`, or throws when the
   * token must be rejected. Callers map the throw onto their transport's
   * 401 (`JwtStrategy`) or `WsException` (`ws-jwt.guard`).
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    assertAccessTokenShape(payload);

    const snapshot = await this.loadPrincipal(payload.sub);
    if (!snapshot) {
      throw new Error('User no longer exists');
    }
    if (snapshot.status !== 'ACTIVE') {
      throw new Error(`Account is ${snapshot.status.toLowerCase()}`);
    }

    // `iat` is in seconds. Compare at second granularity — a token minted
    // in the same second as the revocation is treated as revoked, which is
    // the safe direction to round.
    const issuedAtMs = typeof payload.iat === 'number' ? payload.iat * 1000 : 0;
    if (snapshot.revokedAtMs > 0 && issuedAtMs < snapshot.revokedAtMs + 1000) {
      throw new Error('Session has been revoked');
    }

    return {
      sub: snapshot.id,
      email: snapshot.email,
      // Authoritative role from the DB, NOT `payload.role` — otherwise a
      // demotion would not take effect until the token expired.
      role: snapshot.role,
      typ: 'access',
      ...(payload.iat !== undefined ? { iat: payload.iat } : {}),
    };
  }

  /**
   * Revoke every access token issued to `userId` up to now, and drop the
   * cached principal so the next request re-reads the row.
   *
   * Call this anywhere sessions are invalidated: password reset, password
   * change, "log out everywhere", and admin suspend/delete.
   */
  async revokeAllSessions(
    userId: string,
    tx?: { user: { update: PrismaClient['user']['update'] } },
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.user.update({
      where: { id: userId },
      data: { sessionsRevokedAt: new Date() },
    });
    await this.invalidate(userId);
  }

  /** Drop the cached principal for `userId` (no DB write). */
  async invalidate(userId: string): Promise<void> {
    const client = this.redis?.getClient?.();
    if (!client) return;
    try {
      await client.del(`${CACHE_PREFIX}${userId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate session cache for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async loadPrincipal(
    userId: string,
  ): Promise<PrincipalSnapshot | null> {
    const cached = await this.readCache(userId);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        sessionsRevokedAt: true,
      },
    });
    if (!user) return null;

    const snapshot: PrincipalSnapshot = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      revokedAtMs: user.sessionsRevokedAt?.getTime() ?? 0,
    };
    await this.writeCache(userId, snapshot);
    return snapshot;
  }

  private async readCache(userId: string): Promise<PrincipalSnapshot | null> {
    const client = this.redis?.getClient?.();
    if (!client) return null;
    try {
      const raw = await client.get(`${CACHE_PREFIX}${userId}`);
      return raw ? (JSON.parse(raw) as PrincipalSnapshot) : null;
    } catch {
      // A cache miss and a cache outage are the same thing here: fall
      // through to the database. Never fall through to "allow".
      return null;
    }
  }

  private async writeCache(
    userId: string,
    snapshot: PrincipalSnapshot,
  ): Promise<void> {
    const client = this.redis?.getClient?.();
    if (!client) return;
    try {
      await client.set(
        `${CACHE_PREFIX}${userId}`,
        JSON.stringify(snapshot),
        'EX',
        SESSION_CACHE_TTL_SECONDS,
      );
    } catch {
      // Best effort — correctness does not depend on the cache.
    }
  }
}
