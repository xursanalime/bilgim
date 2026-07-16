import { apiClient } from '../api-client';

export interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
}

export interface AiMessageAttachment {
  name: string;
  type: string;
  size: number;
  url?: string;
  assetId?: string;
  extractedText?: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: AiMessageAttachment[] | null;
  createdAt: string;
}

export interface ConversationDetail extends AiConversation {
  messages: AiMessage[];
}

export const aiConversationsApi = {
  list: (): Promise<AiConversation[]> =>
    apiClient.get('/ai/conversations'),

  create: (title?: string): Promise<AiConversation> =>
    apiClient.post('/ai/conversations', { title }),

  get: (id: string): Promise<ConversationDetail> =>
    apiClient.get(`/ai/conversations/${id}`),

  rename: (id: string, title: string): Promise<{ id: string; title: string }> =>
    apiClient.patch(`/ai/conversations/${id}`, { title }),

  delete: (id: string): Promise<{ deleted: boolean }> =>
    apiClient.delete(`/ai/conversations/${id}`),

  clear: (id: string): Promise<{ cleared: boolean }> =>
    apiClient.delete(`/ai/conversations/${id}/messages`),

  sendMessage: (
    id: string,
    content: string,
    attachments?: AiMessageAttachment[],
    locale?: 'uz' | 'ru' | 'en',
  ): Promise<{ message: AiMessage; conversationId: string }> =>
    apiClient.post(`/ai/conversations/${id}/messages`, {
      content,
      attachments,
      locale,
    }),
};
