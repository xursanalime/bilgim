import { apiClient } from '../api-client';

export interface UserSearchResult {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

export const usersApi = {
  searchUsers: (q: string): Promise<UserSearchResult[]> =>
    apiClient.get('/users/search', { params: { q } }),
};
