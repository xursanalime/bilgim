/**
 * Discovery facet helpers (Req 15.2).
 *
 * The English-only refocus replaced the generic specialty facet with two
 * English-specific facets:
 *   - **CEFR level** (A1–C2) — multi-select.
 *   - **Exam_Track** — a single exam-preparation track slug (e.g. IELTS).
 *
 * The discovery API filters courses by `cefrLevel`/`examTrack` and teachers
 * by `taughtCefrLevels`/`examTrackFocus`. These helpers normalise the raw
 * query-string values the marketing routes read from `searchParams` and
 * provide the option lists + labels the filter UI renders.
 */

import {
  CEFR_LEVELS,
  parseCefrLevel,
  type AccentColor,
  type CefrLevel,
} from '../../lib/api/discovery';

export { CEFR_LEVELS, type CefrLevel };

/** Static class strings (not template-built) so Tailwind's JIT scanner picks
 * them up. Shared by the teacher card and profile page — the onboarding
 * wizard (a different domain, `components/dashboard/`) keeps its own copy. */
export const ACCENT_STYLES: Record<
  AccentColor,
  { tint: string; solid: string; ring: string }
> = {
  BLUE: { tint: 'bg-blue-tint', solid: 'text-blue', ring: 'ring-blue/20' },
  GREEN: { tint: 'bg-green-tint', solid: 'text-green', ring: 'ring-green/20' },
  PURPLE: { tint: 'bg-purple-tint', solid: 'text-purple', ring: 'ring-purple/20' },
  ORANGE: { tint: 'bg-orange-tint', solid: 'text-orange-600', ring: 'ring-orange/20' },
};

export interface ExamTrackOption {
  /** Matches `ExamTrack.slug` / `Course.examTrack` on the backend. */
  slug: string;
  /** Human-readable label shown in the filter UI. */
  label: string;
}

/**
 * Exam-preparation tracks offered in the discovery filter.
 *
 * Exam tracks are admin-managed (`ExamTrack` model) and have no public
 * listing endpoint, so the catalogue of common English tracks is curated
 * here. The slugs must match the backend `ExamTrack.slug` values; IELTS is
 * the canonical/primary track (Req 15.2 — "e.g. IELTS").
 */
export const EXAM_TRACKS: readonly ExamTrackOption[] = [
  { slug: 'ielts', label: 'IELTS' },
  { slug: 'toefl', label: 'TOEFL' },
  { slug: 'general', label: 'Umumiy ingliz tili' },
] as const;

/** Human label for a CEFR level (already uppercase; passthrough + guard). */
export function cefrLabel(level: string): string {
  return parseCefrLevel(level) ?? level.toUpperCase();
}

/** Human label for an exam-track slug, falling back to a title-cased slug. */
export function examTrackLabel(slug: string): string {
  const match = EXAM_TRACKS.find((t) => t.slug === slug);
  if (match) return match.label;
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Parse the `cefrLevel` value out of `searchParams` into a validated,
 * de-duplicated `CefrLevel[]`. Next.js gives a single value as a string and
 * repeated params (`?cefrLevel=A1&cefrLevel=B2`) as an array — handle both.
 */
export function parseCefrParam(
  raw: string | string[] | undefined,
): CefrLevel[] {
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: CefrLevel[] = [];
  for (const value of values) {
    const level = parseCefrLevel(value);
    if (level && !out.includes(level)) out.push(level);
  }
  return out;
}

/** Parse a single exam-track slug from `searchParams`. */
export function parseExamTrackParam(
  raw: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
