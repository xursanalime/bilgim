/**
 * Group chat API client — wraps the NestJS `/group-chat/*` endpoints.
 *
 * A group chat is auto-provisioned 1:1 with a course `Group` (cohort):
 * the teacher becomes OWNER when the group is created, and students
 * are added as MEMBER when their enrollment is approved. OWNER/ADMIN
 * can additionally manage membership (add/remove/promote) and the
 * group photo, Telegram-style.
 *
 * The DTO shapes mirror the API contract in
 * `apps/api/src/modules/group-chat/group-chat.service.ts` and `dto/index.ts`.
 */

import { apiClient } from '../api-client';
import type { MessageReactionSummary } from './dm';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type GroupChatRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface GroupChatMessage {
  id: string;
  groupId: string;
  /** Per-room monotonic order (string — backend serializes bigint as string). */
  seq?: string;
  authorId: string;
  text: string;
  assetId?: string | null;
  assetUrl?: string | null;
  /** Set when the author edited this message after sending; null/undefined otherwise. */
  editedAt?: string | null;
  /** Set while this message is pinned to the group; null/undefined otherwise. */
  pinnedAt?: string | null;
  /** Absent for messages that never went through `listMessages` (e.g. a fresh send result). */
  reactions?: MessageReactionSummary[];
  createdAt: string;
}

export interface GroupChatSummary {
  groupId: string;
  name: string;
  hasAvatar: boolean;
  memberCount: number;
  myRole: GroupChatRole;
  lastMessage: GroupChatMessage | null;
  unreadCount: number;
  createdAt: string;
}

export interface GroupChatMemberUser {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
}

export interface GroupChatMember {
  userId: string;
  role: GroupChatRole;
  joinedAt: string;
  user: GroupChatMemberUser;
}

export interface GroupChatMessageListResponse {
  items: GroupChatMessage[];
  nextCursor: string | null;
}

export interface SendGroupMessageResult {
  message: GroupChatMessage;
}

interface ListParams {
  cursor?: string;
  pageSize?: number;
}

export const groupChatApi = {
  /** Groups the caller is an active member of, newest activity first. */
  listMyGroups() {
    return apiClient.get<GroupChatSummary[]>('/group-chat/groups');
  },

  /** Get a single group chat's summary. */
  getGroup(groupId: string) {
    return apiClient.get<GroupChatSummary>(`/group-chat/groups/${groupId}`);
  },

  /** Cursor-paginated message history for a group the caller is a member of. */
  listMessages(groupId: string, params: ListParams = {}) {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiClient.get<GroupChatMessageListResponse>(
      `/group-chat/groups/${groupId}/messages${qs ? `?${qs}` : ''}`,
    );
  },

  /** Send a message to the group. */
  sendMessage(groupId: string, text?: string | null, assetId?: string) {
    return apiClient.post<SendGroupMessageResult>(
      `/group-chat/groups/${groupId}/messages`,
      { text, assetId },
    );
  },

  /** Edit the text of a message the caller authored (within the 48h edit window). */
  editMessage(groupId: string, messageId: string, text: string) {
    return apiClient.patch<GroupChatMessage>(
      `/group-chat/groups/${groupId}/messages/${messageId}`,
      { text },
    );
  },

  /** Soft-delete a message. Author can always delete their own; OWNER/ADMIN can delete any member's message. */
  deleteMessage(groupId: string, messageId: string) {
    return apiClient.delete<void>(
      `/group-chat/groups/${groupId}/messages/${messageId}`,
    );
  },

  /** Toggle the caller's `emoji` reaction on a message (adds if absent, removes if present). */
  toggleReaction(groupId: string, messageId: string, emoji: string) {
    return apiClient.put<{ added: boolean }>(
      `/group-chat/groups/${groupId}/messages/${messageId}/reactions`,
      { emoji },
    );
  },

  /** Toggle a message's pinned state. OWNER/ADMIN only. */
  togglePin(groupId: string, messageId: string) {
    return apiClient.put<{ pinned: boolean; message: GroupChatMessage }>(
      `/group-chat/groups/${groupId}/messages/${messageId}/pin`,
    );
  },

  /** Currently-pinned messages in a group, most recently pinned first. */
  listPinnedMessages(groupId: string) {
    return apiClient.get<GroupChatMessage[]>(`/group-chat/groups/${groupId}/pinned`);
  },

  /** Mark all messages in the group as read. */
  markRead(groupId: string) {
    return apiClient.patch(`/group-chat/groups/${groupId}/read`);
  },

  /** List active members with role + profile info. */
  listMembers(groupId: string) {
    return apiClient.get<GroupChatMember[]>(
      `/group-chat/groups/${groupId}/members`,
    );
  },

  /** OWNER/ADMIN: add a user to the group chat. */
  addMember(groupId: string, userId: string) {
    return apiClient.post(`/group-chat/groups/${groupId}/members`, { userId });
  },

  /** OWNER/ADMIN: remove a member from the group chat. */
  removeMember(groupId: string, userId: string) {
    return apiClient.delete(`/group-chat/groups/${groupId}/members/${userId}`);
  },

  /** OWNER only: promote/demote a member between ADMIN and MEMBER. */
  setRole(groupId: string, userId: string, role: 'ADMIN' | 'MEMBER') {
    return apiClient.patch(
      `/group-chat/groups/${groupId}/members/${userId}/role`,
      { role },
    );
  },

  /** Leave the group chat (OWNER cannot leave). */
  leaveGroup(groupId: string) {
    return apiClient.post(`/group-chat/groups/${groupId}/leave`);
  },

  /** OWNER/ADMIN: set the group photo from an already-uploaded image asset. */
  setAvatar(groupId: string, assetId: string) {
    return apiClient.patch(`/group-chat/groups/${groupId}/avatar`, { assetId });
  },

  /** Resolve a signed URL for the group photo, or `null` if none is set. */
  getAvatarUrl(groupId: string) {
    return apiClient.get<{ url: string | null }>(
      `/group-chat/groups/${groupId}/avatar-url`,
    );
  },
};
