import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import {
  DEFAULT_MAX_ARRAY_LENGTH,
  DEFAULT_MAX_STRING_LENGTH,
  ZodValidationPipe,
} from '../pipes/zod-validation.pipe';

/**
 * Tests for the ZodValidationPipe input-sanitization layer
 * (Task 29.4, Req 30.2 / 30.7).
 *
 * Covers the structural pre-walk that runs *before* Zod:
 *
 *   - NUL byte rejection (any depth, any field)
 *   - Control character rejection (with `\t` / `\n` / `\r` allowed)
 *   - String length cap (default 10,000) with override
 *   - Array length cap (default 1,000) with override
 *   - Cap interaction with Zod (`.max(...)` can shrink, never widen)
 *   - Path reporting in the error envelope
 *
 * Lives under `common/security/` per the task spec — the pipe itself
 * is in `common/pipes/`, but the sanitization contract is the
 * responsibility of the security layer, so the tests are co-located
 * with the rest of the security suite to make `--testPathPattern=common/security`
 * cover them.
 */
describe('ZodValidationPipe — input sanitization', () => {
  const meta: ArgumentMetadata = {
    type: 'body',
    metatype: undefined,
    data: undefined,
  };

  /** Schema that accepts pretty much anything so we can isolate the pre-walk. */
  const passthrough = z.any();

  describe('NUL byte rejection (Task 29.4)', () => {
    it('rejects a NUL byte in a top-level string field', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const payload = { name: 'Alice\u0000Bob' };
      try {
        pipe.transform(payload, meta);
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('INPUT_REJECTED');
        expect(body.message).toMatch(/NUL bytes/);
        expect(body.details[0].path).toBe('name');
        expect(body.details[0].reason).toBe('nul_byte');
      }
    });

    it('rejects a NUL byte nested inside an array', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const payload = { items: ['ok', { tag: 'bad\u0000' }] };
      try {
        pipe.transform(payload, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('INPUT_REJECTED');
        expect(body.details[0].path).toBe('items[1].tag');
      }
    });

    it('rejects a bare NUL byte string', () => {
      const pipe = new ZodValidationPipe(z.string());
      expect(() => pipe.transform('\u0000', meta)).toThrow(
        BadRequestException,
      );
    });

    it('rejects NUL bytes regardless of any Zod schema', () => {
      // Even when the schema would *accept* the value (z.any), the
      // pre-walk fires first.
      const strict = z.object({ x: z.string() });
      const pipe = new ZodValidationPipe(strict);
      expect(() => pipe.transform({ x: '\u0000' }, meta)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('Control character rejection (Task 29.4)', () => {
    it.each([
      ['\u0001', 'SOH'],
      ['\u0002', 'STX'],
      ['\u0007', 'BEL'],
      ['\u000B', 'VT'],
      ['\u000C', 'FF'],
      ['\u0008', 'BACKSPACE'],
      ['\u001B', 'ESC'],
      ['\u001F', 'US'],
      ['\u007F', 'DEL'],
    ])('rejects %p (%s)', (controlChar) => {
      const pipe = new ZodValidationPipe(passthrough);
      try {
        pipe.transform({ name: `before${controlChar}after` }, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('INPUT_REJECTED');
        expect(body.details[0].reason).toBe('control_char');
      }
    });

    it('allows TAB (\\t)', () => {
      const pipe = new ZodValidationPipe(passthrough);
      expect(pipe.transform({ note: 'col1\tcol2' }, meta)).toEqual({
        note: 'col1\tcol2',
      });
    });

    it('allows LF (\\n) and CR (\\r)', () => {
      const pipe = new ZodValidationPipe(passthrough);
      expect(pipe.transform({ note: 'line1\nline2\r\nline3' }, meta)).toEqual({
        note: 'line1\nline2\r\nline3',
      });
    });

    it('allows ordinary printable text', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const text = 'Hello, World! 123 — café émigré 漢字 🎉';
      expect(pipe.transform({ text }, meta)).toEqual({ text });
    });
  });

  describe('String length cap (Task 29.4)', () => {
    it('accepts a string at exactly the default 10,000-char ceiling', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const max = 'a'.repeat(DEFAULT_MAX_STRING_LENGTH);
      expect(pipe.transform({ blob: max }, meta)).toEqual({ blob: max });
    });

    it('rejects a string one byte over the default cap with INPUT_TOO_LARGE', () => {
      const pipe = new ZodValidationPipe(passthrough);
      try {
        pipe.transform(
          { blob: 'a'.repeat(DEFAULT_MAX_STRING_LENGTH + 1) },
          meta,
        );
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('INPUT_TOO_LARGE');
        expect(body.details[0].limit).toBe(DEFAULT_MAX_STRING_LENGTH);
        expect(body.details[0].actual).toBe(DEFAULT_MAX_STRING_LENGTH + 1);
        expect(body.details[0].path).toBe('blob');
      }
    });

    it('honours a wider per-pipe override', () => {
      const pipe = new ZodValidationPipe(passthrough, {
        maxStringLength: 50_000,
      });
      const big = 'a'.repeat(20_000);
      expect(pipe.transform({ blob: big }, meta)).toEqual({ blob: big });
    });

    it('honours a tighter per-pipe override', () => {
      const pipe = new ZodValidationPipe(passthrough, {
        maxStringLength: 10,
      });
      expect(() =>
        pipe.transform({ blob: 'eleven_chars' }, meta),
      ).toThrow(BadRequestException);
    });

    it('lets a Zod .max() cap shrink the surface further', () => {
      // The pre-walk allows up to 10,000 chars, but the schema clamps
      // a specific field to 100 — the schema-level rejection wins.
      const schema = z.object({ name: z.string().max(100) });
      const pipe = new ZodValidationPipe(schema);
      try {
        pipe.transform({ name: 'a'.repeat(150) }, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('Array length cap (Task 29.4)', () => {
    it('accepts an array at exactly the default 1,000-element ceiling', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const arr = Array.from({ length: DEFAULT_MAX_ARRAY_LENGTH }, (_, i) => i);
      const result = pipe.transform({ arr }, meta) as { arr: number[] };
      expect(result.arr).toHaveLength(DEFAULT_MAX_ARRAY_LENGTH);
    });

    it('rejects an array one element over the default cap', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const arr = Array.from(
        { length: DEFAULT_MAX_ARRAY_LENGTH + 1 },
        (_, i) => i,
      );
      try {
        pipe.transform({ arr }, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('INPUT_TOO_LARGE');
        expect(body.details[0].limit).toBe(DEFAULT_MAX_ARRAY_LENGTH);
        expect(body.details[0].actual).toBe(DEFAULT_MAX_ARRAY_LENGTH + 1);
      }
    });

    it('reports the path for nested over-cap arrays', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const payload = {
        outer: {
          inner: Array.from(
            { length: DEFAULT_MAX_ARRAY_LENGTH + 1 },
            () => 'x',
          ),
        },
      };
      try {
        pipe.transform(payload, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.details[0].path).toBe('outer.inner');
      }
    });

    it('honours a custom maxArrayLength override', () => {
      const pipe = new ZodValidationPipe(passthrough, { maxArrayLength: 5 });
      expect(() =>
        pipe.transform({ items: [1, 2, 3, 4, 5, 6] }, meta),
      ).toThrow(BadRequestException);
      expect(
        pipe.transform({ items: [1, 2, 3] }, meta),
      ).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('schema interaction', () => {
    it('runs the pre-walk before Zod (NUL beats schema mismatch)', () => {
      // If the schema would reject for a different reason, the pre-walk
      // still wins because it's structural.
      const schema = z.object({ x: z.number() });
      const pipe = new ZodValidationPipe(schema);
      try {
        pipe.transform({ x: 'has\u0000nul' }, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('INPUT_REJECTED');
      }
    });

    it('returns Zod-flavoured errors when the schema rejects after a clean pre-walk', () => {
      const schema = z.object({ age: z.number().min(0) });
      const pipe = new ZodValidationPipe(schema);
      try {
        pipe.transform({ age: -1 }, meta);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as any;
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(body.details[0].path).toBe('age');
      }
    });

    it('returns the parsed (Zod-transformed) payload on success', () => {
      const schema = z.object({
        title: z.string().trim().min(1),
        count: z.coerce.number().int(),
      });
      const pipe = new ZodValidationPipe(schema);
      expect(pipe.transform({ title: '  hello  ', count: '42' }, meta)).toEqual({
        title: 'hello',
        count: 42,
      });
    });
  });

  describe('edge cases', () => {
    it('handles nullish values without touching them', () => {
      const pipe = new ZodValidationPipe(z.any());
      expect(pipe.transform(null, meta)).toBeNull();
      expect(pipe.transform(undefined, meta)).toBeUndefined();
    });

    it('does not walk into Buffer / Date leaves', () => {
      const pipe = new ZodValidationPipe(passthrough);
      const buf = Buffer.from([0x00, 0xff]); // NUL bytes inside a Buffer are FINE
      const date = new Date('2024-01-01T00:00:00Z');
      const result = pipe.transform({ buf, date }, meta) as any;
      expect(result.buf).toBe(buf);
      expect(result.date).toBe(date);
    });

    it('refuses to construct with non-positive caps', () => {
      expect(
        () => new ZodValidationPipe(z.any(), { maxStringLength: 0 }),
      ).toThrow(/positive numbers/);
      expect(
        () => new ZodValidationPipe(z.any(), { maxArrayLength: -1 }),
      ).toThrow(/positive numbers/);
    });

    it('skips prototype-pollution keys without walking into them', () => {
      // `JSON.parse` is the only normal way these keys arrive
      // enumerable; the pipe must NOT trip on a `null`-prototype mock.
      const polluted = JSON.parse(
        '{"name":"ok","__proto__":{"x":"\\u0000"}}',
      );
      const pipe = new ZodValidationPipe(passthrough);
      // The polluted key holds a NUL byte but the pipe ignores the key
      // entirely → no throw, schema sees the rest of the payload.
      expect(() => pipe.transform(polluted, meta)).not.toThrow();
    });
  });
});
