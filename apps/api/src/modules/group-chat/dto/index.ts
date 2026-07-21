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

const CursorSchema = z
  .string()
  .datetime({ message: 'cursor must be ISO-8601' })
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
