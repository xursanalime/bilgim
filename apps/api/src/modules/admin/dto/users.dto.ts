import { z } from 'zod';

import { stripHtml } from '../../../common/sanitization';

/**
 * Query for `GET /admin/users` (Req 24 — admin user moderation).
 *
 * Filters mirror the only indexes that exist on `User` so admin lookups
 * stay cheap even on a large data set:
 *   - `role`   — exact match on `User.role` (uses the `(role, status)` index).
 *   - `status` — exact match on `User.status` (same composite index).
 *   - `q`      — fuzzy match against `email`, `username`, `fullName`.
 *
 * Pagination: classic `page` / `pageSize` (1-indexed, clamped) — admin
 * lists are short enough that keyset pagination would just complicate the
 * UI; switching is an internal change that does not break the contract.
 */
export const ListUsersQuerySchema = z.object({
  role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']).optional(),
  status: z
    .enum(['PENDING_VERIFY', 'ACTIVE', 'SUSPENDED', 'DELETED'])
    .optional(),
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>;

/**
 * Body for `PATCH /admin/users/:id/status` (Req 24.4).
 *
 * `ACTIVE`    — un-suspend a previously suspended account.
 * `SUSPENDED` — admin moderation action; sessions are revoked.
 * `DELETED`   — soft delete; sessions are revoked.
 *
 * `PENDING_VERIFY` is intentionally absent — admins should never push a
 * verified user back to that state through this endpoint.
 */
export const UpdateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']),
  reason: z.string().trim().min(1).max(500).transform(stripHtml).optional(),
});

export type UpdateUserStatusDto = z.infer<typeof UpdateUserStatusSchema>;

/**
 * Body for `POST /admin/users/:id/ban` (Req 24.4).
 *
 * `reason` is optional but strongly encouraged — admins reviewing the
 * audit log later need context, and the moderation UI surfaces it on the
 * user's profile. Stored verbatim in the audit payload; redact upstream
 * if PII concerns arise.
 *
 * The reason is run through `stripHtml()` so a rogue admin cannot stash
 * markup that the audit-log viewer would render as live HTML.
 */
export const BanUserSchema = z.object({
  reason: z.string().trim().min(1).max(500).transform(stripHtml).optional(),
});

export type BanUserDto = z.infer<typeof BanUserSchema>;

/** Body for `POST /admin/users/:id/unban`. Same shape as ban. */
export const UnbanUserSchema = BanUserSchema;
export type UnbanUserDto = z.infer<typeof UnbanUserSchema>;

/**
 * Body for `PATCH /admin/users/:id/role` (Req 24.4).
 *
 * Role escalation is a high-impact action — the audit row records the
 * old/new role pair so reviewers can trace privilege grants without
 * cross-referencing user history. `reason` is optional but strongly
 * encouraged for the same reason as ban/unban.
 */
export const UpdateUserRoleSchema = z.object({
  role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']),
  reason: z.string().trim().min(1).max(500).transform(stripHtml).optional(),
});

export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleSchema>;
