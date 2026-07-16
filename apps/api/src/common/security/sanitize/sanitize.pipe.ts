import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import sanitizeHtmlLib from 'sanitize-html';

import {
  SANITIZE_KEY,
  type SanitizeOptions,
} from './sanitize.decorator';

/**
 * Strict allowlist mirroring `common/sanitization/html-sanitizer.ts`.
 * Kept duplicated here on purpose — the pipe is the *defensive* layer
 * (runs unconditionally on opt-in routes) while the html-sanitizer
 * helper is the *processing* layer (used inside services that
 * intentionally accept rich text). They can drift independently.
 */
const HTML_ALLOWED_TAGS = [
  'p',
  'a',
  'b',
  'i',
  'u',
  'em',
  'strong',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'code',
  'pre',
  'br',
];

/**
 * Patterns whose presence in a string is treated as evidence of an
 * SQL-injection attempt. Defence-in-depth — Prisma already
 * parameterises every query — so this is matched conservatively
 * against full tokens (`UNION SELECT`, `OR 1=1`, …) so a normal
 * string like "selectAllItems" never trips it.
 */
const SQL_INJECTION_PATTERNS: RegExp[] = [
  // `' OR 1=1` / `' OR '1'='1` and variants
  /(['"`])\s*(?:or|and)\s+\d+\s*=\s*\d+/i,
  /(['"`])\s*(?:or|and)\s+(['"`])\s*\w+\s*\2\s*=\s*(['"`])\s*\w+\s*\3/i,
  // `; DROP TABLE`, `; DELETE FROM`, `; UPDATE … SET`
  /;\s*(drop|truncate|delete|update|insert|alter|create)\s+(table|database|index|user|from|into)\b/i,
  // `UNION SELECT …`
  /\bunion\s+(?:all\s+)?select\b/i,
  // SQL line-comment trick: `'-- comment` or `'/* … */`
  /(['"`])\s*(?:--|#|\/\*)/,
  // EXEC / xp_cmdshell (SQL Server escape vectors)
  /\b(?:exec(?:ute)?|xp_cmdshell|sp_executesql)\s*\(/i,
];

/**
 * Range of ASCII control characters we strip unconditionally (Task 29.4).
 *
 *   - U+0000 NULL              — string termination tricks
 *   - U+0001..U+0008           — TTY / shell control
 *   - U+000B / U+000C          — VT / FF
 *   - U+000E..U+001F           — assorted control
 *   - U+007F DEL               — telnet legacy
 *
 * `\t` (U+0009), `\n` (U+000A), `\r` (U+000D) are deliberately KEPT —
 * they're the standard whitespace any text field expects.
 */
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Bidi-override / BOM / zero-width characters that have been used in
 * "Trojan Source" attacks to display benign code that executes
 * differently. Always stripped.
 */
const DANGEROUS_UNICODE_PATTERN =
  /[\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * Maximum recursion depth when walking nested DTOs. Six levels is well
 * past anything a real DTO needs while bounding stack size in case a
 * caller hands us a cyclic graph (which would also blow JSON.stringify
 * later in the pipeline anyway).
 */
const MAX_DEPTH = 6;

/**
 * Run-time strip helper — the same logic both the pipe and the
 * response interceptor reach for to clean a free-form string. Exported
 * for unit tests.
 */
export function stripControlCharacters(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  return input
    .replace(CONTROL_CHARACTER_PATTERN, '')
    .replace(DANGEROUS_UNICODE_PATTERN, '');
}

/**
 * Returns `true` if `input` matches one of the well-known SQL-injection
 * patterns. Exported so the response interceptor / log filters can
 * reuse the same heuristic.
 */
export function looksLikeSqlInjection(input: string): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) return true;
  }
  return false;
}

/**
 * Strip every tag from `input` while preserving safe content via the
 * platform allowlist. Falls back to the plain-text form when the
 * caller hasn't opted into HTML — tags are escaped, never executed.
 */
export function strictHtmlSanitize(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  return sanitizeHtmlLib(input, {
    allowedTags: HTML_ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    // Drop ALL inline `on*` attributes — sanitize-html removes them by
    // default for unknown tags but we belt-and-brace it for the
    // allowlisted ones too.
    allowedSchemesAppliedToAttributes: ['href'],
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      }),
    },
  });
}

/**
 * SanitizePipe (Task 29.4, Req 30.2).
 *
 * Walks every string in the incoming payload and strips control
 * characters / null bytes / dangerous Unicode unconditionally. Routes
 * (DTOs) that opt-in via `@Sanitize({ html, sql })` get the extra
 * passes:
 *
 *   - `html: true`  → strict HTML allowlist (no `<script>`, no inline
 *                     event handlers, only safe tags / schemes).
 *   - `sql:  true`  → reject the whole request with 400 INPUT_REJECTED
 *                     when any string matches an SQL-injection pattern.
 *
 * Order vs ValidationPipe doesn't matter — Zod / class-validator runs
 * on the same payload and sees the already-cleaned strings so a
 * `.max(...)` length cap reflects user-visible bytes, not control-char
 * noise.
 *
 * The pipe is registered as `APP_PIPE` and applies to every
 * `@Body()` / `@Query()` / `@Param()` binding. Strings that aren't
 * present (e.g. number / boolean) are returned untouched.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (value === null || value === undefined) return value;

    // Read the per-DTO override, if any. Sanitize is a CLASS decorator
    // on the DTO so the metadata surface here is `metadata.metatype`.
    const options =
      (metadata.metatype
        ? (Reflect.getMetadata(SANITIZE_KEY, metadata.metatype) as
            | SanitizeOptions
            | undefined)
        : undefined) ?? {};

    return walk(value, options, 0);
  }
}

/**
 * Recursive sanitizer. Uses a fresh shallow copy at every object
 * level so the caller's original payload is never mutated — this
 * matters for tests and middleware that look at `req.body` after the
 * pipe runs (logging, audit), and also keeps the type contract pure
 * for reasonable Zod transforms downstream.
 */
function walk(value: unknown, options: SanitizeOptions, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return sanitizeString(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, options, depth + 1));
  }
  if (typeof value === 'object') {
    // Buffers and Dates are leaf objects — never walk into them, the
    // recursive copy below would either flatten Buffers into per-byte
    // arrays or shred Date/Map/Set instances.
    if (
      Buffer.isBuffer(value) ||
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Map ||
      value instanceof Set
    ) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop known prototype-pollution keys at the input boundary —
      // even though Object.entries skips `__proto__` on plain objects,
      // a `JSON.parse('{"__proto__":…}')` payload exposes it, and the
      // pipe is the cheapest place to neuter it.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      out[key] = walk(v, options, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitizeString(input: string, options: SanitizeOptions): string {
  let cleaned = stripControlCharacters(input);
  if (options.html) {
    cleaned = strictHtmlSanitize(cleaned);
  }
  if (options.sql && looksLikeSqlInjection(cleaned)) {
    throw new BadRequestException({
      code: 'INPUT_REJECTED',
      message: 'Input contains a pattern flagged by the platform SQL filter',
    });
  }
  return cleaned;
}
