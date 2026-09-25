import { ConflictException, NotFoundException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const instructorCaller: AuthenticatedUser = {
  id: 'instructor-1',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
};
const adminCaller: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' };

function makePrismaMock() {
  return {
    promotionProposal: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    studentProfile: { findFirst: jest.fn() },
    beltRank: { findFirst: jest.fn() },
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg as Promise<unknown>[])
        : (arg as (tx: unknown) => unknown)({}),
    ),
  };
}

describe('PromotionsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: PromotionsService;
  let auditRecord: jest.Mock;
  let ownership: { assertCanAccess: jest.Mock; visibleStudentIds: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    const audit = { record: jest.fn() };
    ownership = {
      assertCanAccess: jest.fn().mockResolvedValue(undefined),
      visibleStudentIds: jest.fn().mockResolvedValue(['sp1']),
    };
    service = new PromotionsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      ownership as unknown as StudentOwnershipService,
    );
    auditRecord = audit.record;
  });

  const student = { id: 'sp1', currentBeltRank: { orderIndex: 3 } };
  const rank = { id: 4, code: 'DO_1', orderIndex: 4, isActive: true };

  it('creates a proposal for a higher rank', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(student);
    prisma.beltRank.findFirst.mockResolvedValue(rank);
    prisma.promotionProposal.findFirst.mockResolvedValue(null);
    prisma.promotionProposal.create.mockResolvedValue({
      id: 'p1',
      studentId: 'sp1',
      student: { fullName: 'Van A' },
      proposedRankId: 4,
      proposedRank: { code: 'DO_1', name: 'Do 1', orderIndex: 4 },
      note: null,
      status: 'PENDING',
      reviewNote: null,
      reviewedAt: null,
      createdAt: new Date(),
    });
    const result = await service.create(instructorCaller, { studentId: 'sp1', proposedRankId: 4 });
    expect(result).toMatchObject({ status: 'PENDING' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'proposal_created' }),
    );
  });

  it('rejects a proposal not above the current rank (409)', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(student);
    prisma.beltRank.findFirst.mockResolvedValue({ ...rank, orderIndex: 3 });
    await expect(
      service.create(instructorCaller, { studentId: 'sp1', proposedRankId: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a second open proposal for the same student (409)', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(student);
    prisma.beltRank.findFirst.mockResolvedValue(rank);
    prisma.promotionProposal.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create(instructorCaller, { studentId: 'sp1', proposedRankId: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('only an admin reviews; a pending proposal cannot be reviewed twice', async () => {
    await expect(
      service.review(instructorCaller, 'p1', { status: 'APPROVED' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.promotionProposal.findUnique
      .mockResolvedValueOnce({ id: 'p1', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'p1', status: 'APPROVED' });
    prisma.promotionProposal.update.mockResolvedValue({
      id: 'p1',
      studentId: 'sp1',
      student: { fullName: 'Van A' },
      proposedRankId: 4,
      proposedRank: { code: 'DO_1', name: 'Do 1', orderIndex: 4 },
      note: null,
      status: 'APPROVED',
      reviewNote: null,
      reviewedAt: new Date(),
      createdAt: new Date(),
    });
    await service.review(adminCaller, 'p1', { status: 'APPROVED' });
    await expect(service.review(adminCaller, 'p1', { status: 'REJECTED' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'proposal_reviewed' }),
    );
  });

  it('a non-author instructor cannot edit a foreign proposal (404)', async () => {
    prisma.promotionProposal.findUnique.mockResolvedValue({
      id: 'p1',
      status: 'PENDING',
      proposedByUserId: 'someone-else',
    });
    await expect(service.updateNote(instructorCaller, 'p1', { note: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('unknown proposals 404', async () => {
    prisma.promotionProposal.findUnique.mockResolvedValue(null);
    await expect(service.updateNote(adminCaller, 'nope', { note: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('create guards and list filters', () => {
    it('answers 404 for an unknown student or an unknown/inactive rank', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue(null);
      await expect(
        service.create(instructorCaller, { studentId: 'sp-x', proposedRankId: 4 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.studentProfile.findFirst.mockResolvedValue({ id: 'sp-1', currentBeltRank: null });
      prisma.beltRank.findFirst.mockResolvedValue(null);
      await expect(
        service.create(instructorCaller, { studentId: 'sp-1', proposedRankId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns an empty page when the caller can see no students', async () => {
      ownership.visibleStudentIds.mockResolvedValue([]);
      await expect(service.list(instructorCaller, { page: 1, limit: 20 })).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    });

    it('applies status and student filters only when provided', async () => {
      ownership.visibleStudentIds.mockResolvedValue(null);
      await service.list(adminCaller, { page: 1, limit: 20 });
      expect(prisma.promotionProposal.count).toHaveBeenCalledWith({ where: {} });

      await service.list(adminCaller, { page: 1, limit: 20, status: 'PENDING', studentId: 'sp-1' });
      expect(prisma.promotionProposal.count).toHaveBeenCalledWith({
        where: { status: 'PENDING', studentId: 'sp-1' },
      });
    });
  });
});
