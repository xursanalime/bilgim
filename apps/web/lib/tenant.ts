/**
 * Subdomain → teacher-slug resolution for the "onlayn maktab" multi-tenant
 * routing. Kept in its own module (rather than inline in middleware.ts) so
 * the pure host-parsing logic can be unit tested without a NextRequest.
 */

export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'bilgim.uz';

/** Subdomains that belong to infrastructure/other surfaces, never a teacher. */
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'cdn',
  'mail',
  'docs',
]);

const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Resolves a `Host` header into a teacher `publicSlug`, or `null` when the
 * request targets the root app: no subdomain, a reserved subdomain, or a
 * host outside `ROOT_DOMAIN`/`*.localhost` (e.g. a Railway preview domain).
 *
 * `*.localhost` is always accepted as a subdomain host — regardless of
 * `NODE_ENV` — so local dev works via an `/etc/hosts` entry such as
 * `127.0.0.1 aziz.localhost` without further configuration.
 */
export function resolveTeacherSlug(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();

  let subdomain: string | null = null;
  if (hostname.endsWith('.localhost')) {
    subdomain = hostname.slice(0, -'.localhost'.length);
  } else if (hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    subdomain = hostname.slice(0, -`.${ROOT_DOMAIN}`.length);
  }

  if (!subdomain || !SLUG_PATTERN.test(subdomain) || RESERVED_SUBDOMAINS.has(subdomain)) {
    return null;
  }
  return subdomain;
}

const LOCALE_ROOT_PATTERN = /^\/(uz|ru|en)(\/|$)/;

/**
 * The `Set-Cookie` `Domain` attribute for the shared auth session cookie.
 *
 * Returns `.{ROOT_DOMAIN}` (or `.localhost` in dev) so a session started on
 * the root app is also valid on every `{slug}.bilgim.uz` — required because
 * enrollment/payment/live-join/homework-submit all live on the subdomain.
 * Returns `undefined` for hosts outside both (e.g. a Railway preview
 * domain), where a `Domain` attribute wouldn't match the current host and
 * the browser would reject the cookie outright — falling back to Next's
 * default host-only cookie there.
 */
export function cookieDomainFor(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const hostname = host.split(':')[0]!.toLowerCase();

  if (hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    return `.${ROOT_DOMAIN}`;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return '.localhost';
  }
  return undefined;
}

/**
 * Maps the subdomain *site root* (`/`, `/ru`, `/en`, …) to the existing
 * `/teachers/[publicSlug]` route so a teacher's subdomain renders their
 * public profile as its home page, while the browser URL stays clean.
 * Returns `null` for every other path — those aren't tenant-scoped (yet)
 * and fall through to the normal shared routing.
 */
export function mapTeacherHomePath(pathname: string, teacherSlug: string): string | null {
  const localeMatch = pathname.match(LOCALE_ROOT_PATTERN);
  const withoutLocale = localeMatch ? pathname.replace(LOCALE_ROOT_PATTERN, '/') : pathname;
  if (withoutLocale !== '/') return null;

  const localePrefix = localeMatch ? `/${localeMatch[1]}` : '';
  return `${localePrefix}/teachers/${teacherSlug}`;
}

/**
 * Builds an absolute URL on `{slug}.<current root>` — used by the "Mening
 * maktabim" settings panel's "Ko'rib chiqish" (Preview) button. Mirrors
 * whatever host the dashboard itself is currently served from (dev
 * `*.localhost:port` vs. production `ROOT_DOMAIN`) so the preview link
 * always resolves in the same environment the teacher is working in.
 */
export function buildTenantUrl(
  currentHost: string,
  slug: string,
  pathAndQuery: string,
): string {
  const [hostname, port] = currentHost.split(':');
  const isLocalDev = hostname === 'localhost' || hostname?.endsWith('.localhost');
  const portSuffix = port ? `:${port}` : '';

  if (isLocalDev) {
    return `http://${slug}.localhost${portSuffix}${pathAndQuery}`;
  }
  return `https://${slug}.${ROOT_DOMAIN}${pathAndQuery}`;
}

/**
 * The root-app host (no subdomain) that matches `host`'s environment —
 * `localhost[:port]` in dev, `ROOT_DOMAIN` otherwise. Used by the
 * middleware's "unclaimed subdomain → root domain" redirect (Task 6) so a
 * `127.0.0.1 aziz.localhost` dev test bounces to `localhost:3000`, not the
 * unreachable production `bilgim.uz`.
 */
export function rootHostFor(host: string | null | undefined): string {
  if (!host) return ROOT_DOMAIN;
  const [hostname, port] = host.split(':');
  const isLocalDev = hostname === 'localhost' || hostname?.endsWith('.localhost');
  if (isLocalDev) {
    return port ? `localhost:${port}` : 'localhost';
  }
  return ROOT_DOMAIN;
}
