import { envSchema } from './env.schema';

/**
 * Task 1.3 — content-protection configuration (Req 7.1, 7.4).
 *
 * These tests pin the server-only protection settings: their safe dev
 * defaults parse, the values stay configurable without code changes, and
 * production fails closed when a real DRM vendor is selected without
 * credentials.
 */

// Minimal env that satisfies the non-defaulted required fields so we can
// exercise the protection-specific behavior in isolation.
const baseEnv = {
  JWT_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/bilgim',
};

describe('env.schema content-protection settings (Task 1.3)', () => {
  describe('safe dev defaults', () => {
    it('parses with defaults and selects the dev fallback provider', () => {
      const parsed = envSchema.safeParse({ ...baseEnv });

      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.DRM_PROVIDER).toBe('dev-fallback');
      expect(parsed.data.PLAYBACK_TICKET_TTL_SECONDS).toBe(120);
      expect(parsed.data.PLAYBACK_SESSION_RETENTION_DAYS).toBe(90);
      expect(parsed.data.WATERMARK_FORMAT).toBe('{maskedEmail} • {sessionId}');
    });

    it('leaves DRM credential secrets optional/undefined in dev', () => {
      const parsed = envSchema.safeParse({ ...baseEnv });

      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.DRM_API_KEY).toBeUndefined();
      expect(parsed.data.DRM_API_SECRET).toBeUndefined();
      expect(parsed.data.DRM_FAIRPLAY_CERT).toBeUndefined();
      expect(parsed.data.PLAYBACK_TICKET_SIGNING_SECRET).toBeUndefined();
    });
  });

  describe('configurable without code changes (Req 7.4)', () => {
    it('coerces and overrides ticket TTL, retention, and watermark format', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        PLAYBACK_TICKET_TTL_SECONDS: '300',
        PLAYBACK_SESSION_RETENTION_DAYS: '30',
        WATERMARK_FORMAT: '{userId} • {sessionId}',
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.PLAYBACK_TICKET_TTL_SECONDS).toBe(300);
      expect(parsed.data.PLAYBACK_SESSION_RETENTION_DAYS).toBe(30);
      expect(parsed.data.WATERMARK_FORMAT).toBe('{userId} • {sessionId}');
    });

    it('rejects a non-positive ticket TTL', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        PLAYBACK_TICKET_TTL_SECONDS: '0',
      });

      expect(parsed.success).toBe(false);
    });

    it('rejects an unknown DRM provider', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        DRM_PROVIDER: 'totally-not-a-vendor',
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe('production fail-closed guard (Req 7.1, 7.3)', () => {
    it('rejects a real DRM provider without credentials in production', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'production',
        DRM_PROVIDER: 'vdocipher',
      });

      expect(parsed.success).toBe(false);
      if (parsed.success) return;

      const paths = parsed.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('DRM_API_KEY');
      expect(paths).toContain('DRM_API_SECRET');
    });

    it('accepts a real DRM provider with credentials in production', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'production',
        DRM_PROVIDER: 'vdocipher',
        DRM_API_KEY: 'vendor-key',
        DRM_API_SECRET: 'vendor-secret',
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.DRM_PROVIDER).toBe('vdocipher');
    });

    it('allows the dev fallback provider in production without credentials', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'production',
        DRM_PROVIDER: 'dev-fallback',
      });

      expect(parsed.success).toBe(true);
    });

    it('does not require DRM credentials outside production', () => {
      const parsed = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'development',
        DRM_PROVIDER: 'gumlet',
      });

      expect(parsed.success).toBe(true);
    });
  });
});
