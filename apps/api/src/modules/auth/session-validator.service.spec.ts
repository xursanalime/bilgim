import type { PrismaClient } from '@prisma/client';

import { SessionValidatorService } from './session-validator.service';
import { assertAccessTokenShape, type JwtPayload } from './tokens.service';

/**
 * `SessionValidatorService` is the layer that turns "this JWT has a valid
 * signature" into "this principal is allowed right now".
 *
 * Before it existed, `JwtStrategy.validate` returned the raw token payload
 * without touching the database, which meant:
 *   - logout / password reset revoked `Session` rows but left the stolen
 *     *access* token working for the rest of its TTL;
 *   - a SUSPENDED or DELETED account kept full access until expiry;
 *   - a demoted ADMIN kept admin authority, because `RolesGuard` reads the
 *     role straight off the token.
 */

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function makePayload(over: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'u@x.io',
    role: 'STUDENT',
    typ: 'access',
    iat: NOW_SECONDS,
    ...over,
  };
}

function makePrisma(
  user: {
    id?: string;
    email?: string;
    role?: string;
    status?: string;
    sessionsRevokedAt?: Date | null;
  } | null,
) {
  return {
    user: {
      findUnique: jest.fn(async () =>
        user === null
          ? null
          : {
              id: user.id ?? 'user-1',
              email: user.email ?? 'u@x.io',
              role: user.role ?? 'STUDENT',
              status: user.status ?? 'ACTIVE',
              sessionsRevokedAt: user.sessionsRevokedAt ?? null,
            },
      ),
      update: jest.fn(async () => ({})),
    },
  } as unknown as PrismaClient;
}

/** No Redis — the validator must fall back to the database, never to "allow". */
function makeService(prisma: PrismaClient) {
  return new SessionValidatorService(prisma);
}

describe('SessionValidatorService.validate', () => {
  it('accepts a live, active account', async () => {
    const service = makeService(makePrisma({}));
    await expect(service.validate(makePayload())).resolves.toMatchObject({
      sub: 'user-1',
      role: 'STUDENT',
    });
  });

  it('rejects a token whose user no longer exists', async () => {
    const service = makeService(makePrisma(null));
    await expect(service.validate(makePayload())).rejects.toThrow(
      /no longer exists/i,
    );
  });

  it.each(['SUSPENDED', 'DELETED', 'PENDING_VERIFY'])(
    'rejects a %s account',
    async (status) => {
      const service = makeService(makePrisma({ status }));
      await expect(service.validate(makePayload())).rejects.toThrow(
        new RegExp(status, 'i'),
      );
    },
  );

  it('rejects a token issued before the account revoked its sessions', async () => {
    // Password reset / "log out everywhere" / admin suspend all stamp
    // `sessionsRevokedAt`. A token minted before that instant is dead.
    const service = makeService(
      makePrisma({ sessionsRevokedAt: new Date(Date.now() + 60_000) }),
    );
    await expect(service.validate(makePayload())).rejects.toThrow(
      /revoked/i,
    );
  });

  it('accepts a token issued after the last revocation', async () => {
    const service = makeService(
      makePrisma({ sessionsRevokedAt: new Date(Date.now() - 60_000) }),
    );
    await expect(service.validate(makePayload())).resolves.toBeTruthy();
  });

  it('returns the database role, not the role baked into the token', async () => {
    // A demoted admin must lose authority immediately rather than when
    // their 15-minute token happens to expire.
    const service = makeService(makePrisma({ role: 'STUDENT' }));
    const result = await service.validate(makePayload({ role: 'ADMIN' }));
    expect(result.role).toBe('STUDENT');
  });
});

describe('assertAccessTokenShape', () => {
  it('accepts a normal session token', () => {
    expect(() => assertAccessTokenShape(makePayload())).not.toThrow();
  });

  it('accepts a legacy token minted before `typ` existed', () => {
    const legacy = makePayload();
    delete legacy.typ;
    expect(() => assertAccessTokenShape(legacy)).not.toThrow();
  });

  it('rejects a media-stream token', () => {
    // Media-stream tokens are HS256 under the SAME `JWT_SECRET` and travel
    // in a `?token=` query param (browser history, access logs, Referer).
    // Accepting one as a session would turn "saw a video URL" into "holds
    // a session" — and on the WebSocket side there is no `RolesGuard`
    // backstop.
    const streamToken = {
      sub: 'asset-uuid',
      typ: 'media-stream',
    } as unknown as JwtPayload;
    expect(() => assertAccessTokenShape(streamToken)).toThrow(
      /not an access token/i,
    );
  });

  it('rejects a payload missing the session claims', () => {
    const bare = { sub: 'asset-uuid' } as JwtPayload;
    expect(() => assertAccessTokenShape(bare)).toThrow(/not an access token/i);
  });

  it('rejects an empty payload', () => {
    expect(() => assertAccessTokenShape(null)).toThrow(/invalid token/i);
  });
});

describe('SessionValidatorService.validate — token type', () => {
  it('refuses a media-stream token before any DB lookup', async () => {
    const prisma = makePrisma({});
    const service = makeService(prisma);

    await expect(
      service.validate({ sub: 'asset-uuid', typ: 'media-stream' } as never),
    ).rejects.toThrow(/not an access token/i);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
