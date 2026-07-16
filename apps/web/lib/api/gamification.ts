// ═════════════════════════════════════════════════════════════════
// Gamification API wrapper.
//
// Backend endpoint assumptions (apps/api gamification module). All routes
// are authenticated and scoped to the current user via the bearer token:
//
//   GET  /gamification/me                      → GamificationProfile (xpHistory optional)
//   GET  /gamification/me/badges               → UserBadge[]  (badges the user has earned)
//   GET  /gamification/badges                  → Badge[]      (full catalogue, earned + locked)
//   GET  /gamification/leaderboard/global      → LeaderboardResponse
//          ?limit=<n>&type=GLOBAL|WEEKLY
//   GET  /gamification/challenges/today        → DailyChallenge[]  (today's challenges + progress)
//   GET  /gamification/rewards                 → RewardItem[]  (active shop catalogue)
//   POST /gamification/rewards/:itemId/purchase→ { id, xpSpent }  (spends XP, 4xx if unaffordable)
//
// Locked vs earned achievements are derived client-side by diffing the
// full catalogue (`getAllBadges`) against the user's earned set
// (`getMyBadges`); the backend is not assumed to flag locked state.
// ═════════════════════════════════════════════════════════════════

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
  /** Current user's gamification profile (XP, level, streak, optional history). */
  getProfile() {
    return apiClient.get<GamificationProfile>('/gamification/me');
  },

  /** Achievements the current user has already earned. */
  getMyBadges() {
    return apiClient.get<UserBadge[]>('/gamification/me/badges');
  },

  /** Global or weekly leaderboard plus the current user's own rank. */
  getGlobalLeaderboard(limit = 100, type: 'GLOBAL' | 'WEEKLY' = 'GLOBAL') {
    return apiClient.get<LeaderboardResponse>(
      `/gamification/leaderboard/global?limit=${limit}&type=${type}`,
    );
  },

  /** Today's daily challenges with the user's progress against each. */
  getTodayChallenges() {
    return apiClient.get<DailyChallenge[]>('/gamification/challenges/today');
  },

  /** Full achievement catalogue (earned + locked, used to render rarity). */
  getAllBadges() {
    return apiClient.get<Badge[]>('/gamification/badges');
  },

  /** Active rewards-shop catalogue purchasable with XP. */
  getRewards() {
    return apiClient.get<RewardItem[]>('/gamification/rewards');
  },

  /** Spend XP to purchase a reward item. Rejects (4xx) when unaffordable. */
  purchaseReward(itemId: string) {
    return apiClient.post<{ id: string; xpSpent: number }>(
      `/gamification/rewards/${itemId}/purchase`,
    );
  },
};
