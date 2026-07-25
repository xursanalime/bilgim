import { isNonBlockableIp } from './ip-classification';

/**
 * `isNonBlockableIp` is the single predicate standing between a
 * misattributed request and a platform-wide outage, so the cases below
 * pin both directions: infrastructure must never be blockable, and a
 * real public client must stay blockable (or the WAF becomes decorative).
 */
describe('isNonBlockableIp — infrastructure ranges', () => {
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['127.53.1.9', 'anywhere in 127/8'],
    ['::1', 'IPv6 loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['10.0.0.1', 'RFC1918 10/8'],
    ['10.255.255.254', 'RFC1918 10/8 upper'],
    ['172.16.0.1', 'RFC1918 172.16/12 lower'],
    ['172.31.255.254', 'RFC1918 172.16/12 upper'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['100.64.0.5', 'RFC6598 CGNAT — Railway private network'],
    ['100.127.255.254', 'RFC6598 CGNAT upper'],
    ['::ffff:100.64.0.5', 'IPv4-mapped CGNAT'],
    ['169.254.1.1', 'link-local'],
    ['fd00::1', 'IPv6 ULA'],
    ['fc00::1', 'IPv6 ULA lower'],
    ['fe80::1', 'IPv6 link-local'],
    ['fe80::1%eth0', 'IPv6 link-local with zone index'],
    ['0.0.0.0', 'unspecified'],
    ['::', 'IPv6 unspecified'],
  ])('treats %s as non-blockable (%s)', (ip) => {
    expect(isNonBlockableIp(ip)).toBe(true);
  });

  it('normalises case and surrounding whitespace / brackets', () => {
    expect(isNonBlockableIp('  10.0.0.1  ')).toBe(true);
    expect(isNonBlockableIp('[fd00::1]')).toBe(true);
    expect(isNonBlockableIp('FD00::1')).toBe(true);
  });
});

describe('isNonBlockableIp — real public clients stay blockable', () => {
  it.each([
    ['203.0.113.5', 'TEST-NET-3 documentation range, publicly routable shape'],
    ['8.8.8.8', 'public resolver'],
    ['198.51.100.9', 'TEST-NET-2'],
    ['172.32.0.1', 'just above the RFC1918 172.16/12 block'],
    ['172.15.255.254', 'just below the RFC1918 172.16/12 block'],
    ['100.63.255.254', 'just below CGNAT 100.64/10'],
    ['100.128.0.1', 'just above CGNAT 100.64/10'],
    ['192.169.0.1', 'adjacent to 192.168/16 but public'],
    ['169.253.0.1', 'adjacent to link-local but public'],
    ['2001:4860:4860::8888', 'public IPv6'],
    ['::ffff:8.8.8.8', 'IPv4-mapped public address'],
  ])('treats %s as blockable (%s)', (ip) => {
    expect(isNonBlockableIp(ip)).toBe(false);
  });
});

describe('isNonBlockableIp — unattributable input', () => {
  const cases: Array<[string | null | undefined, string]> = [
    [undefined, 'undefined'],
    [null, 'null'],
    ['', 'empty string'],
    ['   ', 'whitespace only'],
    ['unknown', 'the sentinel IP extraction returns on failure'],
    ['not-an-ip', 'arbitrary text'],
    ['999.999.999.999', 'out-of-range octets'],
    ['1.2.3', 'too few octets'],
  ];

  it.each(cases)('refuses to block %s (%s)', (ip) => {
    expect(isNonBlockableIp(ip)).toBe(true);
  });
});
