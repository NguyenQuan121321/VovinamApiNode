import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClassesService } from './classes.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as AuthenticatedUser;
const instructor = {
  id: 'inst-1',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
} as AuthenticatedUser;

const cls = {
  id: 'class-1',
  name: 'White Belt A',
  instructorId: 'inst-1',
  location: 'Main hall',
  capacity: 30,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    class: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    classSchedule: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    user: { findFirst: jest.fn() },
    enrollment: { count: jest.fn() },
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock) {
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  const audit = { record: jest.fn() };
  return {
    service: new ClassesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    auditRecord: audit.record as jest.Mock,
  };
}

describe('ClassesService', () => {
  let prisma: PrismaMock;
  let service: ClassesService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord } = makeService(prisma));
  });

  it('creates a class only for an active INSTRUCTOR user', async () => {
    prisma.user.findFirst.mockResolvedValue({ role: 'INSTRUCTOR' });
    prisma.class.create.mockResolvedValue(cls);
    await expect(
      service.create({ name: 'White Belt A', instructorId: 'inst-1' }),
    ).resolves.toMatchObject({ name: 'White Belt A' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'class_created', success: true }),
    );

    prisma.user.findFirst.mockResolvedValue({ role: 'STUDENT' });
    await expect(service.create({ name: 'Bad', instructorId: 'student-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ name: 'Ghost', instructorId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates the instructor on update and 404s unknown classes', async () => {
    prisma.class.findUnique.mockResolvedValue(cls);
    prisma.user.findFirst.mockResolvedValue({ role: 'INSTRUCTOR' });
    prisma.class.update.mockResolvedValue({ ...cls, name: 'Renamed' });
    await expect(service.update('class-1', { name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed',
    });

    prisma.class.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects shrinking the capacity below the active enrollment count', async () => {
    prisma.class.findUnique.mockResolvedValue(cls);
    prisma.enrollment.count.mockResolvedValue(12);
    await expect(service.update('class-1', { capacity: 5 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.class.update).not.toHaveBeenCalled();

    prisma.enrollment.count.mockResolvedValue(5);
    prisma.class.update.mockResolvedValue({ ...cls, capacity: 10 });
    await expect(service.update('class-1', { capacity: 10 })).resolves.toMatchObject({
      capacity: 10,
    });
  });

  it('adds a schedule only with a sane time range', async () => {
    prisma.class.findUnique.mockResolvedValue(cls);
    prisma.classSchedule.create.mockResolvedValue({
      id: 'sched-1',
      classId: 'class-1',
      weekday: 1,
      startTime: new Date('1970-01-01T18:00:00.000Z'),
      endTime: new Date('1970-01-01T20:00:00.000Z'),
      effectiveFrom: new Date('2026-09-01'),
      effectiveTo: null,
    });
    await expect(
      service.addSchedule('class-1', {
        weekday: 1,
        startTime: '18:00',
        endTime: '20:00',
        effectiveFrom: '2026-09-01',
      }),
    ).resolves.toMatchObject({ id: 'sched-1', classId: 'class-1' });

    await expect(
      service.addSchedule('class-1', {
        weekday: 1,
        startTime: '20:00',
        endTime: '18:00',
        effectiveFrom: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.addSchedule('class-1', {
        weekday: 1,
        startTime: '18:00',
        endTime: '20:00',
        effectiveFrom: '2026-09-10',
        effectiveTo: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes a schedule only from its own class', async () => {
    prisma.classSchedule.findFirst.mockResolvedValue({ id: 'sched-1' });
    await expect(service.removeSchedule('class-1', 'sched-1')).resolves.toEqual({ removed: true });

    prisma.classSchedule.findFirst.mockResolvedValue(null);
    await expect(service.removeSchedule('class-1', 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('gates management: admins anywhere, instructors only on their own classes', async () => {
    prisma.class.findUnique.mockResolvedValue(cls);
    await expect(service.assertManageable(admin, 'class-1')).resolves.toMatchObject({
      id: 'class-1',
    });
    await expect(service.assertManageable(instructor, 'class-1')).resolves.toMatchObject({
      id: 'class-1',
    });

    // Foreign instructor gets the uniform 404 (no id probing).
    await expect(
      service.assertManageable({ ...instructor, id: 'inst-2' }, 'class-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Parents/students never manage classes.
    await expect(
      service.assertManageable(
        { id: 'p-1', role: 'PARENT', sessionId: 's', jti: 'j' } as AuthenticatedUser,
        'class-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.class.findUnique.mockResolvedValue(null);
    await expect(service.assertManageable(admin, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists classes with schedules and reports the active enrollment count on detail', async () => {
    prisma.class.findMany.mockResolvedValue([{ ...cls, schedules: [] }]);
    prisma.class.count.mockResolvedValue(1);
    const page = await service.list({ page: 1, limit: 20 });
    expect(page).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(page.items[0]).toMatchObject({ name: 'White Belt A', schedules: [] });

    prisma.class.findUnique.mockResolvedValue({
      ...cls,
      schedules: [],
      _count: { enrollments: 12 },
    });
    await expect(service.getById('class-1')).resolves.toMatchObject({
      activeEnrollmentCount: 12,
    });
    prisma.class.findUnique.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
