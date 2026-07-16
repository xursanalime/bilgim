import { BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';
import { z } from 'zod';

/**
 * English-learning re-theming of the gamification badge/challenge catalog.
 *
 * Task 7.3 (english-only-platform-refocus): the gamification *mechanics*
 * (XP, levels, streaks, badges, rewards) are carried over unchanged
 * (Req 13.1). Only the *theming/metadata* changes: badges and challenges
 * are now framed around the eight English skills, CEFR-level milestones,
 * and exam-track (e.g. IELTS) preparation (Req 13.2/13.3).
 *
 * These definitions live in the gamification module and are self-contained:
 * they have no dependency on the billing or live modules (Req 11.1/12.1
 * regression guards).
 */

/** The eight supported English skills (mirrors the Language_Module_Type set). */
export const ENGLISH_SKILLS = [
  'READING',
  'WRITING',
  'LISTENING',
  'SPEAKING',
  'GRAMMAR',
  'VOCABULARY',
  'PRONUNCIATION',
  'SPELLING',
] as const;

export type EnglishSkill = (typeof ENGLISH_SKILLS)[number];

/** CEFR proficiency levels used for milestone badges. */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * Zod schema for an English-themed badge definition.
 *
 * The persistable subset (everything except `skill`/`cefrLevel`/`examTrack`)
 * maps 1:1 onto the existing Prisma `Badge` columns, so no schema change is
 * required. The English-theming fields are catalog-only metadata used for
 * grouping/filtering in the UI and tests.
 */
export const EnglishBadgeDefinitionSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9_]+$/, 'slug must be snake_case'),
    nameUz: z.string().min(1),
    nameRu: z.string().min(1),
    nameEn: z.string().min(1),
    descriptionUz: z.string().min(1),
    iconUrl: z.string(),
    rarity: z.nativeEnum(BadgeRarity),
    category: z.nativeEnum(BadgeCategory),
    xpReward: z.number().int().min(0),
    targetRole: z.nativeEnum(UserRole).nullable(),
    // English-theming metadata (catalog-only, not persisted on Badge):
    skill: z.enum(ENGLISH_SKILLS).optional(),
    cefrLevel: z.enum(CEFR_LEVELS).optional(),
    examTrack: z.string().min(1).optional(),
  })
  .strict();

export type EnglishBadgeDefinition = z.infer<typeof EnglishBadgeDefinitionSchema>;

/** Columns persisted to the Prisma `Badge` model. */
export interface BadgePersistencePayload {
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  descriptionUz: string;
  iconUrl: string;
  rarity: BadgeRarity;
  category: BadgeCategory;
  xpReward: number;
  targetRole: UserRole | null;
}

const S = BadgeCategory.SOCIAL;
const L = BadgeCategory.LEARNING;
const T = BadgeCategory.TEACHING;
const SP = BadgeCategory.SPECIAL;

/**
 * The English-learning badge catalog. Mechanics are unchanged; only the
 * theme/metadata is English-focused: per-skill streaks, CEFR-level
 * milestones, and exam-track preparation.
 */
export const ENGLISH_BADGE_DEFINITIONS: readonly EnglishBadgeDefinition[] = [
  // ---- Per-skill streak / mastery badges (one per English skill) ----
  {
    slug: 'english_reading_streak',
    nameUz: "O'qish ustasi",
    nameRu: 'Мастер чтения',
    nameEn: 'Reading Streak',
    descriptionUz: "Reading mashqlarini ketma-ket bajarib, o'qish ko'nikmasini mustahkamlash",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 150,
    targetRole: UserRole.STUDENT,
    skill: 'READING',
  },
  {
    slug: 'english_writing_master',
    nameUz: 'Yozuv mahorati',
    nameRu: 'Мастер письма',
    nameEn: 'Writing Master',
    descriptionUz: "Writing topshiriqlarini yuqori baholar bilan yakunlash",
    iconUrl: '',
    rarity: BadgeRarity.RARE,
    category: L,
    xpReward: 200,
    targetRole: UserRole.STUDENT,
    skill: 'WRITING',
  },
  {
    slug: 'english_listening_pro',
    nameUz: 'Tinglash ustasi',
    nameRu: 'Профи аудирования',
    nameEn: 'Listening Pro',
    descriptionUz: "Listening mashqlarini muvaffaqiyatli yakunlash",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 150,
    targetRole: UserRole.STUDENT,
    skill: 'LISTENING',
  },
  {
    slug: 'english_speaking_star',
    nameUz: "Nutq yulduzi",
    nameRu: 'Звезда речи',
    nameEn: 'Speaking Star',
    descriptionUz: "Speaking topshiriqlari uchun audio javoblarni topshirish",
    iconUrl: '',
    rarity: BadgeRarity.EPIC,
    category: L,
    xpReward: 300,
    targetRole: UserRole.STUDENT,
    skill: 'SPEAKING',
  },
  {
    slug: 'english_grammar_guru',
    nameUz: 'Grammatika bilimdoni',
    nameRu: 'Гуру грамматики',
    nameEn: 'Grammar Guru',
    descriptionUz: "Grammar topshiriqlarini xatosiz yakunlash",
    iconUrl: '',
    rarity: BadgeRarity.RARE,
    category: L,
    xpReward: 200,
    targetRole: UserRole.STUDENT,
    skill: 'GRAMMAR',
  },
  {
    slug: 'english_vocabulary_collector',
    nameUz: "So'z boyligi to'plovchisi",
    nameRu: 'Коллекционер слов',
    nameEn: 'Vocabulary Collector',
    descriptionUz: "Vocabulary mashqlarida yangi so'zlarni o'zlashtirish",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 150,
    targetRole: UserRole.STUDENT,
    skill: 'VOCABULARY',
  },
  {
    slug: 'english_pronunciation_ace',
    nameUz: "Talaffuz ustasi",
    nameRu: 'Ас произношения',
    nameEn: 'Pronunciation Ace',
    descriptionUz: "Pronunciation topshiriqlarida yuqori talaffuz baholarini olish",
    iconUrl: '',
    rarity: BadgeRarity.EPIC,
    category: L,
    xpReward: 300,
    targetRole: UserRole.STUDENT,
    skill: 'PRONUNCIATION',
  },
  {
    slug: 'english_spelling_champion',
    nameUz: 'Imlo chempioni',
    nameRu: 'Чемпион орфографии',
    nameEn: 'Spelling Champion',
    descriptionUz: "Spelling mashqlarini xatosiz yakunlash",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 150,
    targetRole: UserRole.STUDENT,
    skill: 'SPELLING',
  },

  // ---- CEFR-level milestone badges (A1 → C2) ----
  {
    slug: 'cefr_a1_starter',
    nameUz: 'A1 — Boshlovchi',
    nameRu: 'A1 — Начинающий',
    nameEn: 'A1 Starter',
    descriptionUz: "A1 darajasiga erishish",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 100,
    targetRole: UserRole.STUDENT,
    cefrLevel: 'A1',
  },
  {
    slug: 'cefr_a2_elementary',
    nameUz: 'A2 — Elementar',
    nameRu: 'A2 — Элементарный',
    nameEn: 'A2 Elementary',
    descriptionUz: "A2 darajasiga erishish",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 150,
    targetRole: UserRole.STUDENT,
    cefrLevel: 'A2',
  },
  {
    slug: 'cefr_b1_intermediate',
    nameUz: "B1 — O'rta",
    nameRu: 'B1 — Средний',
    nameEn: 'B1 Intermediate',
    descriptionUz: "B1 darajasiga erishish",
    iconUrl: '',
    rarity: BadgeRarity.RARE,
    category: L,
    xpReward: 250,
    targetRole: UserRole.STUDENT,
    cefrLevel: 'B1',
  },
  {
    slug: 'cefr_b2_upper_intermediate',
    nameUz: "B2 — O'rtadan yuqori",
    nameRu: 'B2 — Выше среднего',
    nameEn: 'B2 Upper-Intermediate',
    descriptionUz: "B2 darajasiga erishish",
    iconUrl: '',
    rarity: BadgeRarity.RARE,
    category: L,
    xpReward: 350,
    targetRole: UserRole.STUDENT,
    cefrLevel: 'B2',
  },
  {
    slug: 'cefr_c1_advanced',
    nameUz: 'C1 — Ilg\'or',
    nameRu: 'C1 — Продвинутый',
    nameEn: 'C1 Advanced',
    descriptionUz: "C1 darajasiga erishish",
    iconUrl: '',
    rarity: BadgeRarity.EPIC,
    category: L,
    xpReward: 500,
    targetRole: UserRole.STUDENT,
    cefrLevel: 'C1',
  },
  {
    slug: 'cefr_c2_proficient',
    nameUz: 'C2 — Mukammal',
    nameRu: 'C2 — Профессиональный',
    nameEn: 'C2 Proficient',
    descriptionUz: "C2 darajasiga erishish",
    iconUrl: '',
    rarity: BadgeRarity.LEGENDARY,
    category: L,
    xpReward: 750,
    targetRole: UserRole.STUDENT,
    cefrLevel: 'C2',
  },

  // ---- Exam-track preparation badges ----
  {
    slug: 'ielts_prep_finisher',
    nameUz: 'IELTS tayyorgarlik',
    nameRu: 'Подготовка к IELTS',
    nameEn: 'IELTS Prep Finisher',
    descriptionUz: "IELTS tayyorgarlik trekidagi topshiriqlarni yakunlash",
    iconUrl: '',
    rarity: BadgeRarity.EPIC,
    category: L,
    xpReward: 400,
    targetRole: UserRole.STUDENT,
    examTrack: 'IELTS',
  },

  // ---- Cross-cutting engagement badges (re-themed for English) ----
  {
    slug: 'english_streak_7',
    nameUz: '7 kunlik amaliyot',
    nameRu: '7 дней практики',
    nameEn: '7-Day English Streak',
    descriptionUz: "7 kun ketma-ket ingliz tili mashqlarini bajarish",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 150,
    targetRole: UserRole.STUDENT,
  },
  {
    slug: 'english_early_bird',
    nameUz: "Erta topshiruvchi",
    nameRu: 'Ранняя пташка',
    nameEn: 'Early Bird',
    descriptionUz: "Ingliz tili uy vazifasini deadline'dan 24 soat oldin topshirish",
    iconUrl: '',
    rarity: BadgeRarity.COMMON,
    category: L,
    xpReward: 50,
    targetRole: UserRole.STUDENT,
  },
  {
    slug: 'platform_pioneer',
    nameUz: 'Platforma kashfiyotchisi',
    nameRu: 'Пионер платформы',
    nameEn: 'Platform Pioneer',
    descriptionUz: "Birinchi 1000 foydalanuvchidan biri bo'lish",
    iconUrl: '',
    rarity: BadgeRarity.LEGENDARY,
    category: SP,
    xpReward: 500,
    targetRole: null,
  },
  {
    slug: 'english_instructor_mentor',
    nameUz: 'Ingliz tili mentori',
    nameRu: 'Наставник по английскому',
    nameEn: 'English Instructor Mentor',
    descriptionUz: "O'quvchilarning ingliz tili topshiriqlarini tezkor va sifatli baholash",
    iconUrl: '',
    rarity: BadgeRarity.EPIC,
    category: T,
    xpReward: 350,
    targetRole: UserRole.TEACHER,
  },
];

/**
 * Legacy / non-English badge slugs from the pre-refocus generic catalog.
 * These reference non-English subjects (e.g. the math-themed
 * "Al-Khwarizmi successor") and should be deactivated or re-themed rather
 * than deleted, so historical awards (UserBadge rows) are preserved
 * (Req 13.3, non-destructive).
 */
export const LEGACY_BADGE_SLUGS = [
  'al_xorazmiy', // "Al-Khwarizmi successor" — math-themed, non-English
] as const;

export type LegacyBadgeSlug = (typeof LEGACY_BADGE_SLUGS)[number];

export function isLegacyBadgeSlug(slug: string): boolean {
  return (LEGACY_BADGE_SLUGS as readonly string[]).includes(slug);
}

/** Strip catalog-only theming metadata down to the persistable Badge columns. */
export function toBadgePersistencePayload(
  def: EnglishBadgeDefinition,
): BadgePersistencePayload {
  return {
    slug: def.slug,
    nameUz: def.nameUz,
    nameRu: def.nameRu,
    nameEn: def.nameEn,
    descriptionUz: def.descriptionUz,
    iconUrl: def.iconUrl,
    rarity: def.rarity,
    category: def.category,
    xpReward: def.xpReward,
    targetRole: def.targetRole,
  };
}

/** Zod schema for a partial re-theme patch applied to an existing badge. */
export const BadgeRethemeSchema = z
  .object({
    nameUz: z.string().min(1).optional(),
    nameRu: z.string().min(1).optional(),
    nameEn: z.string().min(1).optional(),
    descriptionUz: z.string().min(1).optional(),
    iconUrl: z.string().optional(),
    rarity: z.nativeEnum(BadgeRarity).optional(),
    category: z.nativeEnum(BadgeCategory).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Re-theme patch must contain at least one field',
  });

export type BadgeRethemePatch = z.infer<typeof BadgeRethemeSchema>;
