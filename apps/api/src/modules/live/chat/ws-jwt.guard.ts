import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

import { TokensService, type JwtPayload } from '../../auth/tokens.service';

/**
 * Authenticated user payload that the gateway can read from
 * `socket.data.user`. Mirrors the shape of `request.user` set by
 * `JwtStrategy` so HTTP guards (e.g. `LessonAccessGuard`) can be reused
 * down the road.
 */
export type WsAuthUser = JwtPayload;

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
    const payload = await tokens.verifyAccessToken(raw);
    socket.data = socket.data ?? {};
    (socket.data as { user?: WsAuthUser }).user = payload;
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

  constructor(private readonly tokens: TokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ws = context.switchToWs();
    const socket = ws.getClient<Socket>();

    const cached = (socket.data as { user?: WsAuthUser } | undefined)?.user;
    if (cached) {
      return true;
    }

    const user = await authenticateSocket(socket, this.tokens);
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
