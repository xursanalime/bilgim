import { z } from 'zod';

import { stripHtml } from '../../../common/sanitization';
import {
  GROUP_CHAT_DEFAULT_PAGE_SIZE,
  GROUP_CHAT_MAX_PAGE_SIZE,
  MAX_GROUP_MESSAGE_BODY_LENGTH,
} from '../group-chat.constants';

const UuidSchema = z.string().uuid({ message: 'must be a valid UUID' });

const PageSizeSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(GROUP_CHAT_MAX_PAGE_SIZE)
  .optional()
  .default(GROUP_CHAT_DEFAULT_PAGE_SIZE);

/**
 * Cursor for `GET /group-chat/groups/:groupId/messages` — a
 * `ChatMessage.seq` value (per-room monotonic order), not a
 * timestamp. See the `ChatMessage.seq` doc comment in
 * `schema.prisma` for why message pagination can't key on
 * `createdAt`.
 */
const CursorSchema = z
  .string()
  .regex(/^\d+$/, { message: 'cursor must be a non-negative integer' })
  .optional();

/** `GET /group-chat/groups/:groupId/messages` query schema. */
export const ListGroupMessagesSchema = z.object({
  cursor: CursorSchema,
  pageSize: PageSizeSchema,
});

export type ListGroupMessagesDto = z.infer<typeof ListGroupMessagesSchema>;

/**
 * `POST /group-chat/groups/:groupId/messages` body schema. Mirrors
 * `SendDmMessageSchema` — plain-text only, HTML stripped before the
 * length check so `<script>`-only payloads are rejected rather than
 * silently persisted empty.
 */
export const SendGroupMessageSchema = z
  .object({
    text: z
      .string()
      .max(
        MAX_GROUP_MESSAGE_BODY_LENGTH,
        `text must be at most ${MAX_GROUP_MESSAGE_BODY_LENGTH} characters`,
      )
      .optional()
      .nullable(),
    assetId: z.string().uuid().optional().nullable(),
  })
  .transform((data) => {
    if (data.text) {
      data.text = stripHtml(data.text);
    }
    return data;
  })
  .refine((data) => (data.text && data.text.length > 0) || data.assetId, {
    message: 'Either text or assetId must be provided',
    path: ['text'],
  });

export type SendGroupMessageDto = z.infer<typeof SendGroupMessageSchema>;

/**
 * `PATCH /group-chat/groups/:groupId/messages/:messageId` body schema.
 * Text-only — attachments are immutable once sent.
 */
export const EditGroupMessageSchema = z.object({
  text: z
    .string()
    .min(1, 'text is required')
    .max(
      MAX_GROUP_MESSAGE_BODY_LENGTH,
      `text must be at most ${MAX_GROUP_MESSAGE_BODY_LENGTH} characters`,
    )
    .transform((t) => stripHtml(t)),
});

export type EditGroupMessageDto = z.infer<typeof EditGroupMessageSchema>;

/**
 * `PUT /group-chat/groups/:groupId/messages/:messageId/reactions` body
 * schema. See the identical comment on `ToggleReactionSchema` in the
 * DM module for why `emoji` isn't validated against a fixed allow-list.
 */
export const ToggleReactionSchema = z.object({
  emoji: z.string().min(1, 'emoji is required').max(16, 'emoji must be at most 16 characters'),
});

export type ToggleReactionDto = z.infer<typeof ToggleReactionSchema>;

/** `POST /group-chat/groups/:groupId/members` body schema. */
export const AddGroupMemberSchema = z.object({
  userId: UuidSchema,
});

export type AddGroupMemberDto = z.infer<typeof AddGroupMemberSchema>;

/** `PATCH /group-chat/groups/:groupId/members/:userId/role` body schema. */
export const SetGroupMemberRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});

export type SetGroupMemberRoleDto = z.infer<typeof SetGroupMemberRoleSchema>;

/** `PATCH /group-chat/groups/:groupId/avatar` body schema. */
export const SetGroupAvatarSchema = z.object({
  assetId: UuidSchema,
});

export type SetGroupAvatarDto = z.infer<typeof SetGroupAvatarSchema>;
