import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AnnouncementsService } from './announcements.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

function makePrismaMock() {
  return {
    announcement: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    class: { findUnique: jest.fn(), findFirst: jest.fn() },
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
    service: new AnnouncementsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    auditRecord: audit.record as jest.Mock,
  };
}

const admin: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' };
const student: AuthenticatedUser = { id: 'student-1', role: 'STUDENT', sessionId: 's', jti: 'j' };
const instructor: AuthenticatedUser = {
  id: 'instructor-1',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
};

const row = {
  id: 'a1',
  title: 'Tet break',
  body: 'No training this week',
  audience: 'ALL' as const,
  classId: null,
  publishedAt: new Date('2026-09-16T00:00:00Z'),
  createdAt: new Date('2026-09-16T00:00:00Z'),
  updatedAt: new Date('2026-09-16T00:00:00Z'),
  class: null,
};

describe('AnnouncementsService', () => {
  let prisma: PrismaMock;
  let service: AnnouncementsService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    ({ service, auditRecord } = makeService((prisma = makePrismaMock())));
  });

  describe('create', () => {
    it('creates a club-wide announcement without a class', async () => {
      prisma.announcement.create.mockResolvedValue(row);
      const result = await service.create(admin, {
        title: 'Tet break',
        body: 'No training this week',
        audience: 'ALL',
      });
      expect(result).toMatchObject({ id: 'a1', audience: 'ALL', classId: null });
      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ audience: 'ALL', classId: null, createdBy: 'admin-1' }),
        include: { class: { select: { name: true } } },
      });
      expect(auditRecord).toHaveBeenCalled();
    });

    it('creates a class announcement for an existing class', async () => {
      prisma.class.findUnique.mockResolvedValue({ id: 'class-1' });
      prisma.announcement.create.mockResolvedValue({
        ...row,
        audience: 'CLASS',
        classId: 'class-1',
      });
      await service.create(admin, {
        title: 'Moved',
        body: 'Training moved to hall B',
        audience: 'CLASS',
        classId: 'class-1',
      });
      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ audience: 'CLASS', classId: 'class-1' }),
        include: { class: { select: { name: true } } },
      });
    });

    it('rejects audience/classId inconsistencies (schema rule DDB-2)', async () => {
      await expect(
        service.create(admin, { title: 'X', body: 'Y', audience: 'ALL', classId: 'class-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(admin, { title: 'X', body: 'Y', audience: 'CLASS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('answers 404 for a class announcement targeting an unknown class', async () => {
      prisma.class.findUnique.mockResolvedValue(null);
      await expect(
        service.create(admin, { title: 'X', body: 'Y', audience: 'CLASS', classId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('answers 404 for an unknown announcement', async () => {
      prisma.announcement.findUnique.mockResolvedValue(null);
      await expect(service.update(admin, 'nope', { title: 'New' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('switching to ALL clears the class target', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...row,
        audience: 'CLASS',
        classId: 'class-1',
        createdBy: 'admin-1',
      });
      prisma.announcement.update.mockResolvedValue(row);
      const result = await service.update(admin, 'a1', { audience: 'ALL' });
      expect(result).toMatchObject({ audience: 'ALL', classId: null });
      expect(prisma.announcement.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ classId: null }) }),
      );
    });

    it('re-targeting a class announcement validates the new class', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...row,
        audience: 'CLASS',
        classId: 'c1',
        createdBy: 'admin-1',
      });
      prisma.class.findUnique.mockResolvedValue(null);
      await expect(service.update(admin, 'a1', { classId: 'c2' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('a foreign instructor answers 404; the author-instructor may edit their own', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...row,
        audience: 'CLASS',
        classId: 'c1',
        createdBy: 'other-instructor',
      });
      await expect(service.update(instructor, 'a1', { title: 'New' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes and audits; unknown ids answer 404', async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', createdBy: 'admin-1' });
      prisma.announcement.delete.mockResolvedValue(row);
      await expect(service.remove(admin, 'a1')).resolves.toEqual({ deleted: true });
      expect(auditRecord).toHaveBeenCalled();

      prisma.announcement.findUnique.mockResolvedValue(null);
      await expect(service.remove(admin, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an instructor may delete only their own announcement', async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', createdBy: 'instructor-1' });
      prisma.announcement.delete.mockResolvedValue(row);
      await expect(service.remove(instructor, 'a1')).resolves.toEqual({ deleted: true });

      prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', createdBy: 'admin-1' });
      await expect(service.remove(instructor, 'a1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list audience scoping (plan 8: ALL + own classes)', () => {
    const query = { page: 1, limit: 20 };

    it('gives ADMIN every announcement', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);
      prisma.announcement.count.mockResolvedValue(0);
      await service.list(admin, query);
      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    const cases: Array<{ name: string; caller: AuthenticatedUser; instructorOwnClasses: boolean }> =
      [
        { name: 'student', caller: student, instructorOwnClasses: false },
        { name: 'instructor', caller: instructor, instructorOwnClasses: true },
      ];
    for (const { name, caller, instructorOwnClasses } of cases) {
      it(`scopes ${name} readers to ALL + their class relationships`, async () => {
        prisma.announcement.findMany.mockResolvedValue([]);
        prisma.announcement.count.mockResolvedValue(0);
        await service.list(caller, query);
        const firstCall = prisma.announcement.findMany.mock.calls[0]?.[0];
        expect(firstCall).toBeDefined();
        const call = firstCall as { where: Prisma.AnnouncementWhereInput };
        const branches = call.where.OR as Prisma.AnnouncementWhereInput[];
        expect(branches).toHaveLength(2);
        expect(branches[0]).toEqual({ audience: 'ALL' });
        const classBranch = branches[1]?.class as Record<string, unknown>;
        const classOptions = classBranch.OR as Array<Record<string, unknown>>;
        const hasInstructorClause = classOptions.some((o) => o.instructorId !== undefined);
        const hasEnrollmentClause = classOptions.some((o) => o.enrollments !== undefined);
        expect(hasInstructorClause).toBe(instructorOwnClasses);
        // The enrollment clause carries both the student (userId) and parent
        // (verified parentLinks) variants for every non-admin reader.
        expect(hasEnrollmentClause).toBe(true);
      });
    }

    it('paginates and returns the standard list shape', async () => {
      prisma.announcement.findMany.mockResolvedValue([row]);
      prisma.announcement.count.mockResolvedValue(1);
      const result = await service.list(student, { page: 2, limit: 5 });
      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
      expect(result).toMatchObject({ total: 1, page: 2, limit: 5 });
      expect(result.items[0]).toMatchObject({ id: 'a1', audience: 'ALL', className: null });
    });
  });
});
