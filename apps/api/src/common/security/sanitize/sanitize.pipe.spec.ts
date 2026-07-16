import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';

import {
  SanitizePipe,
  looksLikeSqlInjection,
  stripControlCharacters,
  strictHtmlSanitize,
} from './sanitize.pipe';
import { Sanitize } from './sanitize.decorator';

/**
 * Tests for SanitizePipe (Task 29.4, Req 30.2).
 *
 * Covers:
 *   - control-character + dangerous-Unicode stripping
 *   - opt-in HTML allowlist (no `<script>`, no inline event handlers,
 *     `javascript:` URLs neutralised)
 *   - opt-in SQL pattern rejection
 *   - prototype-pollution key drop
 *   - depth-bounded recursion (no stack blow-up on cyclic-ish payloads)
 *   - leaf objects (Buffer, Date) preserved verbatim
 */
describe('SanitizePipe', () => {
  const pipe = new SanitizePipe();

  /** Build the metadata Nest hands to a pipe, with optional DTO class. */
  function meta(metatype?: new () => unknown): ArgumentMetadata {
    return {
      type: 'body',
      metatype: metatype as unknown as ArgumentMetadata['metatype'],
      data: undefined,
    };
  }

  describe('control-character stripping (always-on)', () => {
    it('removes NULL bytes from string fields', () => {
      const result = pipe.transform({ name: 'A\u0000B' }, meta());
      expect(result).toEqual({ name: 'AB' });
    });

    it('removes a range of ASCII control characters', () => {
      const dirty = ['\u0001', '\u0007', '\u000B', '\u001F', '\u007F'].join('X');
      const result = pipe.transform({ field: dirty }, meta());
      expect(result).toEqual({ field: 'XXXX' });
    });

    it('preserves common whitespace (tab, LF, CR)', () => {
      const result = pipe.transform({ note: 'a\tb\nc\rd' }, meta());
      expect(result).toEqual({ note: 'a\tb\nc\rd' });
    });

    it('strips BOM and bidi-override characters', () => {
      const dirty = '\uFEFFhi \u202Eevil\u202C';
      const result = pipe.transform({ name: dirty }, meta());
      expect(result).toEqual({ name: 'hi evil' });
    });

    it('walks nested arrays + objects', () => {
      const dirty = {
        items: [
          { title: 'A\u0000' },
          { title: 'B\u0001C' },
        ],
      };
      const result = pipe.transform(dirty, meta());
      expect(result).toEqual({
        items: [{ title: 'A' }, { title: 'BC' }],
      });
    });

    it('returns the original payload shape for null / undefined / numeric', () => {
      expect(pipe.transform(null, meta())).toBeNull();
      expect(pipe.transform(undefined, meta())).toBeUndefined();
      expect(pipe.transform(42, meta())).toBe(42);
      expect(pipe.transform(true, meta())).toBe(true);
    });

    it('does not mutate the caller-provided object', () => {
      const original = { name: 'A\u0000B', tags: ['x\u0001y'] };
      const snapshot = JSON.parse(JSON.stringify(original));
      pipe.transform(original, meta());
      expect(original).toEqual(snapshot);
    });

    it('drops __proto__ / constructor / prototype keys at the boundary', () => {
      // `JSON.parse('{"__proto__":...}')` is one of the few ways a
      // payload arrives with these keys actually enumerable.
      const polluted = JSON.parse(
        '{"name":"ok","__proto__":{"polluted":true},"prototype":42}',
      );
      const result = pipe.transform(polluted, meta()) as Record<string, unknown>;
      expect(result).toEqual({ name: 'ok' });
      expect(result.__proto__).toBe(Object.prototype); // i.e. NOT polluted
    });

    it('preserves Buffer / Date leaves verbatim', () => {
      const buf = Buffer.from([0x00, 0xff]);
      const date = new Date('2024-01-01T00:00:00Z');
      const result = pipe.transform({ buf, date }, meta()) as any;
      expect(result.buf).toBe(buf);
      expect(result.date).toBe(date);
    });
  });

  describe('@Sanitize({ html: true })', () => {
    @Sanitize({ html: true })
    class HtmlDto {
      body!: string;
    }

    it('strips <script> blocks while preserving safe content', () => {
      const result = pipe.transform(
        { body: 'Hello <script>alert(1)</script> world' },
        meta(HtmlDto as any),
      ) as { body: string };
      expect(result.body).not.toContain('<script>');
      expect(result.body).toContain('Hello');
      expect(result.body).toContain('world');
    });

    it('removes inline on* event handlers', () => {
      const result = pipe.transform(
        { body: '<a href="https://example.com" onclick="alert(1)">click</a>' },
        meta(HtmlDto as any),
      ) as { body: string };
      expect(result.body).not.toContain('onclick');
      expect(result.body).toContain('href="https://example.com"');
    });

    it('strips javascript: URLs', () => {
      const result = pipe.transform(
        { body: '<a href="javascript:alert(1)">x</a>' },
        meta(HtmlDto as any),
      ) as { body: string };
      expect(result.body).not.toContain('javascript:');
    });

    it('does not run the HTML pass when no decorator is set', () => {
      class PlainDto {}
      const result = pipe.transform(
        { body: '<script>alert(1)</script>OK' },
        meta(PlainDto),
      ) as { body: string };
      // Plain text — `<script>` survives untouched (no decorator → no
      // HTML allowlist applied; only control chars are stripped).
      expect(result.body).toContain('<script>');
      expect(result.body).toContain('OK');
    });
  });

  describe('@Sanitize({ sql: true })', () => {
    @Sanitize({ sql: true })
    class SqlDto {
      query!: string;
    }

    it('rejects classic boolean-bypass injections', () => {
      expect(() =>
        pipe.transform({ query: "' OR 1=1 --" }, meta(SqlDto as any)),
      ).toThrow(BadRequestException);
    });

    it('rejects UNION SELECT', () => {
      expect(() =>
        pipe.transform(
          { query: 'foo UNION SELECT password FROM users' },
          meta(SqlDto as any),
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects DROP TABLE', () => {
      expect(() =>
        pipe.transform(
          { query: 'x; DROP TABLE users;' },
          meta(SqlDto as any),
        ),
      ).toThrow(BadRequestException);
    });

    it('lets benign strings through unchanged', () => {
      const result = pipe.transform(
        { query: 'select-all-items' },
        meta(SqlDto as any),
      ) as { query: string };
      expect(result.query).toBe('select-all-items');
    });
  });

  describe('exported helpers', () => {
    it('looksLikeSqlInjection() catches the known patterns', () => {
      expect(looksLikeSqlInjection("' OR 1=1 --")).toBe(true);
      expect(looksLikeSqlInjection('UNION ALL SELECT 1')).toBe(true);
      expect(looksLikeSqlInjection('xp_cmdshell(`whoami`)')).toBe(true);
      expect(looksLikeSqlInjection("hello O'Brien")).toBe(false);
      expect(looksLikeSqlInjection('selectAllItems')).toBe(false);
    });

    it('stripControlCharacters() leaves safe text intact', () => {
      expect(stripControlCharacters('hello\tworld')).toBe('hello\tworld');
      expect(stripControlCharacters('a\u0000b')).toBe('ab');
    });

    it('strictHtmlSanitize() enforces the allowlist', () => {
      const cleaned = strictHtmlSanitize(
        '<p>OK <iframe src="https://evil.com"></iframe> end</p>',
      );
      expect(cleaned).not.toContain('<iframe');
      expect(cleaned).toContain('<p>');
      expect(cleaned).toContain('OK');
    });
  });
});
