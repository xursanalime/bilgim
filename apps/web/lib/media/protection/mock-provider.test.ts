import {
  DEV_FALLBACK_MARKER,
  KEY_SYSTEMS,
  MockMediaProtectionProvider,
  isTicketExpired,
  ticketTimeToLiveMs,
  type ProtectedPlaybackTicket,
} from './index';

describe('MockMediaProtectionProvider', () => {
  const provider = new MockMediaProtectionProvider();

  it('returns a well-formed ticket mirroring the backend contract', async () => {
    const ticket = await provider.getPlaybackTicket({ assetId: 'asset-123' });

    // Shape mirrors the backend PlaybackTicket.
    expect(typeof ticket.ticket).toBe('string');
    expect(ticket.ticket.length).toBeGreaterThan(0);
    expect(typeof ticket.manifestRef).toBe('string');
    expect(typeof ticket.watermark.label).toBe('string');
    expect(typeof ticket.watermark.tag).toBe('string');
    expect(typeof ticket.downloadAllowed).toBe('boolean');
    expect(typeof ticket.expiresAt).toBe('string');

    // licenseEndpoints carries an entry for every key system.
    for (const keySystem of KEY_SYSTEMS) {
      expect(typeof ticket.licenseEndpoints[keySystem]).toBe('string');
      expect(ticket.licenseEndpoints[keySystem]).toContain(keySystem);
    }
  });

  it('issues a ticket whose expiry is in the future', async () => {
    const before = Date.now();
    const ticket = await provider.getPlaybackTicket({ assetId: 'asset-123' });
    const expiresAtMs = Date.parse(ticket.expiresAt);

    expect(Number.isNaN(expiresAtMs)).toBe(false);
    expect(expiresAtMs).toBeGreaterThan(before);
    expect(isTicketExpired(ticket)).toBe(false);
    expect(ticketTimeToLiveMs(ticket)).toBeGreaterThan(0);
  });

  it('flags every response as a non-production dev fallback', async () => {
    const ticket = await provider.getPlaybackTicket({ assetId: 'asset-123' });

    expect(ticket.ticket).toContain(DEV_FALLBACK_MARKER);
    expect(ticket.manifestRef).toContain(DEV_FALLBACK_MARKER);
    expect(ticket.watermark.tag.startsWith(`${DEV_FALLBACK_MARKER}:`)).toBe(true);
  });

  it('defaults Download_Permission to disabled and forwards lessonId', async () => {
    const ticket = await provider.getPlaybackTicket({
      assetId: 'asset-123',
      lessonId: 'lesson-9',
    });

    expect(ticket.downloadAllowed).toBe(false);
    expect(ticket.manifestRef).toContain('lessonId=lesson-9');
  });

  it('honors injected clock + options for deterministic expiry', async () => {
    const fixedNow = 1_700_000_000_000;
    const ttlSeconds = 60;
    const deterministic = new MockMediaProtectionProvider({
      ttlSeconds,
      downloadAllowed: true,
      now: () => fixedNow,
    });

    const ticket = await deterministic.getPlaybackTicket({ assetId: 'a' });
    expect(ticket.downloadAllowed).toBe(true);
    expect(Date.parse(ticket.expiresAt)).toBe(fixedNow + ttlSeconds * 1000);

    // Past the expiry the helper reports the ticket as expired (fail closed).
    expect(isTicketExpired(ticket, fixedNow + ttlSeconds * 1000 + 1)).toBe(true);
  });

  it('returns deterministic fake license bytes', async () => {
    const challenge = new Uint8Array([1, 2, 3]).buffer;
    const license = await provider.requestLicense({
      assetId: 'asset-123',
      keySystem: 'widevine',
      challenge,
      ticket: 'dev-fallback.asset-123.0',
    });

    expect(license).toBeInstanceOf(ArrayBuffer);
    const decoded = String.fromCharCode(...new Uint8Array(license));
    expect(decoded).toContain(DEV_FALLBACK_MARKER);
    expect(decoded).toContain('widevine');
  });
});

describe('isTicketExpired / ticketTimeToLiveMs', () => {
  const malformed = { expiresAt: 'not-a-date' } as Pick<
    ProtectedPlaybackTicket,
    'expiresAt'
  >;

  it('treats a malformed expiry as expired (fail closed)', () => {
    expect(isTicketExpired(malformed)).toBe(true);
    expect(ticketTimeToLiveMs(malformed)).toBe(0);
  });
});
