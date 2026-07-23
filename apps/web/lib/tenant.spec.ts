import {
  resolveTeacherSlug,
  cookieDomainFor,
  mapTeacherHomePath,
  buildTenantUrl,
  rootHostFor,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from './tenant';

describe('resolveTeacherSlug', () => {
  it('returns null for the bare root domain', () => {
    expect(resolveTeacherSlug(ROOT_DOMAIN)).toBeNull();
    expect(resolveTeacherSlug(`${ROOT_DOMAIN}:443`)).toBeNull();
  });

  it('returns null for the www subdomain', () => {
    expect(resolveTeacherSlug(`www.${ROOT_DOMAIN}`)).toBeNull();
  });

  it('extracts a teacher slug from a production subdomain', () => {
    expect(resolveTeacherSlug(`aziz.${ROOT_DOMAIN}`)).toBe('aziz');
  });

  it('strips the port before resolving', () => {
    expect(resolveTeacherSlug(`aziz.${ROOT_DOMAIN}:443`)).toBe('aziz');
  });

  it('extracts a teacher slug from a *.localhost dev host regardless of NODE_ENV', () => {
    expect(resolveTeacherSlug('aziz.localhost:3000')).toBe('aziz');
    expect(resolveTeacherSlug('aziz.localhost')).toBe('aziz');
  });

  it('returns null for bare localhost', () => {
    expect(resolveTeacherSlug('localhost:3000')).toBeNull();
    expect(resolveTeacherSlug('127.0.0.1:3000')).toBeNull();
  });

  it.each([...RESERVED_SUBDOMAINS])('treats reserved subdomain %s as the root app', (reserved) => {
    expect(resolveTeacherSlug(`${reserved}.${ROOT_DOMAIN}`)).toBeNull();
    expect(resolveTeacherSlug(`${reserved}.localhost:3000`)).toBeNull();
  });

  it('returns null for hosts outside the root domain (e.g. preview deploys)', () => {
    expect(resolveTeacherSlug('web-production-abcd.up.railway.app')).toBeNull();
  });

  it('rejects slugs with characters outside [a-z0-9-]', () => {
    expect(resolveTeacherSlug(`under_score.${ROOT_DOMAIN}`)).toBeNull();
  });

  it('rejects multi-level subdomains', () => {
    expect(resolveTeacherSlug(`foo.bar.${ROOT_DOMAIN}`)).toBeNull();
  });

  it('lowercases mixed-case hosts before matching', () => {
    expect(resolveTeacherSlug(`Aziz.${ROOT_DOMAIN}`)).toBe('aziz');
  });

  it('returns null when no host header is present', () => {
    expect(resolveTeacherSlug(null)).toBeNull();
    expect(resolveTeacherSlug(undefined)).toBeNull();
  });
});

describe('cookieDomainFor', () => {
  it('scopes to the root domain for the bare root host', () => {
    expect(cookieDomainFor(ROOT_DOMAIN)).toBe(`.${ROOT_DOMAIN}`);
  });

  it('scopes to the root domain for any subdomain (including reserved ones)', () => {
    expect(cookieDomainFor(`aziz.${ROOT_DOMAIN}`)).toBe(`.${ROOT_DOMAIN}`);
    expect(cookieDomainFor(`app.${ROOT_DOMAIN}:443`)).toBe(`.${ROOT_DOMAIN}`);
  });

  it('scopes to .localhost for dev hosts', () => {
    expect(cookieDomainFor('localhost:3000')).toBe('.localhost');
    expect(cookieDomainFor('aziz.localhost:3000')).toBe('.localhost');
  });

  it('returns undefined for hosts outside both domains (falls back to host-only)', () => {
    expect(cookieDomainFor('web-production-abcd.up.railway.app')).toBeUndefined();
  });

  it('returns undefined when no host is present', () => {
    expect(cookieDomainFor(null)).toBeUndefined();
  });
});

describe('mapTeacherHomePath', () => {
  it('maps the bare root to the teacher profile route', () => {
    expect(mapTeacherHomePath('/', 'aziz')).toBe('/teachers/aziz');
  });

  it('maps a locale-prefixed root, preserving the locale', () => {
    expect(mapTeacherHomePath('/ru', 'aziz')).toBe('/ru/teachers/aziz');
    expect(mapTeacherHomePath('/en/', 'aziz')).toBe('/en/teachers/aziz');
  });

  it('leaves every other path untouched (returns null)', () => {
    expect(mapTeacherHomePath('/courses', 'aziz')).toBeNull();
    expect(mapTeacherHomePath('/teachers/aziz', 'aziz')).toBeNull();
    expect(mapTeacherHomePath('/ru/discover', 'aziz')).toBeNull();
  });
});

describe('buildTenantUrl', () => {
  it('builds a production subdomain URL from the root domain host', () => {
    expect(buildTenantUrl(ROOT_DOMAIN, 'aziz', '/?preview=tok')).toBe(
      `https://aziz.${ROOT_DOMAIN}/?preview=tok`,
    );
  });

  it('builds an http *.localhost URL (with port) in dev', () => {
    expect(buildTenantUrl('localhost:3000', 'aziz', '/?preview=tok')).toBe(
      'http://aziz.localhost:3000/?preview=tok',
    );
  });

  it('builds from an already-subdomained dev host too', () => {
    expect(buildTenantUrl('someoneelse.localhost:3000', 'aziz', '/')).toBe(
      'http://aziz.localhost:3000/',
    );
  });
});

describe('rootHostFor', () => {
  it('returns ROOT_DOMAIN for a production subdomain host', () => {
    expect(rootHostFor(`aziz.${ROOT_DOMAIN}`)).toBe(ROOT_DOMAIN);
  });

  it('returns localhost with port for a dev subdomain host', () => {
    expect(rootHostFor('aziz.localhost:3000')).toBe('localhost:3000');
  });

  it('returns bare localhost when the dev host has no port', () => {
    expect(rootHostFor('aziz.localhost')).toBe('localhost');
  });

  it('falls back to ROOT_DOMAIN when no host is present', () => {
    expect(rootHostFor(null)).toBe(ROOT_DOMAIN);
  });
});
