import { NotFoundException } from '@nestjs/common';

import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { PUBLIC_SYSTEM_SETTING_KEYS } from './public-settings';

/**
 * DiscoveryController smoke tests — verify that public endpoints thread the
 * query/path params through to the service unmodified.
 *
 * Public-route metadata (the `@Public()` decorator) is exercised by the
 * global JwtAuthGuard test suite and by an explicit metadata assertion
 * below.
 */
describe('DiscoveryController', () => {
  let controller: DiscoveryController;
  let service: jest.Mocked<DiscoveryService>;

  beforeEach(() => {
    service = {
      listCourses: jest.fn(),
      getCourseById: jest.fn(),
      listTeachers: jest.fn(),
      getSystemSetting: jest.fn(),
    } as any;
    controller = new DiscoveryController(service);
  });

  it('GET /discovery/courses forwards filters to listCourses', async () => {
    service.listCourses.mockResolvedValue({ items: [], nextCursor: null });

    const query = {
      q: 'ielts',
      specialtyId: '00000000-0000-0000-0000-000000000001',
      pageSize: 10,
    } as any;

    await controller.listCourses(query);
    expect(service.listCourses).toHaveBeenCalledWith(query);
  });

  it('GET /discovery/courses/:id forwards the id to getCourseById', async () => {
    service.getCourseById.mockResolvedValue({ id: 'c-1' } as any);
    await controller.getCourse('c-1');
    expect(service.getCourseById).toHaveBeenCalledWith('c-1');
  });

  it('GET /discovery/teachers forwards filters to listTeachers', async () => {
    service.listTeachers.mockResolvedValue({ items: [], nextCursor: null });
    const query = { q: 'jane', pageSize: 5 } as any;
    await controller.listTeachers(query);
    expect(service.listTeachers).toHaveBeenCalledWith(query);
  });

  it('marks every route as @Public() so the JwtAuthGuard skips auth', () => {
    // We assert via the same Reflect.getMetadata key the decorator sets so
    // a future refactor that drops @Public() trips this test.
    const proto = DiscoveryController.prototype;
    const handlers = ['listCourses', 'getCourse', 'listTeachers'] as const;
    for (const handler of handlers) {
      const isPublic = Reflect.getMetadata(
        'isPublic',
        proto[handler] as object,
      );
      expect(isPublic).toBe(true);
    }
  });

  // -------------------------------------------------------------------
  // GET /discovery/settings/:key
  // -------------------------------------------------------------------

  describe('getSetting', () => {
    it('serves an explicitly published key', async () => {
      service.getSystemSetting.mockResolvedValue({ hero: 'Salom' } as never);

      await expect(controller.getSetting('MARKETING_CONTENT')).resolves.toEqual({
        hero: 'Salom',
      });
      expect(service.getSystemSetting).toHaveBeenCalledWith('MARKETING_CONTENT');
    });

    it.each([
      'SMTP_PASSWORD',
      'OPENAI_API_KEY',
      'PAYME_KEY',
      'INTERNAL_PRICING',
    ])('refuses the un-published key %s without querying it', async (key) => {
      // `SystemSetting` is a free-form key→Json store an ADMIN can write
      // anything into, and this route is `@Public()`. Serving an arbitrary
      // caller-supplied key published every operational value an admin
      // ever stored to anyone who could guess its name.
      await expect(controller.getSetting(key)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(service.getSystemSetting).not.toHaveBeenCalled();
    });

    it('404s unknown keys with the same shape as a missing row', async () => {
      // A distinct error would confirm that a private setting exists.
      await expect(controller.getSetting('NOPE')).rejects.toMatchObject({
        response: { code: 'SETTING_NOT_FOUND' },
      });
    });

    it('keeps the allow-list intentionally small', () => {
      // Tripwire: adding a key here is an act of publication. If this
      // fails, confirm the new key is safe for anonymous visitors.
      expect(PUBLIC_SYSTEM_SETTING_KEYS).toEqual(['MARKETING_CONTENT']);
    });
  });
});
