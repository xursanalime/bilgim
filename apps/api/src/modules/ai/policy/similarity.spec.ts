import {
  cosineSimilarity,
  longestCommonSubstringRatio,
  termFrequency,
  tokenize,
} from './similarity';

describe('cosineSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(cosineSimilarity('the cat sat', 'the cat sat')).toBeCloseTo(1, 6);
  });

  it('returns 0 for fully disjoint strings', () => {
    expect(cosineSimilarity('alpha bravo', 'gamma delta')).toBe(0);
  });

  it('returns 0 when either side is empty', () => {
    expect(cosineSimilarity('', 'something')).toBe(0);
    expect(cosineSimilarity('something', '')).toBe(0);
  });

  it('is case-insensitive and ignores punctuation', () => {
    const sim = cosineSimilarity('Hello, World!', 'hello world');
    expect(sim).toBeCloseTo(1, 6);
  });

  it('detects high overlap above the 0.7 policy threshold', () => {
    const studentText = 'photosynthesis converts sunlight into chemical energy';
    const aiReply = 'photosynthesis converts sunlight into chemical energy now';
    expect(cosineSimilarity(aiReply, studentText)).toBeGreaterThanOrEqual(0.7);
  });

  it('keeps unrelated tutor explanations below the threshold', () => {
    const studentText = 'the mitochondrion is the powerhouse of the cell';
    const aiReply = 'consider the metaphor of factories with workers';
    expect(cosineSimilarity(aiReply, studentText)).toBeLessThan(0.7);
  });
});

describe('longestCommonSubstringRatio', () => {
  it('returns 1 when one string is contained in the other', () => {
    expect(longestCommonSubstringRatio('hello', 'hello world')).toBe(1);
  });

  it('returns 0 for empty inputs', () => {
    expect(longestCommonSubstringRatio('', 'abc')).toBe(0);
  });

  it('returns 0 when there is no overlap', () => {
    expect(longestCommonSubstringRatio('abc', 'xyz')).toBe(0);
  });

  it('reports a fractional ratio for partial overlap', () => {
    // shared substring "answer" length 6, shorter string length 12 → 0.5
    expect(longestCommonSubstringRatio('the answerXX', 'what answer?')).toBe(
      0.5833333333333334,
    );
  });
});

describe('tokenize', () => {
  it('splits whitespace and lowercases', () => {
    expect(tokenize('Hello WORLD ')).toEqual(['hello', 'world']);
  });

  it('strips ASCII punctuation', () => {
    expect(tokenize("don't — stop")).toEqual(['don', 't', 'stop']);
  });
});

describe('termFrequency', () => {
  it('counts repeats', () => {
    const tf = termFrequency(['a', 'b', 'a']);
    expect(tf.get('a')).toBe(2);
    expect(tf.get('b')).toBe(1);
  });
});
