import { SetMetadata } from '@nestjs/common';

/** Reflector key consumed by {@link SanitizePipe}. */
export const SANITIZE_KEY = 'security:sanitize';

export interface SanitizeOptions {
  /**
   * Run the value through `sanitize-html` with the strict allowlist so
   * `<script>` / inline event handlers / `javascript:` URLs are
   * stripped. Default `false` — most fields are plain text and any
   * surviving `<` / `>` should be left intact for users to read back
   * verbatim.
   */
  html?: boolean;
  /**
   * Reject (with `INPUT_REJECTED`) strings that match one of the well-
   * known SQL-injection patterns (`' OR 1=1`, `;DROP TABLE`, `UNION
   * SELECT`, …). Defence-in-depth — Prisma already parameterises every
   * query, so this catches typos / log poisoning rather than real
   * injection. Default `false`.
   */
  sql?: boolean;
}

/**
 * Per-route override for {@link SanitizePipe}. Defaults are the safest
 * common posture: control characters / null bytes / dangerous Unicode
 * are always stripped (that's what the pipe does globally), and the
 * decorator only opts IN to the more aggressive HTML / SQL passes
 * because they're lossy for fields that legitimately accept rich text
 * or SQL fragments (analytics queries, AI prompts, etc.).
 *
 * Usage:
 * ```ts
 * @Sanitize({ html: true })
 * @Post('articles')
 * createArticle(@Body() dto: CreateArticleDto) { ... }
 * ```
 */
export const Sanitize = (options: SanitizeOptions = {}) =>
  SetMetadata(SANITIZE_KEY, options);
