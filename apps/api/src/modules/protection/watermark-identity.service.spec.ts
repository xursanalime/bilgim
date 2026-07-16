import { ConfigService } from '@nestjs/config';

import { PlaybackSessionRepository } from './repositories/playback-session.repository';
import {
  AuthenticatedViewer,
  WatermarkIdentityService,
} from './watermark-identity.service';

/**
 * Unit tests for {@link WatermarkIdentityService}
 * (content-protection-backend, Task 2.2, Req 3.1, 3.2, 3.4, 6.1; design
 * Property 4 — "watermark bound to session server-side").
 *
 * Proves:
 *   - identity is derived from the AUTHENTICATED session, never from
 *     client input (there is no client-tag parameter to spoof);
 *   - the visible label is PII-masked and follows `WATERMARK_FORMAT`;
 *   - a `PlaybackSession` row is persisted with the viewer↔session↔asset
 *     mapping;
 *   - the binding tag is deterministic for the same session.
 */
describe('WatermarkIdentityService', () => {
  const VIEWER: AuthenticatedViewer = {
    userId: 'user-123',
    email: 'alice@example.com',
    enrollmentId: 'enr-789',
  };

  function makeConfig(overrides: Record<string, string> = {}): ConfigService {
    const values: Record<string, string> = {
      WATERMARK_FORMAT: '{maskedEmail} • {sessionId}',
      PLAYBACK_TICKET_SIGNING_SECRET: 'unit-test-watermark-secret',
      ...overrides,
    };
    return {
      get: <T>(key: string): T | undefined => values[key] as unknown as T,
    } as unknown as ConfigService;
  }

  function makeRepo(): jest.Mocked<Pick<PlaybackSessionRepository, 'create'>> {
    return {
      create: jest.fn(async (input) => ({
        id: input.id,
        assetId: input.assetId,
        lessonId: input.lessonId ?? null,
        viewerUserId: input.viewerUserId,
        enrollmentId: input.enrollmentId ?? null,
        viewerTag: input.viewerTag,
        drmKeySystem: input.drmKeySystem ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        issuedAt: new Date('2024-01-01T00:00:00.000Z'),
        expiresAt: input.expiresAt,
      })),
    };
  }

  function makeService(
    config = makeConfig(),
    repo = makeRepo(),
  ): {
    service: WatermarkIdentityService;
    repo: jest.Mocked<Pick<PlaybackSessionRepository, 'create'>>;
  } {
    const service = new WatermarkIdentityService(
      config,
      repo as unknown as PlaybackSessionRepository,
    );
    return { service, repo };
  }

  describe('deriveIdentity — derived from session, not client input', () => {
    it('derives the label/tag from the authenticated viewer only', () => {
      const { service } = makeService();

      const identity = service.deriveIdentity({
        viewer: VIEWER,
        sessionId: 'session-abc',
      });

      // Identity reflects the authenticated session values.
      expect(identity.userId).toBe('user-123');
      expect(identity.enrollmentId).toBe('enr-789');
      expect(identity.sessionId).toBe('session-abc');
      // The masked email comes from the session email, not any client field.
      expect(identity.maskedEmail).toBe('a***@example.com');
      // Tag is opaque and never contains the raw email or local part.
      expect(identity.tag).not.toContain('alice');
      expect(identity.tag).not.toContain('@');
    });

    it('cannot be influenced by client-supplied identity (no such parameter)', () => {
      const { service } = makeService();

      // Two different "client-claimed" identities are impossible to pass:
      // the only identity source is the AuthenticatedViewer. Deriving with
      // the same session yields the same result regardless of any extra
      // fields a caller might try to smuggle through the typed input.
      const a = service.deriveIdentity({ viewer: VIEWER, sessionId: 's1' });
      const b = service.deriveIdentity({
        // Spread an attacker-style object with junk keys; only typed
        // AuthenticatedViewer fields are read.
        viewer: { ...VIEWER, label: 'admin', tag: 'forged' } as never,
        sessionId: 's1',
      });

      expect(b.label).toBe(a.label);
      expect(b.tag).toBe(a.tag);
    });

    it('generates a session id when none is supplied', () => {
      const { service } = makeService();

      const identity = service.deriveIdentity({ viewer: VIEWER });

      expect(identity.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('label masking + WATERMARK_FORMAT', () => {
    it('renders the configured template with the masked email + sessionId', () => {
      const { service } = makeService();

      const { label } = service.deriveIdentity({
        viewer: VIEWER,
        sessionId: 'session-abc',
      });

      expect(label).toBe('a***@example.com • session-abc');
    });

    it('honours a custom WATERMARK_FORMAT with userId/enrollmentId placeholders', () => {
      const config = makeConfig({
        WATERMARK_FORMAT: '{maskedEmail} [{userId}/{enrollmentId}] {sessionId}',
      });
      const { service } = makeService(config);

      const { label } = service.deriveIdentity({
        viewer: VIEWER,
        sessionId: 'sess-1',
      });

      expect(label).toBe('a***@example.com [user-123/enr-789] sess-1');
    });

    it('masks the local part but keeps the domain for trace context', () => {
      const { service } = makeService();

      expect(service.deriveIdentity({ viewer: { userId: 'u', email: 'a@b.co' }, sessionId: 's' }).maskedEmail).toBe('a***@b.co');
      expect(service.deriveIdentity({ viewer: { userId: 'u', email: 'bob@school.edu' }, sessionId: 's' }).maskedEmail).toBe('b***@school.edu');
    });

    it('fails safe to a fully-masked token for a malformed email', () => {
      const { service } = makeService();

      expect(service.deriveIdentity({ viewer: { userId: 'u', email: 'not-an-email' }, sessionId: 's' }).maskedEmail).toBe('***');
    });
  });

  describe('bindSession — persists the viewer↔session↔asset mapping', () => {
    it('persists a PlaybackSession row with the server-derived mapping', async () => {
      const { service, repo } = makeService();
      const expiresAt = new Date('2024-06-01T12:02:00.000Z');

      const { identity, session } = await service.bindSession({
        viewer: VIEWER,
        assetId: 'asset-555',
        lessonId: 'lesson-42',
        expiresAt,
        drmKeySystem: 'widevine',
        ip: '203.0.113.5',
        userAgent: 'jest',
      });

      expect(repo.create).toHaveBeenCalledTimes(1);
      const persisted = repo.create.mock.calls[0]![0];
      // The persisted row binds the session id, asset, viewer + enrollment,
      // and the opaque binding tag — un-masked ids retained for trace-back.
      expect(persisted).toMatchObject({
        id: identity.sessionId,
        assetId: 'asset-555',
        lessonId: 'lesson-42',
        viewerUserId: 'user-123',
        enrollmentId: 'enr-789',
        viewerTag: identity.tag,
        drmKeySystem: 'widevine',
        ip: '203.0.113.5',
        userAgent: 'jest',
        expiresAt,
      });
      expect(session.id).toBe(identity.sessionId);
    });

    it('works for live recordings with no lesson/enrollment context (Req 3.4)', async () => {
      const { service, repo } = makeService();

      await service.bindSession({
        viewer: { userId: 'u-1', email: 'live@example.com' },
        assetId: 'recording-1',
        expiresAt: new Date('2024-06-01T12:02:00.000Z'),
      });

      const persisted = repo.create.mock.calls[0]![0];
      expect(persisted.assetId).toBe('recording-1');
      expect(persisted.lessonId).toBeUndefined();
      expect(persisted.enrollmentId).toBeUndefined();
    });
  });

  describe('deterministic binding tag', () => {
    it('produces the same tag for the same session', () => {
      const { service } = makeService();

      const a = service.deriveIdentity({ viewer: VIEWER, sessionId: 'fixed' });
      const b = service.deriveIdentity({ viewer: VIEWER, sessionId: 'fixed' });

      expect(a.tag).toBe(b.tag);
    });

    it('produces different tags for different sessions / viewers', () => {
      const { service } = makeService();

      const base = service.deriveIdentity({ viewer: VIEWER, sessionId: 's1' });
      const otherSession = service.deriveIdentity({
        viewer: VIEWER,
        sessionId: 's2',
      });
      const otherViewer = service.deriveIdentity({
        viewer: { ...VIEWER, userId: 'user-999' },
        sessionId: 's1',
      });

      expect(base.tag).not.toBe(otherSession.tag);
      expect(base.tag).not.toBe(otherViewer.tag);
    });
  });
});
