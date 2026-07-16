import { buildDmScopeRef, peerFromScopeRef } from './dm.repository';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

describe('DmRepository helpers', () => {
  describe('buildDmScopeRef', () => {
    it('canonicalises an unordered pair to a single key', () => {
      expect(buildDmScopeRef(A, B)).toBe(buildDmScopeRef(B, A));
    });

    it('uses lexicographic ordering', () => {
      expect(buildDmScopeRef(A, B)).toBe(`${A}:${B}`);
      expect(buildDmScopeRef(B, A)).toBe(`${A}:${B}`);
    });

    it('throws on self-pairs (would violate the UNIQUE invariant)', () => {
      expect(() => buildDmScopeRef(A, A)).toThrow(/two distinct/i);
    });
  });

  describe('peerFromScopeRef', () => {
    it('returns the other half of the canonical pair', () => {
      const ref = buildDmScopeRef(A, B);
      expect(peerFromScopeRef(ref, A)).toBe(B);
      expect(peerFromScopeRef(ref, B)).toBe(A);
    });

    it('throws when the viewer is not a participant', () => {
      const ref = buildDmScopeRef(A, B);
      expect(() => peerFromScopeRef(ref, C)).toThrow();
    });

    it('throws on malformed scopeRef (defensive)', () => {
      expect(() => peerFromScopeRef('no-colon', A)).toThrow();
      expect(() => peerFromScopeRef(':only-right', A)).toThrow();
      expect(() => peerFromScopeRef('only-left:', A)).toThrow();
    });
  });
});
