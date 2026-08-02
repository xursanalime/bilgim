import {
  DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S,
  HMAC_SIGNATURE_PREFIX,
  signHmac,
  verifyHmac,
} from './webhook-hmac';

/**
 * Tests for `apps/api/src/common/security/webhook-hmac.ts` (Task 29.4, Req 30.1).
 *
 * Covers the contract exercised by webhook-style endpoints:
 *
 *   - sign / verify round-trip on both string and Buffer bodies
 *   - `sha256=<hex>` header prefix + bare hex tolerance
 *   - timestamp drift > tolerance → EXPIRED
 *   - tampered body / signature → MISMATCH
 *   - missing / malformed header → MISSING / MALFORMED
 *   - missing secret → MISCONFIGURED
 *   - constant-time compare (length mismatch never throws)
 */
describe('signHmac / verifyHmac', () => {
  const SECRET = 'webhook-shared-secret-with-enough-entropy';
  const ts = 1_700_000_000; // fixed point — keeps drift tests deterministic

  describe('signHmac', () => {
    it('produces a deterministic sha256=<hex> digest for the same inputs', () => {
      const a = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      const b = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      expect(a).toBe(b);
      expect(a.startsWith(HMAC_SIGNATURE_PREFIX)).toBe(true);
      // SHA-256 hex digest is always 64 chars — sanity check that the
      // wrapper isn't truncating or re-encoding.
      expect(a.length).toBe(HMAC_SIGNATURE_PREFIX.length + 64);
      expect(a.slice(HMAC_SIGNATURE_PREFIX.length)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different digests when the timestamp changes (replay-resistance)', () => {
      const a = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      const b = signHmac({ body: '{"x":1}', timestamp: ts + 1, secret: SECRET });
      expect(a).not.toBe(b);
    });

    it('produces different digests when the body changes', () => {
      const a = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      const b = signHmac({ body: '{"x":2}', timestamp: ts, secret: SECRET });
      expect(a).not.toBe(b);
    });

    it('handles Buffer bodies identically to their UTF-8 string form', () => {
      const buf = Buffer.from('{"x":1}', 'utf8');
      const fromString = signHmac({
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
      });
      const fromBuffer = signHmac({
        body: buf,
        timestamp: ts,
        secret: SECRET,
      });
      expect(fromString).toBe(fromBuffer);
    });

    it('handles empty bodies (signed DELETEs / pings)', () => {
      const sig = signHmac({ body: '', timestamp: ts, secret: SECRET });
      expect(sig.startsWith(HMAC_SIGNATURE_PREFIX)).toBe(true);

      // Round-trips with the verifier.
      const result = verifyHmac({
        signature: sig,
        body: '',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(true);
    });

    it('throws when the secret is empty', () => {
      expect(() =>
        signHmac({ body: '{}', timestamp: ts, secret: '' }),
      ).toThrow(/non-empty secret/);
    });

    it('throws when the timestamp is non-positive', () => {
      expect(() =>
        signHmac({ body: '{}', timestamp: 0, secret: SECRET }),
      ).toThrow(/positive integer/);
      expect(() =>
        signHmac({ body: '{}', timestamp: -1, secret: SECRET }),
      ).toThrow(/positive integer/);
    });
  });

  describe('verifyHmac round-trip', () => {
    it('accepts a freshly-signed request when the clock matches', () => {
      const sig = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      const result = verifyHmac({
        signature: sig,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(true);
    });

    it('accepts within the ±5-minute default window', () => {
      const sig = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      const result = verifyHmac({
        signature: sig,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts + DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S, // exactly at the edge
      });
      expect(result.ok).toBe(true);
    });

    it('accepts the bare-hex form (no sha256= prefix)', () => {
      const sig = signHmac({ body: '{"x":1}', timestamp: ts, secret: SECRET });
      const bare = sig.slice(HMAC_SIGNATURE_PREFIX.length);
      const result = verifyHmac({
        signature: bare,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('verifyHmac failure paths', () => {
    function freshSig(body: string = '{"x":1}', secret: string = SECRET) {
      return signHmac({ body, timestamp: ts, secret });
    }

    it('returns MISSING for an empty / null / undefined header', () => {
      for (const value of [undefined, null, '']) {
        const result = verifyHmac({
          signature: value as any,
          body: '{"x":1}',
          timestamp: ts,
          secret: SECRET,
          now: ts,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('MISSING');
      }
    });

    it('returns MISCONFIGURED when the secret is empty', () => {
      const result = verifyHmac({
        signature: 'sha256=00',
        body: '{"x":1}',
        timestamp: ts,
        secret: '',
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MISCONFIGURED');
    });

    it('returns EXPIRED when the timestamp drift is just over the window', () => {
      const sig = freshSig();
      const result = verifyHmac({
        signature: sig,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts + DEFAULT_HMAC_TIMESTAMP_TOLERANCE_S + 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('EXPIRED');
    });

    it('returns EXPIRED when the timestamp is far in the future', () => {
      const sig = freshSig();
      const result = verifyHmac({
        signature: sig,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts - 600, // server clock 10 min behind the request
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('EXPIRED');
    });

    it('returns MALFORMED when the timestamp is not a positive integer', () => {
      const result = verifyHmac({
        signature: 'sha256=00',
        body: '{"x":1}',
        timestamp: NaN as unknown as number,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MALFORMED');
    });

    it('returns MALFORMED when the header is not lowercase hex', () => {
      const result = verifyHmac({
        signature: 'sha256=NOT-HEX',
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MALFORMED');
    });

    it('returns MALFORMED for uppercase hex (canonical form is lowercase)', () => {
      const sig = freshSig();
      const upper = HMAC_SIGNATURE_PREFIX + sig
        .slice(HMAC_SIGNATURE_PREFIX.length)
        .toUpperCase();
      const result = verifyHmac({
        signature: upper,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MALFORMED');
    });

    it('returns MISMATCH when the body has been tampered with', () => {
      const honestSig = freshSig('{"x":1}');
      const result = verifyHmac({
        signature: honestSig,
        body: '{"x":2}', // attacker swapped the body
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MISMATCH');
    });

    it('returns MISMATCH when the signature was signed with a different secret', () => {
      const sig = signHmac({
        body: '{"x":1}',
        timestamp: ts,
        secret: 'other-secret-also-long-enough',
      });
      const result = verifyHmac({
        signature: sig,
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MISMATCH');
    });

    it('returns MISMATCH for a hex of the wrong length (does not throw)', () => {
      const result = verifyHmac({
        signature: 'sha256=deadbeef', // valid hex, wrong length
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MISMATCH');
    });

    it('returns MISMATCH (not throw) for an odd-length hex header', () => {
      const result = verifyHmac({
        signature: 'sha256=abc', // odd length, would throw on naïve Buffer.from
        body: '{"x":1}',
        timestamp: ts,
        secret: SECRET,
        now: ts,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MISMATCH');
    });
  });

  describe('configurable tolerance window', () => {
    it('honours a tighter tolerance than the default', () => {
      const sig = signHmac({ body: '{}', timestamp: ts, secret: SECRET });
      // Within default window but outside a 60-second tolerance.
      const result = verifyHmac({
        signature: sig,
        body: '{}',
        timestamp: ts,
        secret: SECRET,
        now: ts + 90,
        toleranceSeconds: 60,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('EXPIRED');
    });

    it('honours a wider tolerance than the default', () => {
      const sig = signHmac({ body: '{}', timestamp: ts, secret: SECRET });
      // Outside the default window but inside a 1-hour tolerance.
      const result = verifyHmac({
        signature: sig,
        body: '{}',
        timestamp: ts,
        secret: SECRET,
        now: ts + 1800,
        toleranceSeconds: 3600,
      });
      expect(result.ok).toBe(true);
    });
  });
});
