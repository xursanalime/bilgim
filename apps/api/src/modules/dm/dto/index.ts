import { z } from 'zod';

import { stripHtml } from '../../../common/sanitization';
import {
  DM_DEFAULT_PAGE_SIZE,
  DM_MAX_PAGE_SIZE,
  MAX_DM_BODY_LENGTH,
} from '../dm.constants';

const UuidSchema = z.string().uuid({ message: 'must be a valid UUID' });

const PageSizeSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(DM_MAX_PAGE_SIZE)
  .optional()
  .default(DM_DEFAULT_PAGE_SIZE);

const CursorSchema = z
  .string()
  .datetime({ message: 'cursor must be ISO-8601' })
  .optional();

/**
 * Cursor for `GET /dm/threads/:id/messages` — a `ChatMessage.seq`
 * value (per-thread monotonic order), not a timestamp. See the
 * `ChatMessage.seq` doc comment in `schema.prisma` for why message
 * pagination can't key on `createdAt`.
 */
const SeqCursorSchema = z
  .string()
  .regex(/^\d+$/, { message: 'cursor must be a non-negative integer' })
  .optional();

/**
 * `POST /dm/threads` body schema. The caller passes the recipient's
 * user id; the response carries the lazily-created thread id.
 */
export const OpenDmThreadSchema = z.object({
  recipientId: UuidSchema,
});

export type OpenDmThreadDto = z.infer<typeof OpenDmThreadSchema>;

/**
 * `POST /dm/threads/:id/messages` body schema. `text` mirrors the
 * service-layer cap so a hand-rolled client cannot bypass it.
 *
 * The body runs through `stripHtml()` (Task 29.4) so a malicious
 * teacher / student cannot ship `<script>` or `javascript:` URLs into
 * a recipient's UI. The DM client is plain-text only — markup is never
 * intended to render — so stripping is the right call rather than the
 * permissive sanitizer used for course descriptions.
 *
 * If the user submits a payload that consists solely of stripped-out
 * markup (e.g. `<script>alert(1)</script>`), the post-strip value is
 * empty and the schema rejects with a 400 rather than silently
 * persisting an empty message.
 */
export const SendDmMessageSchema = z
  .object({
    text: z
      .string()
      .max(
        MAX_DM_BODY_LENGTH,
        `text must be at most ${MAX_DM_BODY_LENGTH} characters`,
      )
      .optional()
      .nullable(),
    assetId: z.string().uuid().optional().nullable(),
  })
  .transform((data) => {
    // Sanitize text if it exists
    if (data.text) {
      data.text = stripHtml(data.text);
    }
    return data;
  })
  .refine((data) => (data.text && data.text.length > 0) || data.assetId, {
    message: 'Either text or assetId must be provided',
    path: ['text'],
  });

export type SendDmMessageDto = z.infer<typeof SendDmMessageSchema>;

/**
 * `PATCH /dm/threads/:id/messages/:messageId` body schema. Text-only —
 * attachments are immutable once sent, matching Telegram's own edit
 * behaviour (you can edit the caption, not swap the file).
 */
export const EditDmMessageSchema = z.object({
  text: z
    .string()
    .min(1, 'text is required')
    .max(
      MAX_DM_BODY_LENGTH,
      `text must be at most ${MAX_DM_BODY_LENGTH} characters`,
    )
    .transform((t) => stripHtml(t)),
});

export type EditDmMessageDto = z.infer<typeof EditDmMessageSchema>;

/**
 * `PUT /dm/threads/:id/messages/:messageId/reactions` body schema.
 * `emoji` isn't validated against a fixed allow-list — any short
 * string is accepted, since a valid emoji can be a multi-codepoint
 * ZWJ sequence (e.g. skin-tone modifiers) that a naive single-emoji
 * regex would reject. The 16-char cap matches `MessageReaction.emoji`'s
 * column width.
 */
export const ToggleReactionSchema = z.object({
  emoji: z.string().min(1, 'emoji is required').max(16, 'emoji must be at most 16 characters'),
});

export type ToggleReactionDto = z.infer<typeof ToggleReactionSchema>;

/** `GET /dm/threads` query schema. */
export const ListDmThreadsSchema = z.object({
  cursor: CursorSchema,
  pageSize: PageSizeSchema,
});

export type ListDmThreadsDto = z.infer<typeof ListDmThreadsSchema>;

/** `GET /dm/threads/:id/messages` query schema. */
export const ListDmMessagesSchema = z.object({
  cursor: SeqCursorSchema,
  pageSize: PageSizeSchema,
});

export type ListDmMessagesDto = z.infer<typeof ListDmMessagesSchema>;
