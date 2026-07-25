import {
  CLIENT_IP_HEADER,
  PROXY_TOKEN_HEADER,
  applyTrustedClientIp,
  isIpLiteral,
  makeTrustedClientIpHandler,
} from './trusted-client-ip.middleware';

/**
 * Regression suite for the shared-IP failure that took production down on
 * 2026-07-25.
 *
 * Every browser call is proxied by the Next.js BFF, so the API saw one
 * address (`::ffff:100.64.0.2`, Railway's private network) for the whole
 * user base. A burst of failed logins during an unrelated outage
 * blocklisted that single address and locked out every user with "This
 * network has been blocked due to suspicious activity."
 */

const SECRET = 's3cret-shared-with-the-bff';
const PROXY_IP = '::ffff:100.64.0.2';
const CLIENT_IP = '84.54.72.19';

function makeReq(headers: Record<string, string | string[]> = {}) {
  // Mirrors Express: `ip` is a prototype getter, not an own property.
  const proto = {
    get ip(): string {
      return PROXY_IP;
    },
  };
  return Object.create(proto, {
    headers: { value: headers, enumerable: true, writable: true },
  }) as { ip?: string; headers: Record<string, string | string[]> };
}

describe('applyTrustedClientIp', () => {
  it('replaces the proxy address with the forwarded client IP', () => {
    const req = makeReq({
      [CLIENT_IP_HEADER]: CLIENT_IP,
      [PROXY_TOKEN_HEADER]: SECRET,
    });

    applyTrustedClientIp(req, SECRET);

    // Shadowing the prototype getter is the point: a dozen helpers across
    // the codebase already read `req.ip`, and all become correct at once.
    expect(req.ip).toBe(CLIENT_IP);
  });

  it('ignores the header when the token is wrong', () => {
    // `api.bilgim.uz` is public, so an attacker can call it directly and
    // try to choose their own rate-limit bucket.
    const req = makeReq({
      [CLIENT_IP_HEADER]: '1.2.3.4',
      [PROXY_TOKEN_HEADER]: 'not-the-secret',
    });

    applyTrustedClientIp(req, SECRET);

    expect(req.ip).toBe(PROXY_IP);
  });

  it('ignores the header when no token is presented at all', () => {
    const req = makeReq({ [CLIENT_IP_HEADER]: '1.2.3.4' });
    applyTrustedClientIp(req, SECRET);
    expect(req.ip).toBe(PROXY_IP);
  });

  it('does nothing when no secret is configured', () => {
    // Opt-in: an environment that has not set BFF_PROXY_SECRET must not
    // start honouring a client-settable header.
    const req = makeReq({
      [CLIENT_IP_HEADER]: '1.2.3.4',
      [PROXY_TOKEN_HEADER]: 'anything',
    });

    applyTrustedClientIp(req, undefined);

    expect(req.ip).toBe(PROXY_IP);
  });

  it('rejects a non-IP value even with a valid token', () => {
    // Guards Redis keys and audit rows against injected text if the proxy
    // is ever compromised or misconfigured.
    const req = makeReq({
      [CLIENT_IP_HEADER]: 'not-an-ip; DROP TABLE',
      [PROXY_TOKEN_HEADER]: SECRET,
    });

    applyTrustedClientIp(req, SECRET);

    expect(req.ip).toBe(PROXY_IP);
  });

  it('accepts the first value when a header arrives repeated', () => {
    const req = makeReq({
      [CLIENT_IP_HEADER]: [CLIENT_IP, '9.9.9.9'],
      [PROXY_TOKEN_HEADER]: SECRET,
    });

    applyTrustedClientIp(req, SECRET);

    expect(req.ip).toBe(CLIENT_IP);
  });

  it('gives each caller its own identity behind one proxy', () => {
    // The actual bug: two different users must not share a bucket.
    const a = makeReq({
      [CLIENT_IP_HEADER]: '84.54.72.19',
      [PROXY_TOKEN_HEADER]: SECRET,
    });
    const b = makeReq({
      [CLIENT_IP_HEADER]: '213.230.99.4',
      [PROXY_TOKEN_HEADER]: SECRET,
    });

    applyTrustedClientIp(a, SECRET);
    applyTrustedClientIp(b, SECRET);

    expect(a.ip).not.toBe(b.ip);
    expect([a.ip, b.ip]).not.toContain(PROXY_IP);
  });
});

describe('makeTrustedClientIpHandler', () => {
  it('always calls next()', () => {
    const next = jest.fn();
    const handler = makeTrustedClientIpHandler(SECRET);

    handler(makeReq(), {}, next);
    handler(
      makeReq({ [CLIENT_IP_HEADER]: 'garbage', [PROXY_TOKEN_HEADER]: 'bad' }),
      {},
      next,
    );

    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('isIpLiteral', () => {
  it.each([
    '127.0.0.1',
    '84.54.72.19',
    '255.255.255.255',
    '::1',
    '::ffff:100.64.0.2',
    '2001:db8::8a2e:370:7334',
  ])('accepts %s', (value) => {
    expect(isIpLiteral(value)).toBe(true);
  });

  it.each([
    '',
    'localhost',
    '999.1.1.1',
    '1.2.3.4; rm -rf /',
    '84.54.72.19 84.54.72.20',
    'a'.repeat(46),
  ])('rejects %s', (value) => {
    expect(isIpLiteral(value)).toBe(false);
  });
});
