import type { ApiClient } from '../client';

export interface GamificationProfile {
  userId: string;
  role: 'STUDENT' | 'TEACHER';
  totalXp: number;
  weeklyXp: number;
  currentLevel: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  freezesLeft: number;
  createdAt: string;
  updatedAt: string;
  xpHistory?: XpEvent[];
}

export interface XpEvent {
  id: string;
  amount: number;
  reason: string;
  metadata: Record<string, any> | null;
  earnedAt: string;
}

export function createGamificationApi(client: ApiClient) {
  return {
    /** Get current user's gamification profile */
    getProfile() {
      return client.get<GamificationProfile>('/gamification/me');
    },
    
    // Will add other endpoints (badges, leaderboard, challenges, rewards) in future steps
  };
}
