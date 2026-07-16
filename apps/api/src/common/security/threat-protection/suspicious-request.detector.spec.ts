import {
  detectSuspiciousRequest,
  SUSPICIOUS_HEADER_LIMIT_BYTES,
  SUSPICIOUS_RULES,
  type InspectableRequest,
} from './suspicious-request.detector';

/**
 * Unit tests for the suspicious-request detector (Task 27.1).
 *
 * The detector is the part of the threat-protection module most likely
 * to false-positive in production, so we cover a wide spread of
 * positive AND negative cases for each rule category.
 */

describe('detectSuspiciousRequest', () => {
  describe('SQL injection detection', () => {
    it.each([
      ['UNION SELECT in URL', '/api/v1/courses?id=1 union select password from users'],
      ['UNION ALL SELECT', '/api/v1/courses?id=1 union all select * from users'],
      ['stacked DELETE', '/api/v1/admin?cmd=1; delete from accounts'],
      ['stacked DROP', '/api/v1/admin?cmd=1; drop table students'],
      ['SELECT FROM keyword chain', '/api/v1/users?cmd=select from accounts'],
      ['DELETE FROM keyword chain', '/api/v1/users?cmd=delete from users'],
      ['DROP TABLE keyword chain', '/api/v1/users?cmd=drop table secrets'],
    ])('flags SQL injection vector: %s', (_label, url) => {
      const result = detectSuspiciousRequest({
        method: 'GET',
        url,
        originalUrl: url,
        headers: {},
      });
      expect(result).not.toBeNull();
      expect(result?.rule.category).toBe('sql_injection');
    });

    it('flags `OR 1=1` boolean injection in body', () => {
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/login',
        originalUrl: '/api/v1/login',
        headers: { 'content-type': 'application/json' },
        body: { username: "admin' OR 1=1--", password: 'x' },
      });
      expect(result).not.toBeNull();
      expect(result?.rule.category).toBe('sql_injection');
    });

    it('does not false-positive on legitimate "select" in prose', () => {
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: {},
        body: {
          title: 'Programming basics',
          content:
            'Please pick your favourite programming language and tell us why.',
        },
      });
      expect(result).toBeNull();
    });

    it('does not flag a normal search query that uses the word "from"', () => {
      const result = detectSuspiciousRequest({
        method: 'GET',
        url: '/api/v1/search?q=courses%20from%20Tashkent',
        originalUrl: '/api/v1/search?q=courses%20from%20Tashkent',
        headers: {},
      });
      expect(result).toBeNull();
    });
  });

  describe('XSS detection', () => {
    it.each([
      ['<script> tag', { content: '<script>alert(1)</script>' }],
      ['<SCRIPT> uppercase', { content: '<SCRIPT>alert(1)</SCRIPT>' }],
      ['javascript: URI', { link: 'javascript:alert(document.cookie)' }],
      ['onload= handler', { html: '<svg onload=alert(1)>' }],
      ['onerror= handler', { html: '<img src=x onerror=alert(1)>' }],
      ['onclick= handler', { html: '<a onclick=evil()>x</a>' }],
      ['<iframe src=javascript:>', { html: '<iframe src="javascript:alert(1)">' }],
      ['<iframe src=data:>', { html: '<iframe src="data:text/html,<script>alert(1)</script>">' }],
    ])('flags XSS vector: %s', (_label, body) => {
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: {},
        body,
      });
      expect(result).not.toBeNull();
      expect(result?.rule.category).toBe('xss');
    });

    it('does not false-positive on harmless markdown / HTML mention', () => {
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: {},
        body: {
          content:
            'Markdown supports **bold** and `code`. The HTML script element is dangerous.',
        },
      });
      expect(result).toBeNull();
    });

    it('does not flag a benign event word like "onboarding"', () => {
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/users',
        originalUrl: '/api/v1/users',
        headers: {},
        body: {
          notes: 'Schedule onboarding session for next Monday.',
        },
      });
      expect(result).toBeNull();
    });
  });

  describe('Path traversal detection', () => {
    it.each([
      ['../ in URL', '/api/v1/files/../../etc/passwd'],
      ['encoded %2e%2e%2f', '/api/v1/files/%2e%2e%2f%2e%2e%2fetc/passwd'],
      ['mixed encoding ..%2f', '/api/v1/files/..%2f..%2fetc/passwd'],
      ['Windows ..\\ traversal', '/api/v1/files/..\\..\\windows\\system.ini'],
      ['encoded backslash %2e%2e%5c', '/api/v1/files/%2e%2e%5c%2e%2e%5cwin.ini'],
      ['/etc/passwd absolute probe', '/api/v1/files?path=/etc/passwd'],
      ['/etc/shadow absolute probe', '/api/v1/files?path=/etc/shadow'],
    ])('flags path traversal vector: %s', (_label, url) => {
      const result = detectSuspiciousRequest({
        method: 'GET',
        url,
        originalUrl: url,
        headers: {},
      });
      expect(result).not.toBeNull();
      expect(result?.rule.category).toBe('path_traversal');
    });

    it('does not false-positive on a regular nested path with version dots', () => {
      const result = detectSuspiciousRequest({
        method: 'GET',
        url: '/api/v1.0/courses/python.3.11',
        originalUrl: '/api/v1.0/courses/python.3.11',
        headers: {},
      });
      expect(result).toBeNull();
    });
  });

  describe('oversized header / cookie detection', () => {
    it('flags a single header larger than 16 KiB', () => {
      const huge = 'a'.repeat(SUSPICIOUS_HEADER_LIMIT_BYTES + 1);
      const result = detectSuspiciousRequest({
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { 'x-custom-trace': huge },
      });
      expect(result).not.toBeNull();
      expect(result?.rule.category).toBe('oversized_headers');
      expect(result?.surface).toBe('headers');
      expect(result?.rule.name.startsWith('oversized.header:')).toBe(true);
    });

    it('flags an oversized cookie with the dedicated rule', () => {
      const huge = 'session=' + 'a'.repeat(SUSPICIOUS_HEADER_LIMIT_BYTES);
      const result = detectSuspiciousRequest({
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { cookie: huge },
      });
      expect(result).not.toBeNull();
      expect(result?.rule.name).toBe('oversized.cookie');
      expect(result?.surface).toBe('cookie');
    });

    it('does not flag normal-sized headers', () => {
      const result = detectSuspiciousRequest({
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
          'content-type': 'application/json',
          authorization: `Bearer ${'a'.repeat(512)}`,
          cookie: 'session=abc123; theme=dark',
        },
      });
      expect(result).toBeNull();
    });
  });

  describe('header inspection (no false positives on secret-bearing headers)', () => {
    it('does not flag SQL keywords inside the Authorization header', () => {
      // Bearer tokens are opaque base64; a payload that happens to
      // contain "select from" must not fire the rule engine — that
      // would lock unlucky users out of the API.
      const req: InspectableRequest = {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {
          authorization: 'Bearer SELECT.FROM.JWT.PAYLOAD',
        },
      };
      expect(detectSuspiciousRequest(req)).toBeNull();
    });

    it('does not flag SQL keywords inside the Cookie header', () => {
      const req: InspectableRequest = {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {
          cookie:
            'session=union-select-token; theme=light; tracker=union%20all%20select',
        },
      };
      expect(detectSuspiciousRequest(req)).toBeNull();
    });
  });

  describe('clean traffic', () => {
    it('passes a regular GET request through', () => {
      const result = detectSuspiciousRequest({
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
        },
      });
      expect(result).toBeNull();
    });

    it('passes a regular JSON POST through', () => {
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/notes',
        originalUrl: '/api/v1/notes',
        headers: { 'content-type': 'application/json' },
        body: {
          title: 'Lecture notes',
          body: 'Today we covered HTTP and REST APIs.',
        },
      });
      expect(result).toBeNull();
    });
  });

  describe('rule-table integrity', () => {
    it('exposes rules across all four categories', () => {
      const categories = new Set(SUSPICIOUS_RULES.map((r) => r.category));
      expect(categories.has('sql_injection')).toBe(true);
      expect(categories.has('xss')).toBe(true);
      expect(categories.has('path_traversal')).toBe(true);
    });

    it('returns a sample slice that is sanitised + length-bounded', () => {
      const malicious = '<script>alert("' + 'A'.repeat(500) + '")</script>';
      const result = detectSuspiciousRequest({
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: {},
        body: { content: malicious },
      });
      expect(result).not.toBeNull();
      expect(result!.sample.length).toBeLessThanOrEqual(200);
      // No control characters
      expect(/[\u0000-\u001f]/.test(result!.sample)).toBe(false);
    });
  });
});
