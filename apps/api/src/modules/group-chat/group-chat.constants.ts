/**
 * Module-level constants for the Group Chat surface. Mirrors
 * `dm.constants.ts` — kept dependency-free so DTOs can import it
 * without dragging in `@nestjs/*` decorators or the Prisma client.
 */

/** `ChatRoom.scope` value used by group chats. `scopeRef` is the Group.id. */
export const GROUP_CHAT_SCOPE = 'GROUP' as const;

/** Maximum length of a group chat message body (same cap as DM). */
export const MAX_GROUP_MESSAGE_BODY_LENGTH = 2000;

/** Default / max page size for message listings. */
export const GROUP_CHAT_DEFAULT_PAGE_SIZE = 50;
export const GROUP_CHAT_MAX_PAGE_SIZE = 100;

/** Maximum attachment size accepted by Group Chat (same cap as DM: 1 GiB). */
export const GROUP_CHAT_MAX_ATTACHMENT_SIZE_BYTES = 1024 * 1024 * 1024;

/** Roles allowed to use Group Chat — ADMIN never participates (Req 15.3 precedent). */
export const GROUP_CHAT_ALLOWED_ROLES = ['STUDENT', 'TEACHER'] as const;

export type GroupChatAllowedRole = (typeof GROUP_CHAT_ALLOWED_ROLES)[number];
