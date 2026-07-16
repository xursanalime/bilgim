// ═════════════════════════════════════════════════════════════════
// Gamification UI labels & rarity styling — single source of truth.
//
// Centralizes the Uzbek (uz) copy and the design-system colour mapping
// shared by the achievements grid, rewards shop, leaderboard, and daily
// challenges so the gamification surface stays consistent and localized
// (Requirements 12.3–12.5).
//
// Rarity → semantic palette:
//   COMMON    → blue   (oddiy)
//   RARE      → green  (noyob)
//   EPIC      → purple (epik)
//   LEGENDARY → orange (afsonaviy / premium)
// ═════════════════════════════════════════════════════════════════

import type { Badge } from '../../lib/api/gamification';

type Rarity = Badge['rarity'];
type Category = Badge['category'];

/** Localized (uz) rarity labels. */
export const RARITY_LABEL_UZ: Record<Rarity, string> = {
  COMMON: 'Oddiy',
  RARE: 'Noyob',
  EPIC: 'Epik',
  LEGENDARY: 'Afsonaviy',
};

/** Localized (uz) badge-category labels. */
export const CATEGORY_LABEL_UZ: Record<Category, string> = {
  LEARNING: "O'rganish",
  TEACHING: "O'qitish",
  SOCIAL: 'Ijtimoiy',
  SPECIAL: 'Maxsus',
};

/** Badge primitive variant + tinted surface classes per rarity. */
export interface RarityStyle {
  /** Maps to the `Badge` primitive `variant` prop. */
  badgeVariant: 'blue' | 'green' | 'purple' | 'orange';
  /** Tinted icon surface (design-system tint token). */
  surface: string;
  /** Accent text colour (design-system ink/brand token). */
  text: string;
  /** Soft ring/glow colour for earned items. */
  ring: string;
}

const RARITY_STYLES: Record<Rarity, RarityStyle> = {
  COMMON: {
    badgeVariant: 'blue',
    surface: 'bg-blue-tint',
    text: 'text-blue',
    ring: 'ring-blue/30',
  },
  RARE: {
    badgeVariant: 'green',
    surface: 'bg-green-tint',
    text: 'text-green',
    ring: 'ring-green/30',
  },
  EPIC: {
    badgeVariant: 'purple',
    surface: 'bg-purple-tint',
    text: 'text-purple',
    ring: 'ring-purple/30',
  },
  LEGENDARY: {
    badgeVariant: 'orange',
    surface: 'bg-orange-tint',
    text: 'text-orange',
    ring: 'ring-orange/30',
  },
};

export function getRarityStyle(rarity: Rarity): RarityStyle {
  return RARITY_STYLES[rarity] ?? RARITY_STYLES.COMMON;
}

export function getRarityLabel(rarity: Rarity): string {
  return RARITY_LABEL_UZ[rarity] ?? rarity;
}

export function getCategoryLabel(category: Category): string {
  return CATEGORY_LABEL_UZ[category] ?? category;
}

/** Localized (uz) reasons for XP events shown in activity history. */
export const XP_REASON_LABEL_UZ: Record<string, string> = {
  homework_submitted: 'Uy vazifasi topshirildi',
  live_attended: 'Jonli darsda qatnashildi',
  badge_earned: 'Yangi yutuq',
  challenge_completed: 'Vazifa bajarildi',
  first_login: 'Tizimga kirish',
  ai_tutor_used: 'AI yordamchi ishlatildi',
  lesson_viewed: "Dars ko'rildi",
  homework_graded: 'Uy vazifasi baholandi',
  streak_milestone: 'Ketma-ketlik marrasi',
};

export function getXpReasonLabel(reason: string): string {
  return XP_REASON_LABEL_UZ[reason] ?? reason;
}

/** Locale-aware long date format used across the gamification surface. */
export function formatDateUz(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('uz-UZ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
