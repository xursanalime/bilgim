import { HomeworkModuleType } from '@prisma/client';

import {
  LANGUAGE_MODULE_TYPES,
  LANGUAGE_MODULE_TYPE_SET,
  LanguageModuleType,
} from '../homework/language-module-types';

/**
 * A single entry in the global English module catalog (English-Only
 * Platform Refocus, Req 6.5, 17.2).
 */
export interface EnglishModuleCatalogEntry {
  readonly moduleType: LanguageModuleType;
  /**
   * Whether a newly created Group seeds this skill enabled by default
   * (Req 6.4). This is the platform-wide default state; admin
   * enable/disable management (Req 17.2 / 17.3, Phase 7) layers on top.
   */
  readonly defaultEnabled: boolean;
}

/**
 * The single global English module catalog — the source of the eight
 * Language_Module_Type skills available platform-wide (English-Only
 * Platform Refocus, Req 6.5).
 *
 * This **replaces the per-Specialty module catalog**: every Group on the
 * platform now draws from this one list rather than from a teacher-specific
 * `SpecialtyModule` set. `Specialty` rows are retained as read-only history
 * (Req 16.5) — they are no longer consulted when seeding a Group.
 *
 * Default state: all eight skills enabled (Req 6.4). Eight active modules
 * sit comfortably under the per-Group active cap of 10
 * (`GROUP_MODULE_ACTIVE_CAP`).
 *
 * The list is derived from `LANGUAGE_MODULE_TYPES` — the single source of
 * truth established in Task 5.1 — so the catalog can never drift to a
 * different set of skills.
 */
export const GLOBAL_ENGLISH_MODULE_CATALOG: readonly EnglishModuleCatalogEntry[] =
  LANGUAGE_MODULE_TYPES.map((moduleType) => ({
    moduleType,
    defaultEnabled: true,
  }));

/**
 * Membership check against the global English catalog (the eight skills).
 * Mirrors `isLanguageModuleType`; exposed here so catalog-module callers
 * validate against the global catalog without re-deriving the set.
 */
export function isInEnglishModuleCatalog(type: HomeworkModuleType): boolean {
  return LANGUAGE_MODULE_TYPE_SET.has(type);
}
