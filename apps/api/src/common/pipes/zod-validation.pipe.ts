import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Per-pipe override of the platform-wide string / array caps.
 *
 * Defaults are deliberately conservative — see the constants below for
 * rationale — but specific schemas need wider room (e.g. AI prompts,
 * homework solutions). Pass `maxStringLength` / `maxArrayLength` when
 * constructing the pipe to relax them. A Zod `.max(...)` on the
 * specific field still wins, since it runs *after* the structural caps
 * here and can only ever shrink the surface.
 */
export interface ZodValidationOptions {
  /**
   * Max code-unit length permitted for any single string field reached
   * during the structural pre-walk. Defaults to {@link DEFAULT_MAX_STRING_LENGTH}.
   * Strings longer than this are rejected with `INPUT_TOO_LARGE` *before*
   * Zod runs — this stops a 500MB body containing a single string from
   * ever blowing up the parser, even if the field has no `.max(...)`.
   */
  maxStringLength?: number;
  /**
   * Max element count permitted for any array reached during the pre-walk.
   * Defaults to {@link DEFAULT_MAX_ARRAY_LENGTH}.
   */
  maxArrayLength?: number;
}

/**
 * Platform-wide default string ceiling (Task 29.4).
 *
 * 10,000 chars covers every plain-text field (names, titles, addresses,
 * short descriptions) and most rich-text fields short of book-length
 * content. Endpoints that legitimately accept large text — AI prompts
 * (32k), homework solutions (50k), markdown CMS bodies — opt into a
 * higher cap explicitly via {@link ZodValidationOptions.maxStringLength}.
 */
export const DEFAULT_MAX_STRING_LENGTH = 10_000;

/**
 * Platform-wide default array ceiling (Task 29.4).
 *
 * 1,000 elements is well past every UI surface (the dashboard lists
 * cap at 100, the bulk-importer at 500) while small enough to stop a
 * caller from passing a 10-million-element array as a single field
 * and DoS-ing the server's memory.
 */
export const DEFAULT_MAX_ARRAY_LENGTH = 1_000;

/**
 * NUL byte (`U+0000`) — rejected unconditionally regardless of any
 * decorator opt-ins. C-string termination tricks ride on this byte and
 * no legitimate user-facing text should ever contain it.
 */
const NUL_BYTE_PATTERN = /\u0000/;

/**
 * Control characters in `U+0000`–`U+001F` *except* `\t` (U+0009),
 * `\n` (U+000A), `\r` (U+000D). The DEL byte (`U+007F`) is also
 * rejected; it survives a lot of historical telnet workflows but
 * no modern field accepts it. Matches the parallel definition in
 * `common/security/sanitize/sanitize.pipe.ts` so the two layers
 * agree on what's "control".
 */
const CONTROL_CHAR_PATTERN =
  /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Recursion budget for the structural pre-walk. */
const MAX_DEPTH = 8;

/**
 * Zod validation pipe — enforces a structural pre-walk (NUL bytes,
 * control characters, string + array length caps) and then runs the
 * caller-supplied Zod schema. Returns 400 with one of three error
 * codes:
 *
 *   - `INPUT_REJECTED`  → NUL byte / control char in any string field
 *   - `INPUT_TOO_LARGE` → string > 10k chars OR array > 1k elements
 *   - `VALIDATION_FAILED` → schema mismatch (the original Zod path)
 *
 * The pre-walk runs BEFORE Zod for two reasons:
 *
 *   1. Defence-in-depth: a schema author who forgets `.max(...)` on
 *      every string still gets the platform cap for free. Zod is
 *      additive — its `.max(...)` can shrink the cap further but never
 *      widens it.
 *
 *   2. DoS resistance: a 50MB string buried inside a JSON body would
 *      otherwise reach `schema.safeParse(...)` and be deep-cloned by
 *      Zod's transformer pipeline. Rejecting it structurally means we
 *      spend O(string-length) work once and bail.
 *
 * Implements Requirements 25.1, 30.2, 30.7.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly maxStringLength: number;
  private readonly maxArrayLength: number;

  constructor(
    private readonly schema: ZodSchema,
    options: ZodValidationOptions = {},
  ) {
    this.maxStringLength =
      options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
    this.maxArrayLength = options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH;

    if (
      !Number.isFinite(this.maxStringLength) ||
      this.maxStringLength <= 0 ||
      !Number.isFinite(this.maxArrayLength) ||
      this.maxArrayLength <= 0
    ) {
      throw new Error(
        'ZodValidationPipe: maxStringLength / maxArrayLength must be positive numbers',
      );
    }
  }

  transform(value: unknown, _metadata: ArgumentMetadata) {
    // ---- 1. Structural pre-walk ----------------------------------------
    this.preWalk(value, [], 0);

    // ---- 2. Zod schema --------------------------------------------------
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: this.formatZodError(result.error),
      });
    }

    return result.data;
  }

  /**
   * Recursive structural check. Throws with `INPUT_REJECTED` /
   * `INPUT_TOO_LARGE` and a human-readable path so the API caller can
   * locate the offending field quickly. Pure — never mutates the
   * input — so the original payload reaches Zod untouched.
   *
   * Bails on:
   *
   *   - depth > MAX_DEPTH       (cyclic / pathological payloads)
   *   - Buffer / Date / typed
   *     arrays / Map / Set       (leaf objects — already validated by
   *                               the controller layer or by Zod's
   *                               `instanceof` schemas)
   */
  private preWalk(value: unknown, path: Array<string | number>, depth: number): void {
    if (depth > MAX_DEPTH) return;
    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
      this.assertSafeString(value, path);
      return;
    }
    if (typeof value !== 'object') return;

    if (
      Buffer.isBuffer(value) ||
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Map ||
      value instanceof Set ||
      ArrayBuffer.isView(value)
    ) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > this.maxArrayLength) {
        throw new BadRequestException({
          code: 'INPUT_TOO_LARGE',
          message: `Array exceeds the ${this.maxArrayLength}-element platform cap`,
          details: [
            {
              path: formatPath(path),
              limit: this.maxArrayLength,
              actual: value.length,
            },
          ],
        });
      }
      for (let i = 0; i < value.length; i++) {
        this.preWalk(value[i], [...path, i], depth + 1);
      }
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Drop prototype-pollution keys silently — same as SanitizePipe.
      // The pipe doesn't *strip* them (that would mutate the caller's
      // input), it just refuses to walk into them so they can't hide a
      // huge string from the cap. Zod's `.strict()` will reject them
      // outright a moment later.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      this.preWalk(child, [...path, key], depth + 1);
    }
  }

  /**
   * Reject NUL bytes / control characters / over-the-cap strings. The
   * NUL check fires first so the resulting error message points at the
   * actual problem (a forged string termination) rather than at the
   * length cap — the two errors carry different remediation advice.
   */
  private assertSafeString(input: string, path: Array<string | number>): void {
    if (NUL_BYTE_PATTERN.test(input)) {
      throw new BadRequestException({
        code: 'INPUT_REJECTED',
        message: 'String fields must not contain NUL bytes (U+0000)',
        details: [{ path: formatPath(path), reason: 'nul_byte' }],
      });
    }
    if (CONTROL_CHAR_PATTERN.test(input)) {
      throw new BadRequestException({
        code: 'INPUT_REJECTED',
        message:
          'String fields must not contain control characters (U+0000-U+001F except \\t \\n \\r)',
        details: [{ path: formatPath(path), reason: 'control_char' }],
      });
    }
    if (input.length > this.maxStringLength) {
      throw new BadRequestException({
        code: 'INPUT_TOO_LARGE',
        message: `String field exceeds the ${this.maxStringLength}-character platform cap`,
        details: [
          {
            path: formatPath(path),
            limit: this.maxStringLength,
            actual: input.length,
          },
        ],
      });
    }
  }

  private formatZodError(error: ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
  }
}

/**
 * Pretty-print a path array for error messages. `[]` → `"<root>"`,
 * `["body","items",2,"name"]` → `"body.items[2].name"`. Kept here
 * (not exported) so the format is consistent across error codes.
 */
function formatPath(path: Array<string | number>): string {
  if (path.length === 0) return '<root>';
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? segment : `.${segment}`;
    }
  }
  return out;
}
