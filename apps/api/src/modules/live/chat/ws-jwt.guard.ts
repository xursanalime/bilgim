import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

import { SessionValidatorService } from '../../auth/session-validator.service';
import { TokensService, type JwtPayload } from '../../auth/tokens.service';

/**
 * Authenticated user payload that the gateway can read from
 * `socket.data.user`. Mirrors the shape of `request.user` set by
 * `JwtStrategy` so HTTP guards (e.g. `LessonAccessGuard`) can be reused
 * down the road.
 */
export type WsAuthUser = JwtPayload;

/**
 * What we stash on `socket.data`. The raw token and the time it was last
 * checked are kept so long-lived sockets can be re-validated — see
 * `WS_REVALIDATE_INTERVAL_MS`.
 */
interface SocketAuthData {
  user?: WsAuthUser;
  rawToken?: string;
  authenticatedAt?: number;
}

/**
 * How long a socket may coast on a previous authentication before its
 * token is re-checked.
 *
 * A live class socket stays open for the length of a lesson. Caching the
 * principal for the whole connection meant an expired token, a suspended
 * account or a revoked session kept full access for hours, because the
 * check only ever ran at connect time. 60s bounds that window while
 * keeping the per-message cost at a Map lookup for all but one message a
 * minute (and `SessionValidator` caches the DB read for 30s on top).
 */
export const WS_REVALIDATE_INTERVAL_MS = 60_000;

/** Cookie the web app stores the (httpOnly) access token under. */
const ACCESS_COOKIE_NAME = 'bilgim_access_token';

/**
 * Pull the access token out of a raw `Cookie` header string. Returns
 * `undefined` when the cookie is absent or the header is malformed.
 */
function extractCookieToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === ACCESS_COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      return value ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

/**
 * Internal helper used by both the guard and the gateway's connection
 * lifecycle hook. Pulls the JWT from the httpOnly `bilgim_access_token`
 * cookie sent with the handshake (the web app's cookie-based model), and
 * still accepts `socket.handshake.auth.token`, `handshake.query.token`, or
 * the `Authorization: Bearer` header for non-browser / legacy clients.
 * Returns `null` when no token is present, throws `WsException` when
 * verification fails.
 */
export async function authenticateSocket(
  socket: Socket,
  tokens: TokensService,
  sessions?: SessionValidatorService,
): Promise<WsAuthUser | null> {
  const handshake = socket.handshake ?? ({} as Socket['handshake']);
  const fromAuth = (handshake.auth as { token?: string } | undefined)?.token;
  const fromQuery = (handshake.query as { token?: string | string[] } | undefined)
    ?.token;
  const fromHeader = handshake.headers?.authorization;
  const fromCookie = extractCookieToken(handshake.headers?.cookie);

  const raw =
    fromCookie ??
    fromAuth ??
    (Array.isArray(fromQuery) ? fromQuery[0] : fromQuery) ??
    (typeof fromHeader === 'string' && fromHeader.startsWith('Bearer ')
      ? fromHeader.slice('Bearer '.length)
      : undefined);

  if (!raw) {
    return null;
  }

  try {
    // `verifyAccessToken` checks signature, expiry and token *type* (a
    // media-stream token must never open a socket). `SessionValidator`
    // then checks the account is still live and not revoked, and returns
    // the current role.
    const verified = await tokens.verifyAccessToken(raw);
    const payload = sessions ? await sessions.validate(verified) : verified;

    socket.data = socket.data ?? {};
    const data = socket.data as SocketAuthData;
    data.user = payload;
    data.rawToken = raw;
    data.authenticatedAt = Date.now();
    return payload;
  } catch (err) {
    throw new WsException({
      code: 'INVALID_TOKEN',
      message: (err as Error).message ?? 'Invalid access token',
    });
  }
}

/**
 * WsJwtGuard — Socket.io equivalent of the HTTP `JwtAuthGuard`.
 *
 * Two responsibilities:
 *  1. On a ws message handler invocation, ensure `socket.data.user` is
 *     populated. The gateway's `handleConnection` already authenticates
 *     once on connect; this guard is the belt-and-braces re-check used
 *     by `@UseGuards(WsJwtGuard)` so individual `@SubscribeMessage`
 *     handlers can be reasoned about in isolation.
 *  2. Reject unauthenticated messages with `WsException("UNAUTHENTICATED")`
 *     so the client gets a structured error rather than a silent drop.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly tokens: TokensService,
    private readonly sessions: SessionValidatorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ws = context.switchToWs();
    const socket = ws.getClient<Socket>();
    const data = (socket.data ?? {}) as SocketAuthData;

    // Re-authenticate when the cached principal has gone stale. Previously
    // this returned `true` for any socket that had *ever* authenticated,
    // so a token that expired (or an account that got suspended) mid-call
    // kept working until the client disconnected.
    const age = Date.now() - (data.authenticatedAt ?? 0);
    if (data.user && age < WS_REVALIDATE_INTERVAL_MS) {
      return true;
    }

    const user = await authenticateSocket(socket, this.tokens, this.sessions);
    if (!user) {
      this.logger.warn(`Rejecting ws message — no token on socket ${socket.id}`);
      throw new WsException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }
    return true;
  }
}
