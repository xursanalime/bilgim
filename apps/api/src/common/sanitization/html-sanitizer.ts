/**
 * HTML / rich-text sanitizer (Task 29.4, Req 30.2).
 *
 * The platform accepts rich-text bodies in a handful of places — course
 * descriptions, lesson outlines, assignment instructions, AI tutor
 * context — and persists them verbatim. Without server-side scrubbing
 * a malicious teacher could embed `<script>`, `<iframe>`, or
 * `javascript:` URLs that fire when a student renders the field.
 *
 * `sanitizeHtml(input)` runs the input through `isomorphic-dompurify`
 * (works in Node without a real DOM) with a tight allow-list:
 *
 *   - tags:  p, a, b, i, u, em, strong, ul, ol, li, h1..h6, blockquote,
 *            code, pre, br
 *   - attrs: only `href` and `title` on `<a>`; no `style`, no `class`,
 *            no `id`, no `data-*`, no event handlers (`on*`).
 *   - href schemes: `http://`, `https://`, `mailto:` only —
 *            `javascript:`, `data:`, `vbscript:` are stripped.
 *   - links: every surviving `<a>` is rewritten with
 *            `target="_blank"` and `rel="noopener noreferrer nofollow"`
 *            so an attacker cannot pivot via window.opener.
 *
 * The function is also safe to use as a Zod transform:
 *
 *     z.string().transform(sanitizeHtml)
 *
 * The transform never throws — bad input is sanitized to the empty
 * string rather than rejected, matching DOMPurify's "fail open to
 * safe content" contract.
 */
import DOMPurify from 'isomorphic-dompurify';

/** Allowlist of tags safe for student-facing rich text. */
export const ALLOWED_HTML_TAGS = [
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
] as const;

/** Allowlist of attributes — kept tiny on purpose. */
export const ALLOWED_HTML_ATTRS = ['href', 'title'] as const;

/**
 * URI schemes accepted on the `href` attribute. Anything outside this
 * list (most importantly `javascript:`) is stripped by DOMPurify via
 * `ALLOWED_URI_REGEXP`.
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|(?:\/|\.{1,2}\/|#))/i;

/**
 * Applies the platform allow-list and returns sanitized HTML.
 *
 * Returns the empty string when input is `null`, `undefined`, or not a
 * string — defensive coding so callers can pipe untrusted data in
 * without juggling the type guard themselves.
 */
export function sanitizeHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }

  const cleaned = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [...ALLOWED_HTML_TAGS],
    ALLOWED_ATTR: [...ALLOWED_HTML_ATTRS],
    ALLOWED_URI_REGEXP,
    // Strip every other attribute by name even when the tag survives —
    // a layered defence so a future DOMPurify upgrade cannot accidentally
    // start letting `style="..."` through (which has its own XSS vectors
    // via `expression()` in older browsers).
    FORBID_ATTR: [
      'style',
      'class',
      'id',
      'srcset',
      'sizes',
      'name',
      'form',
      'formaction',
    ],
    // Don't allow <a name="..."> trickery and never accept namespaced
    // elements (SVG / MathML can carry their own injection vectors).
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
    // Force-rewrite every surviving `<a>` to be safe in a new tab.
    ADD_ATTR: ['target', 'rel'],
  });

  return rewriteAnchors(cleaned);
}

/**
 * Plain-text variant — strips ALL HTML markup entirely. Useful for
 * fields that should never carry markup (titles, summaries, search
 * indices) but were declared as `z.string()` and may have been
 * populated by a copy/paste of rich content.
 */
export function stripHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  }).trim();
}

/**
 * Rewrite every `<a>` returned by DOMPurify so that:
 *   - `target="_blank"` (so links don't replace the SPA tab),
 *   - `rel` always contains `noopener`, `noreferrer`, `nofollow`.
 *
 * Done with a tiny regex pass rather than a second DOM round-trip;
 * DOMPurify already removed any unsafe attributes so we can be
 * confident the only `<a>` tags we see are well-formed.
 */
function rewriteAnchors(html: string): string {
  if (!html.includes('<a ')) return html;
  return html.replace(/<a\s+([^>]*)>/gi, (_, attrs: string) => {
    const cleanedAttrs = attrs
      .replace(/\s+target\s*=\s*"[^"]*"/gi, '')
      .replace(/\s+rel\s*=\s*"[^"]*"/gi, '')
      .trim();
    const prefix = cleanedAttrs.length > 0 ? `${cleanedAttrs} ` : '';
    return `<a ${prefix}target="_blank" rel="noopener noreferrer nofollow">`;
  });
}
