/**
 * Cosine-similarity helper used by the tutor policy enforcement
 * (Req 13.3 — "AI javobi talabaning aktiv submission matni bilan 0.7
 * dan yuqori cosine similarity ko'rsatsa, javobni hint sifatida qayta
 * yozishi kerak").
 *
 * Implementation: bag-of-words → term-frequency vector → cosine. We
 * deliberately avoid TF-IDF because there is no reference corpus on
 * the platform and the threshold is a coarse "is the reply basically
 * the answer" check; pure TF is good enough.
 *
 * Behaviour:
 *   - Empty inputs → similarity 0 (no overlap).
 *   - Identical inputs → similarity 1.
 *   - Whitespace / case insensitive.
 *   - Strips ASCII punctuation and common Unicode general punctuation
 *     (em/en dashes, smart quotes, ellipsis); non-ASCII *letters*
 *     (Cyrillic, Latin extended) pass through unchanged so the helper
 *     works for uz/ru/en.
 */

// ASCII punctuation/control ranges plus the General Punctuation block
// (U+2010–U+2027: hyphens, em/en dashes, smart quotes, ellipsis, etc.).
// We deliberately do NOT include U+2028/U+2029 (line/paragraph
// separators) because those are whitespace and `.split(/\s+/)` already
// handles them.
const PUNCT_REGEX =
  /[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007F\u2010-\u2027]/g;

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(PUNCT_REGEX, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 0);
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const tok of tokens) {
    tf.set(tok, (tf.get(tok) ?? 0) + 1);
  }
  return tf;
}

/**
 * Cosine similarity between two strings. Returns a value in [0, 1].
 * Edge cases: empty inputs always return 0 — the gateway treats that
 * as "no risk of leaking the answer".
 */
export function cosineSimilarity(a: string, b: string): number {
  const tfA = termFrequency(tokenize(a));
  const tfB = termFrequency(tokenize(b));
  if (tfA.size === 0 || tfB.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, freq] of tfA) {
    normA += freq * freq;
    const otherFreq = tfB.get(term);
    if (otherFreq) dot += freq * otherFreq;
  }
  for (const freq of tfB.values()) {
    normB += freq * freq;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Longest-common-substring length, as a fraction of the shorter input.
 * Used as a secondary "is this reply basically a verbatim slice of the
 * student's submission" signal alongside cosine similarity. Property
 * 4 (Task 20.4) checks this as well.
 */
export function longestCommonSubstringRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const lcs = longestCommonSubstring(a, b);
  const denom = Math.min(a.length, b.length);
  return denom === 0 ? 0 : lcs / denom;
}

/**
 * Compute the LCS length using a classic DP. We keep two rolling
 * arrays so the helper handles 4–5 KB strings without OOM on the
 * worker pool.
 */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
        if ((curr[j] ?? 0) > best) best = curr[j] ?? 0;
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return best;
}
