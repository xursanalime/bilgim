/**
 * `TeacherProfile.publicSlug` format rules — the label used as
 * `{slug}.bilgim.uz`. Mirrors `apps/web/lib/tenant.ts`'s `RESERVED_SUBDOMAINS`
 * / slug pattern; keep the two lists in sync if either changes.
 */

export const RESERVED_TEACHER_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'cdn',
  'mail',
  'docs',
]);

export const TEACHER_SLUG_MIN_LENGTH = 3;
export const TEACHER_SLUG_MAX_LENGTH = 32;
export const TEACHER_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SlugRejectionReason = 'invalid' | 'reserved' | 'taken';

/** Structural validity only — does not check reserved-word or uniqueness. */
export function isValidSlugFormat(slug: string): boolean {
  return (
    slug.length >= TEACHER_SLUG_MIN_LENGTH &&
    slug.length <= TEACHER_SLUG_MAX_LENGTH &&
    TEACHER_SLUG_PATTERN.test(slug)
  );
}
