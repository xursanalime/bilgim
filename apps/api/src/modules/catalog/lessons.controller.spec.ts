import { CatalogService } from './catalog.service';
import { LessonsController } from './lessons.controller';
import { JwtPayload } from '../auth/tokens.service';

/**
 * LessonsController smoke tests (Req 7.4 – 7.6).
 */
describe('LessonsController', () => {
  let controller: LessonsController;
  let service: jest.Mocked<CatalogService>;

  const teacher: JwtPayload = {
    sub: 'teacher-1',
    email: 't@example.com',
    role: 'TEACHER',
  };
  const student: JwtPayload = {
    sub: 'student-1',
    email: 's@example.com',
    role: 'STUDENT',
  };

  beforeEach(() => {
    service = {
      createLesson: jest.fn(),
      listLessonsForTeacher: jest.fn(),
      listReadyLessonsForGroup: jest.fn(),
      assertStudentEnrolledInGroup: jest.fn(),
      getLessonForTeacher: jest.fn(),
      updateLesson: jest.fn(),
      publishLesson: jest.fn(),
      deleteLesson: jest.fn(),
    } as any;
    controller = new LessonsController(service);
  });

  it('POST /catalog/groups/:groupId/lessons creates a DRAFT lesson', async () => {
    service.createLesson.mockResolvedValue({
      id: 'l1',
      status: 'DRAFT',
    } as any);

    await controller.create(teacher, 'g1', {
      title: 'Lesson 1',
      type: 'TEXT_ONLY',
    });

    expect(service.createLesson).toHaveBeenCalledWith('teacher-1', 'g1', {
      title: 'Lesson 1',
      type: 'TEXT_ONLY',
    });
  });

  it('GET /catalog/groups/:groupId/lessons returns full list for owning teacher', async () => {
    const lessons = [{ id: 'l1', status: 'DRAFT' }];
    service.listLessonsForTeacher.mockResolvedValue(lessons as any);

    const result = await controller.listForGroup(teacher, 'g1');

    expect(service.listLessonsForTeacher).toHaveBeenCalledWith(
      'teacher-1',
      'g1',
    );
    expect(service.listReadyLessonsForGroup).not.toHaveBeenCalled();
    expect(result).toBe(lessons);
  });

  it('GET /catalog/groups/:groupId/lessons returns READY-only for enrolled student', async () => {
    service.assertStudentEnrolledInGroup.mockResolvedValue(undefined);
    const lessons = [{ id: 'l1', status: 'READY' }];
    service.listReadyLessonsForGroup.mockResolvedValue(lessons as any);

    const result = await controller.listForGroup(student, 'g1');

    expect(service.assertStudentEnrolledInGroup).toHaveBeenCalledWith(
      'student-1',
      'g1',
    );
    expect(service.listReadyLessonsForGroup).toHaveBeenCalledWith('g1');
    expect(service.listLessonsForTeacher).not.toHaveBeenCalled();
    expect(result).toBe(lessons);
  });

  it('GET /catalog/lessons/:id returns the LessonAccessGuard-resolved lesson', async () => {
    const lesson = { id: 'l1', status: 'READY' };
    const req = { lesson };

    const result = await controller.getOne(req as any);
    expect(result).toBe(lesson);
  });

  it('PATCH /catalog/lessons/:id/publish forwards to publishLesson', async () => {
    service.publishLesson.mockResolvedValue({
      id: 'l1',
      status: 'READY',
    } as any);

    await controller.publish(teacher, 'l1');

    expect(service.publishLesson).toHaveBeenCalledWith('teacher-1', 'l1');
  });

  it('DELETE /catalog/lessons/:id forwards to deleteLesson', async () => {
    service.deleteLesson.mockResolvedValue(undefined);
    await controller.delete(teacher, 'l1');
    expect(service.deleteLesson).toHaveBeenCalledWith('teacher-1', 'l1');
  });
});
