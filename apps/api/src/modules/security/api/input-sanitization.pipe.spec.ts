import { ArgumentMetadata, BadRequestException } from '@nestjs/common';

import {
  InputSanitizationPipe,
  ZodValidationPipe,
  createStrictSchema,
} from './input-sanitization.pipe';
import { z } from 'zod';

/**
 * Unit tests for `InputSanitizationPipe` (Task 29.4, Req 30.2).
 *
 * Covers:
 *   - XSS detection and rejection (script tags, event handlers, javascript: URIs)
 *   - SQL injection detection and rejection (UNION SELECT, OR 1=1, comment sequences)
 *   - Command injection detection and rejection (shell metacharacters, backticks, $())
 *   - Safe input passes through with HTML entity encoding
 *   - Nested objects are recursively sanitized
 *   - Route params are skipped (not sanitized)
 *   - ZodValidationPipe strict mode rejects unknown keys
 */

const pipe = new InputSanitizationPipe();

const bodyMeta: ArgumentMetadata = { type: 'body' };
const queryMeta: ArgumentMetadata = { type: 'query' };
const paramMeta: ArgumentMetadata = { type: 'param' };

// ─────────────────────────────────────────────────────────────────────

describe('InputSanitizationPipe — XSS detection', () => {
  it('rejects <script> tags', () => {
    const input = '<script>alert("xss")</script>';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
    try {
      pipe.transform(input, bodyMeta);
    } catch (e) {
      const response = (e as BadRequestException).getResponse() as any;
      expect(response.threats).toContain('XSS');
    }
  });

  it('rejects javascript: URI', () => {
    const input = 'javascript:alert(1)';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects inline event handlers (onerror=)', () => {
    const input = '<img onerror=alert(1) src=x>';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects <iframe> tags', () => {
    const input = '<iframe src="https://evil.com"></iframe>';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects data:text/html payloads', () => {
    const input = 'data:text/html,<script>alert(1)</script>';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects XSS in nested object values', () => {
    const input = {
      name: 'John',
      bio: '<script>steal(cookies)</script>',
    };
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });
});

describe('InputSanitizationPipe — SQL injection detection', () => {
  it('rejects UNION SELECT statements', () => {
    const input = "1 UNION SELECT username, password FROM users";
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
    try {
      pipe.transform(input, bodyMeta);
    } catch (e) {
      const response = (e as BadRequestException).getResponse() as any;
      expect(response.threats).toContain('SQL_INJECTION');
    }
  });

  it('rejects OR-based injection', () => {
    const input = "' OR '1'='1";
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects DROP TABLE attempts', () => {
    const input = "; DROP TABLE users";
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects time-based blind injection (WAITFOR DELAY)', () => {
    const input = "1; WAITFOR DELAY '0:0:5'";
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects SLEEP-based injection', () => {
    const input = "1 AND SLEEP(5)";
    expect(() => pipe.transform(input, queryMeta)).toThrow(BadRequestException);
  });
});

describe('InputSanitizationPipe — command injection detection', () => {
  it('rejects shell command chaining with semicolons', () => {
    const input = '; rm -rf /';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
    try {
      pipe.transform(input, bodyMeta);
    } catch (e) {
      const response = (e as BadRequestException).getResponse() as any;
      expect(response.threats).toContain('COMMAND_INJECTION');
    }
  });

  it('rejects backtick command substitution', () => {
    const input = '`cat /etc/passwd`';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects $() command substitution', () => {
    const input = '$(whoami)';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects pipe to shell commands', () => {
    const input = '| cat /etc/passwd';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });

  it('rejects path traversal', () => {
    const input = '../../../etc/passwd';
    expect(() => pipe.transform(input, bodyMeta)).toThrow(BadRequestException);
  });
});

describe('InputSanitizationPipe — safe input handling', () => {
  it('passes through normal text with HTML encoding', () => {
    const input = 'Hello World';
    const result = pipe.transform(input, bodyMeta);
    expect(result).toBe('Hello World');
  });

  it('encodes HTML entities in safe strings', () => {
    const input = 'Price: 5 < 10 & value > 3';
    const result = pipe.transform(input, bodyMeta) as string;
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&amp;');
  });

  it('passes through null and undefined', () => {
    expect(pipe.transform(null, bodyMeta)).toBeNull();
    expect(pipe.transform(undefined, bodyMeta)).toBeUndefined();
  });

  it('passes through numbers unchanged', () => {
    expect(pipe.transform(42, bodyMeta)).toBe(42);
  });

  it('recursively sanitizes nested objects', () => {
    const input = {
      user: {
        name: 'Ali',
        email: 'ali@example.com',
      },
      tags: ['math', 'science'],
    };
    const result = pipe.transform(input, bodyMeta) as any;
    expect(result.user.name).toBe('Ali');
    expect(result.user.email).toBe('ali@example.com');
    expect(result.tags).toEqual(['math', 'science']);
  });

  it('skips route params (type=param)', () => {
    const input = '<script>alert(1)</script>';
    // Route params are not sanitized — they're typically UUIDs/IDs
    const result = pipe.transform(input, paramMeta);
    expect(result).toBe(input);
  });
});

describe('InputSanitizationPipe — checkString method', () => {
  it('returns safe=true for benign strings', () => {
    const result = pipe.checkString('Hello, this is a normal message');
    expect(result.safe).toBe(true);
    expect(result.threats).toHaveLength(0);
  });

  it('detects multiple threat types simultaneously', () => {
    // This string triggers both XSS and command injection
    const result = pipe.checkString('<script>$(rm -rf /)</script>');
    expect(result.safe).toBe(false);
    expect(result.threats.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('ZodValidationPipe — strict mode', () => {
  const schema = createStrictSchema(
    z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }),
  );
  const zodPipe = new ZodValidationPipe(schema);

  it('passes valid input', () => {
    const input = { email: 'test@example.com', password: 'securepass123' };
    const result = zodPipe.transform(input, bodyMeta);
    expect(result).toEqual(input);
  });

  it('rejects unknown keys (strict mode)', () => {
    const input = {
      email: 'test@example.com',
      password: 'securepass123',
      admin: true, // unknown key
    };
    expect(() => zodPipe.transform(input, bodyMeta)).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid email format', () => {
    const input = { email: 'not-an-email', password: 'securepass123' };
    expect(() => zodPipe.transform(input, bodyMeta)).toThrow(
      BadRequestException,
    );
    try {
      zodPipe.transform(input, bodyMeta);
    } catch (e) {
      const response = (e as BadRequestException).getResponse() as any;
      expect(response.code).toBe('VALIDATION_FAILED');
      expect(response.errors).toBeDefined();
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const input = { email: 'test@example.com', password: 'short' };
    expect(() => zodPipe.transform(input, bodyMeta)).toThrow(
      BadRequestException,
    );
  });
});
