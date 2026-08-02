import apiClient from '../api-client';

export interface XpEvent {
  id: string;
  amount: number;
  reason: string;
  metadata: Record<string, any> | null;
  earnedAt: string;
}

export interface Badge {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  descriptionUz: string;
  iconUrl: string;
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  category: 'LEARNING' | 'TEACHING' | 'SOCIAL' | 'SPECIAL';
  xpReward: number;
  targetRole?: string | null;
}

export interface UserBadge {
  id: string;
  userId: string;
  badgeId: string;
  earnedAt: string;
  badge: Badge;
}

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

export interface LeaderboardEntry {
  userId: string;
  xp: number;
  rank: number;
  fullName: string;
  avatarUrl?: string | null;
}

export interface LeaderboardResponse {
  top: LeaderboardEntry[];
  myRank: { rank: number | null; score: number };
}

export interface DailyChallenge {
  id: string;
  date: string;
  nameUz: string;
  description: string;
  xpReward: number;
  targetCount: number;
  eventType: string;
  targetRole: string;
  progress: {
    currentCount: number;
    completed: boolean;
  };
}

export interface RewardItem {
  id: string;
  slug: string;
  nameUz: string;
  description: string;
  xpCost: number;
  itemType: string;
  isActive: boolean;
}

export const gamificationApi = {
  getProfile() {
    return apiClient.get<GamificationProfile>('/gamification/me');
  },

  getMyBadges() {
    return apiClient.get<UserBadge[]>('/gamification/me/badges');
  },

  getGlobalLeaderboard(limit = 100, type: 'GLOBAL' | 'WEEKLY' = 'GLOBAL') {
    return apiClient.get<LeaderboardResponse>(`/gamification/leaderboard/global?limit=${limit}&type=${type}`);
  },

  getTodayChallenges() {
    return apiClient.get<DailyChallenge[]>('/gamification/challenges/today');
  },

  getAllBadges() {
    return apiClient.get<Badge[]>('/gamification/badges');
  },

  getRewards() {
    return apiClient.get<RewardItem[]>('/gamification/rewards');
  },

  purchaseReward(itemId: string) {
    return apiClient.post<{ id: string; xpSpent: number }>(`/gamification/rewards/${itemId}/purchase`);
  }
};
