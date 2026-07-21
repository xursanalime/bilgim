import { CatalogService } from './catalog.service';
import { CoursesController } from './courses.controller';
import { JwtPayload } from '../auth/tokens.service';

/**
 * CoursesController smoke tests — verify the controller threads through to
 * the service with the JWT-derived `teacherId` (Req 7.1, 7.7).
 *
 * Auth (JwtAuthGuard + RolesGuard) is exercised globally by app-level
 * tests; here we mount the controller directly with a mock service.
 */
describe('CoursesController', () => {
  let controller: CoursesController;
  let service: jest.Mocked<CatalogService>;

  const teacherUser: JwtPayload = {
    sub: 'teacher-1',
    email: 't@example.com',
    role: 'TEACHER',
  };

  beforeEach(() => {
    service = {
      createCourse: jest.fn(),
      listCoursesForTeacher: jest.fn(),
      getCourseForTeacher: jest.fn(),
      updateCourse: jest.fn(),
      deleteCourse: jest.fn(),
      publishCourse: jest.fn(),
    } as any;
    controller = new CoursesController(service);
  });

  it('POST /catalog/courses passes teacherId from JWT to the service', async () => {
    const created = { id: 'c1', teacherId: 'teacher-1' };
    service.createCourse.mockResolvedValue(created as any);

    const result = await controller.create(teacherUser, {
      title: 'IELTS',
    });

    expect(service.createCourse).toHaveBeenCalledWith('teacher-1', {
      title: 'IELTS',
    });
    expect(result).toBe(created);
  });

  it('GET /catalog/courses lists only the calling teacher courses', async () => {
    service.listCoursesForTeacher.mockResolvedValue([]);
    await controller.list(teacherUser);
    expect(service.listCoursesForTeacher).toHaveBeenCalledWith('teacher-1');
  });

  it('PATCH /catalog/courses/:id/publish forwards to publishCourse', async () => {
    service.publishCourse.mockResolvedValue({ id: 'c1', isPublished: true } as any);
    await controller.publish(teacherUser, 'c1');
    expect(service.publishCourse).toHaveBeenCalledWith('teacher-1', 'c1');
  });
});
