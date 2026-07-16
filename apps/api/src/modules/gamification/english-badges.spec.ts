import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BadgeCategory } from '@prisma/client';

import {
  ENGLISH_BADGE_DEFINITIONS,
  ENGLISH_SKILLS,
  CEFR_LEVELS,
  EnglishBadgeDefinitionSchema,
  LEGACY_BADGE_SLUGS,
  isLegacyBadgeSlug,
  toBadgePersistencePayload,
  BadgeRethemeSchema,
} from './english-badges.constants';

/**
 * Task 7.3 — English re-theming of gamification badges/challenges.
 *
 * These tests assert:
 *  - English-themed badge definitions are present and valid (Req 13.1/13.2).
 *  - Legacy non-English badges are identified for deactivation/re-theming
 *    (Req 13.3).
 *  - The gamification module is self-contained and does not depend on the
 *    billing or live modules (Req 11.1/12.1 regression guards).
 */

describe('English badge catalog (Req 13.1/13.2)', () => {
  it('every definition passes the Zod schema', () => {
    for (const def of ENGLISH_BADGE_DEFINITIONS) {
      expect(() => EnglishBadgeDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it('uses unique slugs', () => {
    const slugs = ENGLISH_BADGE_DEFINITIONS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('includes a badge for each of the eight English skills', () => {
    for (const skill of ENGLISH_SKILLS) {
      const match = ENGLISH_BADGE_DEFINITIONS.find((d) => d.skill === skill);
      expect(match).toBeDefined();
    }
  });

  it('includes a CEFR milestone badge for each level A1..C2', () => {
    for (const level of CEFR_LEVELS) {
      const match = ENGLISH_BADGE_DEFINITIONS.find(
        (d) => d.cefrLevel === level,
      );
      expect(match).toBeDefined();
    }
  });

  it('includes at least one exam-track preparation badge', () => {
    const examTrackBadges = ENGLISH_BADGE_DEFINITIONS.filter(
      (d) => typeof d.examTrack === 'string' && d.examTrack.length > 0,
    );
    expect(examTrackBadges.length).toBeGreaterThan(0);
  });

  it('does not contain non-English legacy slugs in the active catalog', () => {
    const slugs = new Set(ENGLISH_BADGE_DEFINITIONS.map((d) => d.slug));
    for (const legacy of LEGACY_BADGE_SLUGS) {
      expect(slugs.has(legacy)).toBe(false);
    }
  });

  it('strips catalog-only theming metadata into the persistable payload', () => {
    const withMeta = ENGLISH_BADGE_DEFINITIONS.find((d) => d.skill);
    expect(withMeta).toBeDefined();
    const payload = toBadgePersistencePayload(withMeta!);
    expect(payload).not.toHaveProperty('skill');
    expect(payload).not.toHaveProperty('cefrLevel');
    expect(payload).not.toHaveProperty('examTrack');
    expect(payload.slug).toBe(withMeta!.slug);
  });
});

describe('Legacy badge identification (Req 13.3)', () => {
  it('flags the math-themed Al-Khwarizmi badge as legacy', () => {
    expect(isLegacyBadgeSlug('al_xorazmiy')).toBe(true);
  });

  it('does not flag English badges as legacy', () => {
    expect(isLegacyBadgeSlug('english_writing_master')).toBe(false);
  });
});

describe('Re-theme patch schema (Req 13.3)', () => {
  it('accepts a partial display-only patch', () => {
    expect(() =>
      BadgeRethemeSchema.parse({ nameEn: 'Writing Master' }),
    ).not.toThrow();
  });

  it('rejects an empty patch', () => {
    expect(() => BadgeRethemeSchema.parse({})).toThrow();
  });

  it('rejects unknown fields (e.g. attempting to change the slug)', () => {
    expect(() =>
      BadgeRethemeSchema.parse({ slug: 'hacked', nameEn: 'x' }),
    ).toThrow();
  });
});

describe('Gamification self-containment (Req 11.1/12.1 regression guards)', () => {
  const gamificationDir = __dirname;

  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...collectSourceFiles(full));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  it('does not import from the billing or live modules', () => {
    const files = collectSourceFiles(gamificationDir);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      // Match relative or aliased imports that reach into billing/live modules.
      if (/modules\/(billing|live(-stream)?)\b/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
