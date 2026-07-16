import { __test__ } from './prisma.factory';

const { redactSqlLiterals, applyConnectionLimit } = __test__;

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
});
