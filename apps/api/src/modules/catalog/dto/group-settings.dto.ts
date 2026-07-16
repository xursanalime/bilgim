import { z } from 'zod';

/**
 * Body schema for `PATCH /catalog/groups/:id/settings` — the per-Group
 * Download_Permission toggle (Content Protection Req 4.5).
 *
 * `downloadAllowed` is a **server-authoritative** field on the Group: only
 * the owning teacher (or an ADMIN) may flip it, and the value is always read
 * back from the database. The client never gets to assert this flag itself —
 * every protected-file request re-checks it server-side (Req 4.4). This DTO
 * is the single write path for the toggle.
 */
export const UpdateGroupSettingsSchema = z.object({
  downloadAllowed: z.boolean(),
});

export type UpdateGroupSettingsDto = z.infer<typeof UpdateGroupSettingsSchema>;
