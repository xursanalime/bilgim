import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

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
});
