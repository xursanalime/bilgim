/**
 * Classify an IP as "a real, blockable client" vs "infrastructure".
 *
 * ## Why this exists
 *
 * Every browser→API call is proxied by the Next.js BFF. When the API
 * can resolve the true caller (see `trusted-client-ip.middleware.ts`),
 * `req.ip` is that caller's public address and blocking it punishes
 * exactly one user. When it *cannot* — `BFF_PROXY_SECRET` unset,
 * mismatched between services, or a request that reached the API by a
 * path that doesn't carry the header — `req.ip` falls back to the hop
 * the connection actually came from: the BFF's own private address
 * (`100.64.0.x` on Railway, `10.x` / `172.16.x` elsewhere).
 *
 * That address is not a client identity. It is *every* client at once.
 * Blocking it takes the whole platform offline with
 * `403 IP_BLOCKED — This network has been blocked due to suspicious
 * activity`, including `/auth/login`, which means nobody can sign in to
 * undo it — not even an admin, because `IpBlocklistGuard` runs ahead of
 * authentication. That is exactly what happened on 2026-07-25: a single
 * honeypot hit blocked the shared BFF address and locked out the
 * platform and its own admin panel.
 *
 * So: a private / shared-infrastructure address is never blockable. If
 * we cannot tell who the caller is, the correct action is to let the
 * request through and fix attribution — not to punish everyone. This is
 * enforced at three layers (write, enforce, and the honeypot's own
 * pre-check) so no single missed call site can reintroduce the outage.
 *
 * ## What counts as infrastructure
 *
 * Loopback, RFC1918 private space, RFC6598 carrier-grade NAT (the
 * range Railway's private network uses), link-local, and their IPv6
 * equivalents (`::1`, ULA `fc00::/7`, link-local `fe80::/10`), plus
 * IPv4-mapped IPv6 forms of all of the above.
 *
 * Note this is deliberately *not* a general "is this a bogon" check —
 * a public address that happens to be a NAT gateway for a whole school
 * is still blockable, because that is a real, attributable network.
 */

/** Strip an IPv4-mapped IPv6 prefix and any zone index / brackets. */
function normalizeForClassification(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  // Drop an IPv6 zone index (`fe80::1%eth0`).
  const zoneIdx = value.indexOf('%');
  if (zoneIdx >= 0) value = value.slice(0, zoneIdx);
  // `::ffff:10.0.0.1` and the rarer `::10.0.0.1` both carry an IPv4
  // address; classify on the embedded v4 form.
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  else if (/^::(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) value = value.slice(2);
  return value;
}

/** Parse a dotted-quad into its four octets, or `null` if malformed. */
function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/**
 * True when `ip` belongs to a range that identifies infrastructure
 * rather than an individual caller, and therefore must never be added
 * to — or enforced from — an IP blocklist.
 *
 * Unparseable input returns `true` (treated as non-blockable): a value
 * we cannot classify is a value we cannot justify punishing a user
 * over, and `'unknown'` reaches here whenever IP extraction failed.
 */
export function isNonBlockableIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const value = normalizeForClassification(ip);
  if (!value || value === 'unknown') return true;

  const v4 = parseIpv4(value);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // "this network"
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 CGNAT
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }

  // IPv6 (or something that isn't an address at all).
  if (!value.includes(':')) return true; // not an IP literal — don't block
  if (value === '::1' || value === '::') return true; // loopback / unspecified
  // ULA fc00::/7 — first byte 0xfc or 0xfd.
  if (/^f[cd][0-9a-f]{0,2}:/.test(value)) return true;
  // Link-local fe80::/10 — fe8x / fe9x / feax / febx.
  if (/^fe[89ab][0-9a-f]?:/.test(value)) return true;
  return false;
}
