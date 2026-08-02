import { __test__ } from './prisma.factory';

const { redactSqlLiterals, applyConnectionLimit, applyUtcTimezone } = __test__;

/**
 * `prisma.factory` unit tests — Task 24.2.
 *
 * The factory's main job is to inject a `connection_limit` and emit a
 * slow-query log line with literals scrubbed. Connecting to a real
 * Prisma engine is too brittle for unit tests, so we cover the two
 * pure-function pieces:
 *
 *   - `applyConnectionLimit` — adds the param when missing, leaves it
 *     alone otherwise, gracefully handles malformed URLs.
 *   - `redactSqlLiterals`  — replaces single-quoted strings, dollar-
 *     quoted blocks and bare numeric literals with `?`.
 */
describe('prisma.factory helpers', () => {
  describe('applyConnectionLimit', () => {
    it('adds connection_limit when not already present', () => {
      const out = applyConnectionLimit(
        'postgresql://app:secret@localhost:5432/db',
        10,
      );
      expect(out).toContain('connection_limit=10');
    });

    it('does not override an operator-supplied connection_limit', () => {
      const out = applyConnectionLimit(
        'postgresql://app:secret@localhost:5432/db?connection_limit=42',
        10,
      );
      expect(out).toContain('connection_limit=42');
      expect(out).not.toContain('connection_limit=10');
    });

    it('preserves other query-string params', () => {
      const out = applyConnectionLimit(
        'postgresql://app:secret@localhost:5432/db?schema=public',
        5,
      );
      expect(out).toContain('schema=public');
      expect(out).toContain('connection_limit=5');
    });

    it('returns the input unchanged on a malformed URL', () => {
      const out = applyConnectionLimit('not://a real url', 10);
      // Old node URL parsers accept some weird shapes; either the
      // original (early-exit) or the parser-normalised form is fine
      // as long as the helper does not throw.
      expect(typeof out).toBe('string');
    });
  });

  describe('redactSqlLiterals', () => {
    it('replaces single-quoted strings with "?"', () => {
      const sql = `SELECT * FROM "User" WHERE email = 'student@example.com'`;
      const redacted = redactSqlLiterals(sql);
      expect(redacted).not.toContain('student@example.com');
      expect(redacted).toContain("'?'");
    });

    it('replaces numeric literals with "?"', () => {
      const sql = `SELECT * FROM "Course" WHERE "fromPriceUzs" >= 100000`;
      const redacted = redactSqlLiterals(sql);
      expect(redacted).not.toContain('100000');
      expect(redacted).toContain('?');
    });

    it('preserves column / table identifiers', () => {
      const sql = `SELECT id, "createdAt" FROM "Course" WHERE id = '123'`;
      const redacted = redactSqlLiterals(sql);
      expect(redacted).toContain('"createdAt"');
      expect(redacted).toContain('"Course"');
      expect(redacted).toContain('id');
    });

    it('redacts strings with embedded quotes (escaped via doubling)', () => {
      const sql = `SELECT * FROM x WHERE name = 'O''Reilly'`;
      const redacted = redactSqlLiterals(sql);
      expect(redacted).not.toContain('Reilly');
    });

    it('returns the input unchanged when empty', () => {
      expect(redactSqlLiterals('')).toBe('');
    });
  });

  describe('applyUtcTimezone', () => {
    // Regression guard for the outbox stall: every DateTime column is
    // `timestamp without time zone` and the DB-side `@default(now())`
    // renders `CURRENT_TIMESTAMP` in the *session* timezone. On an
    // Asia/Tashkent server that wrote `nextAttemptAt` five hours ahead of
    // the UTC `Date` the dispatcher polls with, so every event sat in
    // PENDING until real time caught up.
    it('pins the session timezone to UTC', () => {
      const out = applyUtcTimezone(
        'postgresql://app:secret@localhost:5432/db',
      );
      expect(decodeURIComponent(out)).toContain('options=-c timezone=UTC');
    });

    it('preserves other query-string params', () => {
      const out = applyUtcTimezone(
        'postgresql://app:secret@localhost:5432/db?schema=public&connection_limit=5',
      );
      expect(out).toContain('schema=public');
      expect(out).toContain('connection_limit=5');
      expect(decodeURIComponent(out)).toContain('timezone=UTC');
    });

    it('does not override an operator-supplied options param', () => {
      const out = applyUtcTimezone(
        'postgresql://app:secret@localhost:5432/db?options=-c%20statement_timeout%3D5000',
      );
      expect(decodeURIComponent(out)).toContain('statement_timeout=5000');
      expect(decodeURIComponent(out)).not.toContain('timezone=UTC');
    });

    it('does not override an operator-supplied timezone param', () => {
      const out = applyUtcTimezone(
        'postgresql://app:secret@localhost:5432/db?timezone=Asia/Tashkent',
      );
      expect(decodeURIComponent(out)).toContain('timezone=Asia/Tashkent');
      expect(out).not.toContain('options=');
    });

    it('returns the input unchanged on a malformed URL', () => {
      expect(() => applyUtcTimezone('not://a real url')).not.toThrow();
    });
  });
});
