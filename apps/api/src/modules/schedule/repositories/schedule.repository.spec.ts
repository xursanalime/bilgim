import { ScheduleRepository } from './schedule.repository';

/**
 * ScheduleRepository unit tests.
 *
 * These tests check that the repository forwards the right Prisma calls and
 * — most importantly — that `incrementAndUpdate` and
 * `incrementVersionForDelete` use the atomic `version: { increment: 1 }`
 * Prisma operator. Two concurrent writers cannot produce the same version
 * because that operator translates to `version = version + 1` under the
 * row lock.
 */
describe('ScheduleRepository', () => {
  let prisma: any;
  let repository: ScheduleRepository;

  beforeEach(() => {
    prisma = {
      schedule: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    repository = new ScheduleRepository(prisma);
  });

  it('create() seeds version=1 and forwards rrule/timezone/durationMin', async () => {
    prisma.schedule.create.mockResolvedValue({
      id: 'sch-1',
      groupId: 'g',
      rrule: 'r',
      timezone: 'Asia/Tashkent',
      durationMin: 90,
      version: 1,
    });

    await repository.create({
      groupId: 'g',
      rrule: 'r',
      timezone: 'Asia/Tashkent',
      durationMin: 90,
    });

    expect(prisma.schedule.create).toHaveBeenCalledWith({
      data: {
        groupId: 'g',
        rrule: 'r',
        timezone: 'Asia/Tashkent',
        durationMin: 90,
        version: 1,
      },
    });
  });

  it('incrementAndUpdate() uses Prisma atomic `version: { increment: 1 }` and forwards only provided fields', async () => {
    prisma.schedule.update.mockResolvedValue({});

    await repository.incrementAndUpdate('sch-1', { durationMin: 120 });

    expect(prisma.schedule.update).toHaveBeenCalledWith({
      where: { id: 'sch-1' },
      data: {
        durationMin: 120,
        version: { increment: 1 },
      },
    });
  });

  it('incrementAndUpdate() with all fields forwards every provided value', async () => {
    prisma.schedule.update.mockResolvedValue({});

    await repository.incrementAndUpdate('sch-1', {
      rrule: 'FREQ=DAILY',
      timezone: 'Europe/Berlin',
      durationMin: 45,
    });

    expect(prisma.schedule.update).toHaveBeenCalledWith({
      where: { id: 'sch-1' },
      data: {
        rrule: 'FREQ=DAILY',
        timezone: 'Europe/Berlin',
        durationMin: 45,
        version: { increment: 1 },
      },
    });
  });

  it('incrementVersionForDelete() bumps version atomically without touching other fields', async () => {
    prisma.schedule.update.mockResolvedValue({});

    await repository.incrementVersionForDelete('sch-1');

    expect(prisma.schedule.update).toHaveBeenCalledWith({
      where: { id: 'sch-1' },
      data: { version: { increment: 1 } },
    });
  });

  it('delete() uses deleteMany so missing rows return count=0 instead of throwing', async () => {
    prisma.schedule.deleteMany.mockResolvedValue({ count: 0 });
    const result = await repository.delete('sch-1');
    expect(prisma.schedule.deleteMany).toHaveBeenCalledWith({
      where: { id: 'sch-1' },
    });
    expect(result).toEqual({ count: 0 });
  });
});
