import { apiClient } from '../api-client';

// ═════════════════════════════════════════════════════════════════
// Group chat API (Telegram-style groups). Backed by `/dm/groups/*`.
// ═════════════════════════════════════════════════════════════════

export interface GroupMember {
  id: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | string;
}

export interface GroupMessage {
  id: string;
  roomId: string;
  authorId: string;
  author: { id: string; fullName: string; avatarUrl: string | null } | null;
  text: string;
  assetId: string | null;
  createdAt: string;
}

export interface GroupSummary {
  id: string;
  title: string;
  username: string | null;
  avatarAssetId: string | null;
  inviteToken: string | null;
  createdById: string | null;
  memberCount: number;
  myRole: string;
  lastMessage: GroupMessage | null;
  unreadCount: number;
  createdAt: string;
}

export type GroupDetail = GroupSummary & { members: GroupMember[] };

export interface GroupPreview {
  id: string;
  title: string;
  username: string | null;
  avatarAssetId: string | null;
  memberCount: number;
  isMember: boolean;
}

export const groupsApi = {
  list: () => apiClient.get<GroupSummary[]>('/dm/groups'),

  create: (title: string, memberIds: string[]) =>
    apiClient.post<GroupSummary>('/dm/groups', { title, memberIds }),

  get: (id: string) => apiClient.get<GroupDetail>(`/dm/groups/${id}`),

  update: (
    id: string,
    patch: { title?: string; username?: string | null; avatarAssetId?: string | null },
  ) => apiClient.patch<GroupSummary>(`/dm/groups/${id}`, patch),

  listMessages: (id: string, params: { cursor?: string; pageSize?: number } = {}) =>
    apiClient.get<{ items: GroupMessage[]; nextCursor: string | null }>(
      `/dm/groups/${id}/messages`,
      { params },
    ),

  sendMessage: (id: string, text: string, assetId?: string) =>
    apiClient.post<GroupMessage>(`/dm/groups/${id}/messages`, {
      ...(text ? { text } : {}),
      ...(assetId ? { assetId } : {}),
    }),

  markRead: (id: string) => apiClient.patch<void>(`/dm/groups/${id}/read`, {}),

  addMembers: (id: string, userIds: string[]) =>
    apiClient.post<GroupMember[]>(`/dm/groups/${id}/members`, { userIds }),

  removeMember: (id: string, userId: string) =>
    apiClient.delete<void>(`/dm/groups/${id}/members/${userId}`),

  setRole: (id: string, userId: string, role: 'ADMIN' | 'MEMBER') =>
    apiClient.patch<GroupMember[]>(`/dm/groups/${id}/members/${userId}/role`, { role }),

  rotateInvite: (id: string) =>
    apiClient.post<{ inviteToken: string }>(`/dm/groups/${id}/invite`, {}),

  revokeInvite: (id: string) => apiClient.delete<void>(`/dm/groups/${id}/invite`),

  preview: (params: { token?: string; username?: string }) =>
    apiClient.get<GroupPreview>('/dm/groups/preview', { params }),

  join: (body: { token?: string; username?: string }) =>
    apiClient.post<GroupSummary>('/dm/groups/join', body),
};
