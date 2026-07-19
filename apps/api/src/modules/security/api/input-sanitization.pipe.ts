import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

/**
 * Dangerous patterns for detecting injection attacks.
 * Each pattern targets a specific attack vector.
 */
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<link[\s>]/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /<svg[\s>].*?on\w+/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*javascript/i,
];

const SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter|create|exec|execute)\b\s+(all\s+)?)/i,
  /(\b(or|and)\b\s+[\d'"].*?[=<>])/i,
  /(--|#|\/\*)\s/,
  /'\s*(or|and)\s+'.*?'/i,
  /;\s*(drop|delete|update|insert|alter|create)\b/i,
  /\bwaitfor\s+delay\b/i,
  /\bbenchmark\s*\(/i,
  /\bsleep\s*\(/i,
  /\bload_file\s*\(/i,
  /\binto\s+(out|dump)file\b/i,
];

const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$]\s*(cat|ls|rm|mv|cp|chmod|chown|wget|curl|nc|bash|sh|python|perl|ruby|node)\b/i,
  /\$\(.*\)/,
  /`[^`]*`/,
  /\|\s*(cat|ls|rm|bash|sh|python|perl|ruby|node)\b/i,
  />\s*\/?(etc|tmp|var|dev)\//i,
  /\.\.\//,
];

/**
 * Result of sanitization check.
 */
export interface SanitizationResult {
  safe: boolean;
  threats: string[];
  field?: string;
}

/**
 * `InputSanitizationPipe` — Task 29.4, Req 30.2.
 *
 * Global pipe that sanitizes all user input against XSS, SQL injection,
 * and command injection attacks. Works in conjunction with zod strict
 * validation to ensure no malicious data reaches controllers.
 *
 * Defence layers:
 *   1. Pattern-based detection (XSS, SQLi, command injection)
 *   2. HTML entity encoding for string values
 *   3. Zod strict validation (no passthrough, no unknown keys)
 *
 * The pipe recursively inspects all string values in the input object.
 * If a threat is detected, the request is rejected with 400 Bad Request.
 */
@Injectable()
export class InputSanitizationPipe implements PipeTransform {
  private readonly logger = new Logger(InputSanitizationPipe.name);

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Only sanitize body and query params, not route params (which are
    // typically UUIDs or numeric IDs)
    if (metadata.type === 'param') return value;

    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      const result = this.checkString(value);
      if (!result.safe) {
        this.logger.warn(
          `Input sanitization: threats detected [${result.threats.join(', ')}]`,
        );
        throw new BadRequestException({
          code: 'INPUT_VALIDATION_FAILED',
          message: 'Input contains potentially dangerous content',
          threats: result.threats,
        });
      }
      return this.sanitizeString(value);
    }

    if (typeof value === 'object') {
      return this.sanitizeObject(value);
    }

    return value;
  }

  /**
   * Recursively sanitize an object, checking all string values.
   */
  private sanitizeObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeValue(item));
    }
    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        // Also check the key itself for injection
        const keyResult = this.checkString(key);
        if (!keyResult.safe) {
          this.logger.warn(
            `Input sanitization: malicious key detected [${keyResult.threats.join(', ')}]`,
          );
          throw new BadRequestException({
            code: 'INPUT_VALIDATION_FAILED',
            message: 'Input contains potentially dangerous content',
            threats: keyResult.threats,
          });
        }
        result[key] = this.sanitizeValue(value);
      }
      return result;
    }
    return obj;
  }

  private sanitizeValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      const result = this.checkString(value);
      if (!result.safe) {
        this.logger.warn(
          `Input sanitization: threats detected [${result.threats.join(', ')}]`,
        );
        throw new BadRequestException({
          code: 'INPUT_VALIDATION_FAILED',
          message: 'Input contains potentially dangerous content',
          threats: result.threats,
        });
      }
      return this.sanitizeString(value);
    }
    if (typeof value === 'object') {
      return this.sanitizeObject(value);
    }
    return value;
  }

  /**
   * Check a string against all known attack patterns.
   */
  checkString(value: string): SanitizationResult {
    const threats: string[] = [];

    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(value)) {
        threats.push('XSS');
        break;
      }
    }

    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        threats.push('SQL_INJECTION');
        break;
      }
    }

    for (const pattern of COMMAND_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        threats.push('COMMAND_INJECTION');
        break;
      }
    }

    return { safe: threats.length === 0, threats };
  }

  /**
   * Sanitize a string by encoding HTML entities.
   * This is a secondary defence — the primary defence is pattern rejection.
   */
  private sanitizeString(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
}

/**
 * Helper: Create a zod schema with strict mode for endpoint validation.
 * Ensures no unknown keys pass through (Req 30.7).
 *
 * Usage:
 *   const schema = createStrictSchema(z.object({
 *     email: z.string().email(),
 *     password: z.string().min(8),
 *   }));
 */
export function createStrictSchema<T extends z.ZodRawShape>(
  shape: z.ZodObject<T>,
): z.ZodObject<T, 'strict'> {
  return shape.strict();
}

/**
 * Zod-based validation pipe that enforces strict mode.
 * Use alongside InputSanitizationPipe for defence-in-depth.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        errors,
      });
    }
    return result.data;
  }
}
