/**
 * Socket.io CORS policy for the live gateways.
 *
 * Both gateways previously used `cors: { origin: true, credentials: true }`,
 * which reflects *any* `Origin` back with credentials allowed. That is
 * meaningfully dangerous here because WebSocket auth is cookie-based
 * (`bilgim_access_token`) and the cookie is scoped to `.bilgim.uz` — every
 * `{slug}.bilgim.uz` teacher subdomain is same-site, so a reflected origin
 * turns "teacher can put content on their own subdomain" into "teacher can
 * open an authenticated live socket as any visitor".
 *
 * The allow-list is the same `WEB_ORIGIN` list the HTTP CORS layer uses
 * (see `common/security/configure-security.ts`), read from the environment
 * directly because `@WebSocketGateway({...})` metadata is evaluated at class
 * decoration time, before Nest's DI container (and therefore `ConfigService`)
 * exists.
 *
 * Requests with no `Origin` header (native mobile clients, server-to-server,
 * CLI tools) are allowed: they are not browsers, so there is no ambient
 * cookie to abuse — they must present a token explicitly.
 */

export interface WsCorsOptions {
  origin: (
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
  ) => void;
  credentials: boolean;
}

/** Split a comma-separated origin list, trimming blanks and trailing slashes. */
export function parseWsOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
}

export function resolveWsCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
): WsCorsOptions {
  const allowed = parseWsOriginList(
    env.WEB_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000',
  );

  return {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowed.includes(origin.replace(/\/+$/, ''))) return cb(null, true);
      return cb(new Error(`Origin ${origin} is not allowed`), false);
    },
    credentials: true,
  };
}
