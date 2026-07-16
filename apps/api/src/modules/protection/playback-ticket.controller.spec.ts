import { ForbiddenException } from '@nestjs/common';

import { JwtPayload } from '../auth/tokens.service';
import {
  PlaybackTicketController,
  PlaybackTicketRequest,
} from './playback-ticket.controller';
import { PlaybackTicket, PlaybackTicketService } from './playback-ticket.service';

/**
 * Unit tests for PlaybackTicketController — Task 2.1
 * (content-protection-backend Req 1.1, 1.2).
 *
 *   GET /media/assets/:id/playback-ticket?lessonId=
 *
 * Verifies the controller boundary:
 *   - forwards the authenticated viewer + request ip/userAgent + lessonId
 *     to the service;
 *   - a 403 from the service (non-entitled caller) propagates with NO
 *     media payload (Req 1.2, Property 1).
 */
describe('PlaybackTicketController', () => {
  const ASSET_ID = '11111111-1111-1111-1111-111111111111';
  const LESSON_ID = '22222222-2222-2222-2222-222222222222';

  const USER: JwtPayload = {
    sub: 'student-1',
    email: 'alice@example.com',
    role: 'STUDENT',
  };

  function buildTicket(): PlaybackTicket {
    return {
      ticket: 'payload.signature',
      manifestRef: 'https://api.bilgim.test/media/assets/x/url?ttl=120&dev-fallback=1',
      licenseEndpoints: {
        widevine: `/media/assets/${ASSET_ID}/license/widevine`,
        fairplay: `/media/assets/${ASSET_ID}/license/fairplay`,
        playready: `/media/assets/${ASSET_ID}/license/playready`,
      },
      watermark: { label: 'a***@example.com • sess', tag: 'a'.repeat(32) },
      downloadAllowed: false,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
  }

  function buildRequest(
    overrides: Partial<PlaybackTicketRequest> = {},
  ): PlaybackTicketRequest {
    return {
      ip: '203.0.113.7',
      socket: { remoteAddress: '203.0.113.7' },
      headers: { 'user-agent': 'jest-agent/1.0' },
      ...overrides,
    };
  }

  let service: jest.Mocked<Pick<PlaybackTicketService, 'issueTicket'>>;
  let controller: PlaybackTicketController;

  beforeEach(() => {
    service = {
      issueTicket: jest.fn(),
    } as unknown as jest.Mocked<Pick<PlaybackTicketService, 'issueTicket'>>;
    controller = new PlaybackTicketController(
      service as unknown as PlaybackTicketService,
    );
  });

  it('forwards the authenticated viewer, lessonId, ip and userAgent', async () => {
    const ticket = buildTicket();
    service.issueTicket.mockResolvedValue(ticket);

    const result = await controller.issuePlaybackTicket(
      USER,
      ASSET_ID,
      { lessonId: LESSON_ID },
      buildRequest(),
    );

    expect(result).toBe(ticket);
    expect(service.issueTicket).toHaveBeenCalledWith({
      viewer: USER,
      assetId: ASSET_ID,
      lessonId: LESSON_ID,
      ip: '203.0.113.7',
      userAgent: 'jest-agent/1.0',
    });
  });

  it('falls back to socket.remoteAddress when req.ip is absent', async () => {
    service.issueTicket.mockResolvedValue(buildTicket());

    await controller.issuePlaybackTicket(
      USER,
      ASSET_ID,
      {},
      buildRequest({ ip: undefined, socket: { remoteAddress: '198.51.100.4' } }),
    );

    expect(service.issueTicket).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '198.51.100.4', lessonId: undefined }),
    );
  });

  it('propagates a 403 (non-entitled caller) with no media payload (Req 1.2)', async () => {
    service.issueTicket.mockRejectedValue(
      new ForbiddenException({ code: 'MEDIA_ACCESS_DENIED' }),
    );

    await expect(
      controller.issuePlaybackTicket(USER, ASSET_ID, {}, buildRequest()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
