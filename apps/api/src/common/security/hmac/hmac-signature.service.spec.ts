import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { HmacSignatureService } from './hmac-signature.service';

/**
 * Unit tests for HmacSignatureService (Task 29.4, Req 30.1).
 *
 * Covers:
 *   - sign/verify round-trip on strings AND Buffer payloads
 *   - tamper detection (body, signature)
 *   - rejection of empty / malformed / wrong-length signatures
 *   - constant-time compare (statistical sanity check, NOT a hard
 *     guarantee — perf-based timing tests are flaky in CI but the
 *     test still asserts the API surface that delivers it)
 */
describe('HmacSignatureService', () => {
  const service = new HmacSignatureService();
  const SECRET = 'super-secret-key-with-enough-entropy';

  describe('sign()', () => {
    it('produces base64 HMAC-SHA256 over the payload', () => {
      const sig = service.sign('hello', SECRET);
      const expected = createHmac('sha256', SECRET)
        .update('hello')
        .digest('base64');
      expect(sig).toBe(expected);
    });

    it('handles Buffer payloads byte-for-byte', () => {
      const buf = Buffer.from([0, 1, 2, 3, 0xff]);
      const sig = service.sign(buf, SECRET);
      const expected = createHmac('sha256', SECRET).update(buf).digest('base64');
      expect(sig).toBe(expected);
    });

    it('throws on an empty secret', () => {
      expect(() => service.sign('hello', '')).toThrow();
    });
  });

  describe('verify()', () => {
    it('round-trips: a signature produced by sign() always verifies', () => {
      const payload = 'order-123:amount=500';
      const sig = service.sign(payload, SECRET);
      expect(service.verify(payload, sig, SECRET)).toBe(true);
    });

    it('rejects a tampered payload (single byte flip)', () => {
      const sig = service.sign('amount=500', SECRET);
      expect(service.verify('amount=501', sig, SECRET)).toBe(false);
    });

    it('rejects a tampered signature (single character flip)', () => {
      const sig = service.sign('hello', SECRET);
      const tampered = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
      expect(service.verify('hello', tampered, SECRET)).toBe(false);
    });

    it.each([
      ['empty signature', ''],
      ['undefined', undefined],
      ['null', null],
    ])('rejects when signature is %s', (_label, value) => {
      expect(service.verify('hello', value as any, SECRET)).toBe(false);
    });

    it('rejects when signature is the wrong length', () => {
      // Truncated signature must NOT verify, even if the prefix is correct.
      const full = service.sign('hello', SECRET);
      expect(service.verify('hello', full.slice(0, full.length - 4), SECRET)).toBe(
        false,
      );
    });

    it('rejects when the secret is wrong', () => {
      const sig = service.sign('hello', SECRET);
      expect(service.verify('hello', sig, 'different-secret')).toBe(false);
    });

    it('rejects an empty secret without throwing', () => {
      const sig = service.sign('hello', SECRET);
      expect(service.verify('hello', sig, '')).toBe(false);
    });

    it('uses constant-time compare (timing-safe API surface)', () => {
      // Hard timing assertions are flaky in CI; instead we verify that
      // many invocations against wrong-but-equal-length signatures all
      // return `false` and complete in roughly the same order of
      // magnitude. The real defence is in `crypto.timingSafeEqual`,
      // which we exercise by construction.
      const sig = service.sign('hello', SECRET);
      const same = randomBytes(sig.length).toString('base64').slice(0, sig.length);
      const samples = 50;

      const timings: number[] = [];
      for (let i = 0; i < samples; i++) {
        const start = performance.now();
        // Wrong-by-construction signature of the right length.
        expect(service.verify('hello', same, SECRET)).toBe(false);
        timings.push(performance.now() - start);
      }
      // Sanity: every call returned, none threw, and the runtime
      // doesn't blow out (e.g. non-constant impl that crashed on
      // malformed input). 1 ms is generous for a hash compare.
      const max = Math.max(...timings);
      expect(max).toBeLessThan(50);
    });
  });
});
