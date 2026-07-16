import { CatalogService } from './catalog.service';
import { GroupsController } from './groups.controller';
import { JwtPayload } from '../auth/tokens.service';

/**
 * GroupsController smoke tests (Req 7.2, 7.7).
 */
describe('GroupsController', () => {
  let controller: GroupsController;
  let service: jest.Mocked<CatalogService>;

  const teacherUser: JwtPayload = {
    sub: 'teacher-1',
    email: 't@example.com',
    role: 'TEACHER',
  };

  beforeEach(() => {
    service = {
      createGroup: jest.fn(),
      listGroupsForCourse: jest.fn(),
      getGroupForTeacher: jest.fn(),
      updateGroup: jest.fn(),
      deleteGroup: jest.fn(),
      updateGroupSettings: jest.fn(),
    } as any;
    controller = new GroupsController(service);
  });

  it('POST /catalog/courses/:courseId/groups forwards teacherId + dto + courseId', async () => {
    service.createGroup.mockResolvedValue({ id: 'g1', modules: [] } as any);

    await controller.create(teacherUser, 'course-1', {
      name: 'Sefer guruhi',
      priceUzs: 200_000,
    });

    expect(service.createGroup).toHaveBeenCalledWith('teacher-1', 'course-1', {
      name: 'Sefer guruhi',
      priceUzs: 200_000,
    });
  });

  it('GET /catalog/courses/:courseId/groups passes through to listGroupsForCourse', async () => {
    service.listGroupsForCourse.mockResolvedValue([]);
    await controller.listByCourse(teacherUser, 'course-1');
    expect(service.listGroupsForCourse).toHaveBeenCalledWith(
      'teacher-1',
      'course-1',
    );
  });

  it('PATCH /catalog/groups/:id forwards teacherId + dto', async () => {
    service.updateGroup.mockResolvedValue({ id: 'g1' } as any);
    await controller.update(teacherUser, 'g1', { name: 'New name' });
    expect(service.updateGroup).toHaveBeenCalledWith('teacher-1', 'g1', {
      name: 'New name',
    });
  });

  it('PATCH /catalog/groups/:id/settings forwards sub + role + dto for the downloadAllowed toggle', async () => {
    service.updateGroupSettings.mockResolvedValue({
      id: 'g1',
      downloadAllowed: true,
    } as any);

    const result = await controller.updateSettings(teacherUser, 'g1', {
      downloadAllowed: true,
    });

    expect(service.updateGroupSettings).toHaveBeenCalledWith(
      'teacher-1',
      'TEACHER',
      'g1',
      { downloadAllowed: true },
    );
    expect(result).toMatchObject({ downloadAllowed: true });
  });
});
