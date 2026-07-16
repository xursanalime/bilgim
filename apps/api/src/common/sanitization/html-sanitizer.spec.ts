import { z } from 'zod';

import { sanitizeHtml, stripHtml } from './html-sanitizer';

/**
 * Task 29.4 — XSS sanitization unit tests (Req 30.2, Property 28).
 *
 * Each test sends a representative attacker payload through
 * `sanitizeHtml` and asserts the dangerous fragment is removed. The
 * fixtures are pulled from OWASP's XSS Filter Evasion Cheat Sheet so
 * the regression surface stays useful even as DOMPurify upgrades.
 */
describe('sanitizeHtml (Task 29.4 — XSS prevention)', () => {
  describe('script-tag injection', () => {
    it('strips a top-level <script> tag', () => {
      const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/alert/);
      expect(out).toContain('<p>hi</p>');
    });

    it('strips an obfuscated <ScRiPt> tag with extra whitespace', () => {
      const out = sanitizeHtml('<ScRiPt  >alert(1)</sCRipT >');
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/alert/);
    });

    it('strips a nested script-in-attribute attack', () => {
      const out = sanitizeHtml('<p><script>alert("xss")</script></p>');
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/alert/);
    });
  });

  describe('event-handler injection', () => {
    it('removes onerror=', () => {
      const out = sanitizeHtml('<img src=x onerror="alert(1)">');
      expect(out).not.toMatch(/onerror/i);
      expect(out).not.toMatch(/alert/);
    });

    it('removes onclick on an allowed tag', () => {
      const out = sanitizeHtml('<p onclick="steal()">click me</p>');
      expect(out).not.toMatch(/onclick/i);
      expect(out).not.toMatch(/steal/);
      expect(out).toContain('click me');
    });

    it('removes onload, onmouseover, and other on* handlers', () => {
      const out = sanitizeHtml(
        '<p onload="x()" onmouseover="y()" onfocus="z()">hi</p>',
      );
      expect(out).not.toMatch(/on(load|mouseover|focus)/i);
    });
  });

  describe('javascript: URLs', () => {
    it('strips a javascript: href', () => {
      const out = sanitizeHtml(
        '<a href="javascript:alert(1)">click</a>',
      );
      expect(out).not.toMatch(/javascript:/i);
    });

    it('strips a JavaScript: href with mixed casing', () => {
      const out = sanitizeHtml(
        '<a href="JaVaScRiPt:alert(1)">click</a>',
      );
      expect(out).not.toMatch(/javascript:/i);
    });

    it('strips a vbscript: href', () => {
      const out = sanitizeHtml('<a href="vbscript:msgbox(1)">click</a>');
      expect(out).not.toMatch(/vbscript:/i);
    });

    it('strips a data:text/html URL', () => {
      const out = sanitizeHtml(
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">link</a>',
      );
      expect(out).not.toMatch(/data:text\/html/i);
    });
  });

  describe('iframe / embed / object', () => {
    it('strips a top-level <iframe>', () => {
      const out = sanitizeHtml(
        '<iframe src="https://evil.example.com"></iframe>',
      );
      expect(out).not.toMatch(/<iframe/i);
    });

    it('strips <embed>', () => {
      const out = sanitizeHtml('<embed src="evil.swf">');
      expect(out).not.toMatch(/<embed/i);
    });

    it('strips <object>', () => {
      const out = sanitizeHtml('<object data="evil.swf"></object>');
      expect(out).not.toMatch(/<object/i);
    });
  });

  describe('safe content survives', () => {
    it('keeps allowed tags intact', () => {
      const input =
        '<p>Hello <b>world</b>, <i>welcome</i> to <em>Bilgim</em></p>' +
        '<ul><li>one</li><li>two</li></ul>' +
        '<h2>Subheading</h2><blockquote>quote</blockquote>' +
        '<pre><code>code</code></pre>';
      const out = sanitizeHtml(input);
      // Tag-by-tag presence (DOMPurify may reformat whitespace).
      expect(out).toContain('<p>');
      expect(out).toContain('<b>');
      expect(out).toContain('<i>');
      expect(out).toContain('<em>');
      expect(out).toContain('<ul>');
      expect(out).toContain('<li>');
      expect(out).toContain('<h2>');
      expect(out).toContain('<blockquote>');
      expect(out).toContain('<pre>');
      expect(out).toContain('<code>');
    });

    it('preserves https / http / mailto anchors', () => {
      const out = sanitizeHtml(
        '<a href="https://bilgim.uz">site</a>' +
          '<a href="http://example.com">x</a>' +
          '<a href="mailto:hi@bilgim.uz">contact</a>',
      );
      expect(out).toMatch(/href="https:\/\/bilgim\.uz"/);
      expect(out).toMatch(/href="http:\/\/example\.com"/);
      expect(out).toMatch(/href="mailto:hi@bilgim\.uz"/);
    });

    it('rewrites every surviving anchor with target=_blank rel=nofollow', () => {
      const out = sanitizeHtml(
        '<a href="https://bilgim.uz">site</a>',
      );
      expect(out).toMatch(/target="_blank"/);
      expect(out).toMatch(/rel="noopener noreferrer nofollow"/);
    });

    it('drops style/class/id/data-* attributes', () => {
      const out = sanitizeHtml(
        '<p style="color:red" class="x" id="y" data-x="z">hi</p>',
      );
      expect(out).not.toMatch(/style=/i);
      expect(out).not.toMatch(/class=/i);
      expect(out).not.toMatch(/\bid=/i);
      expect(out).not.toMatch(/data-x/i);
      expect(out).toContain('hi');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for null / undefined / non-string input', () => {
      expect(sanitizeHtml(null)).toBe('');
      expect(sanitizeHtml(undefined)).toBe('');
      expect(sanitizeHtml(123 as unknown as string)).toBe('');
      expect(sanitizeHtml({} as unknown as string)).toBe('');
    });

    it('returns empty string for empty input', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('handles very long input without crashing', () => {
      // 100kB pseudo-Lorem; DOMPurify must walk the whole thing.
      const long = '<p>' + 'a'.repeat(100_000) + '</p>';
      const out = sanitizeHtml(long);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toMatch(/<p>/);
    });
  });

  describe('Zod transform compatibility', () => {
    it('works as a `z.string().transform(sanitizeHtml)` step', () => {
      const Schema = z.object({
        body: z.string().transform(sanitizeHtml),
      });
      const out = Schema.parse({
        body: 'safe<script>alert(1)</script><b>bold</b>',
      });
      expect(out.body).toContain('<b>bold</b>');
      expect(out.body).not.toMatch(/<script/i);
    });
  });

  describe('SVG / MathML namespaces', () => {
    it('strips <svg onload>', () => {
      const out = sanitizeHtml('<svg onload="alert(1)"></svg>');
      expect(out).not.toMatch(/onload/i);
      expect(out).not.toMatch(/<svg/i);
    });

    it('strips <math><mtext><script>', () => {
      const out = sanitizeHtml(
        '<math><mtext><script>alert(1)</script></mtext></math>',
      );
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/alert/);
    });
  });
});

describe('stripHtml (Task 29.4 — plain-text fallback)', () => {
  it('strips every tag and keeps the text content', () => {
    expect(stripHtml('<p>hello <b>world</b></p>')).toBe('hello world');
  });

  it('strips a script-injected payload entirely', () => {
    expect(stripHtml('<script>alert(1)</script>safe text')).toBe(
      'safe text',
    );
  });

  it('returns empty string for non-string / empty / nullish input', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml('')).toBe('');
    expect(stripHtml(42 as unknown as string)).toBe('');
  });
});
