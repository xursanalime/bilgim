/**
 * Module-level constants for the Direct Messaging surface.
 *
 * Kept in their own file so the DTOs (which run before Nest's DI
 * graph is built) can import them without dragging in `@nestjs/*`
 * decorators or the Prisma client.
 */

/** Maximum length of a DM message body. (Spec: 2000 chars per message.) */
export const MAX_DM_BODY_LENGTH = 2000;

/**
 * Pre-reciprocation cap: until the *peer* has sent at least one
 * message back, the originating user can send at most this many
 * messages per peer in a 24-hour window (Req 13.3, Property 11).
 *
 * The exact value is configurable via the `DM_PRE_RECIPROCATION_LIMIT`
 * env var; the constant below is the fallback used when the env var
 * is absent or invalid.
 */
export const DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT = 5;

/** Window length for the pre-reciprocation cap (24 hours, in seconds). */
export const DM_PRE_RECIPROCATION_WINDOW_SECONDS = 24 * 60 * 60;

/** Default page size for thread / message listings. */
export const DM_DEFAULT_PAGE_SIZE = 50;

/** Hard upper bound for page size. */
export const DM_MAX_PAGE_SIZE = 100;

/** Maximum attachment size accepted by Direct Messaging: 1 GiB. */
export const DM_MAX_ATTACHMENT_SIZE_BYTES = 1024 * 1024 * 1024;

/** Roles allowed to use Direct Messaging (Req 13.4). */
export const DM_ALLOWED_ROLES = ['STUDENT', 'TEACHER'] as const;

export type DmAllowedRole = (typeof DM_ALLOWED_ROLES)[number];

/**
 * Build the Redis key used to track the per-pair pre-reciprocation
 * counter. The format is fixed by the spec: `dm:rate:{senderId}:{recipientId}`.
 *
 * Note: the counter is *directional* — `(A → B)` and `(B → A)` are
 * tracked independently. That matches the Redis-counter design
 * called out in the task brief.
 */
export function dmRateLimitKey(
  senderId: string,
  recipientId: string,
): string {
  return `dm:rate:${senderId}:${recipientId}`;
}
