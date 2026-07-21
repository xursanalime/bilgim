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

/**
 * Internal helper used by both the guard and the gateway's connection
 * lifecycle hook. Pulls the JWT from `socket.handshake.auth.token`,
 * `handshake.query.token`, or the standard `Authorization: Bearer`
 * header. Returns `null` when no token is present, throws `WsException`
 * when verification fails.
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

  const raw =
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
