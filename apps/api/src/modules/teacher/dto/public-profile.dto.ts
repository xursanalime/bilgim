import { z } from 'zod';

import {
  TEACHER_SLUG_MAX_LENGTH,
  TEACHER_SLUG_MIN_LENGTH,
  TEACHER_SLUG_PATTERN,
} from '../public-slug.constants';

/**
 * UpdatePublicProfileDto — Zod schema for PATCH /teacher/profile/public.
 *
 * `isPublic=true` makes the teacher discoverable on `/discovery/teachers`
 * AND live at `{publicSlug}.bilgim.uz` (a slug is auto-generated on first
 * enable if `publicSlug` isn't supplied); `isPublic=false` clears the slug
 * so the profile drops out of discovery and the subdomain stops resolving.
 * `headline`, `publicSlug`, `coverUrl`, and `themeColor` are all optional
 * and editable independent of the toggle — the "Mening maktabim" panel.
 */
export const UpdatePublicProfileSchema = z.object({
  isPublic: z.boolean(),
  headline: z.string().trim().max(200).optional(),
  publicSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(TEACHER_SLUG_MIN_LENGTH, `Slug kamida ${TEACHER_SLUG_MIN_LENGTH} belgidan iborat bo'lishi kerak`)
    .max(TEACHER_SLUG_MAX_LENGTH, `Slug ko'pi bilan ${TEACHER_SLUG_MAX_LENGTH} belgidan iborat bo'lishi mumkin`)
    .regex(TEACHER_SLUG_PATTERN, "Slug faqat lotin harflari, raqamlar va '-' dan iborat bo'lishi kerak")
    .optional(),
  // Accepts a valid URL, OR an empty string as an explicit "remove the
  // cover image" signal (the service maps '' → null) — omitting the field
  // entirely means "leave unchanged", so this is the only way to clear it.
  coverUrl: z.union([z.string().trim().url().max(2048), z.literal('')]).optional(),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Rang '#RRGGBB' formatida bo'lishi kerak")
    .optional(),
});

export type UpdatePublicProfileDto = z.infer<typeof UpdatePublicProfileSchema>;

/** GET /teacher/profile/public-slug/check?slug=… — debounced availability check. */
export const CheckPublicSlugSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(64),
});

export type CheckPublicSlugDto = z.infer<typeof CheckPublicSlugSchema>;

/**
 * POST /teacher/profile/public-slug/preview-token — draft field values the
 * "Ko'rib chiqish" (Preview) button wants rendered, before Save is clicked.
 * `slug` is required (it's what the preview URL is built from); the rest
 * fall back to the teacher's already-persisted profile when omitted.
 */
export const CreatePreviewTokenSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(TEACHER_SLUG_MIN_LENGTH)
    .max(TEACHER_SLUG_MAX_LENGTH)
    .regex(TEACHER_SLUG_PATTERN),
  headline: z.string().trim().max(200).optional(),
  // Same "empty string = explicitly no cover" convention as
  // UpdatePublicProfileSchema — lets the preview reflect the "O'chirish"
  // button even before Save persists it.
  coverUrl: z.union([z.string().trim().url().max(2048), z.literal('')]).optional(),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export type CreatePreviewTokenDto = z.infer<typeof CreatePreviewTokenSchema>;

/** GET /teacher-preview?token=… — public preview-resolve endpoint. */
export const ResolvePreviewSchema = z.object({
  token: z.string().trim().min(1),
});

export type ResolvePreviewDto = z.infer<typeof ResolvePreviewSchema>;
