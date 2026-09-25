import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BeltsService } from './belts.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return {
    beltRank: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    studentProfile: { groupBy: jest.fn(), count: jest.fn() },
    enrollment: { findMany: jest.fn() },
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
    service: new BeltsService(prisma as unknown as PrismaService, audit as unknown as AuditService),
    auditRecord: audit.record as jest.Mock,
  };
}

const dto = {
  code: 'VANG_1',
  name: 'Yellow Belt I',
  rankGroup: 'VANG' as const,
  orderIndex: 4,
};

describe('BeltsService', () => {
  let prisma: PrismaMock;
  let service: BeltsService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord } = makeService(prisma));
  });

  it('lists ranks ordered by order index', async () => {
    prisma.beltRank.findMany.mockResolvedValue([
      {
        id: 1,
        code: 'LAM_1',
        name: 'Blue Belt I',
        rankGroup: 'LAM',
        orderIndex: 1,
        isActive: true,
      },
      {
        id: 2,
        code: 'VANG_1',
        name: 'Yellow Belt I',
        rankGroup: 'VANG',
        orderIndex: 4,
        isActive: true,
      },
    ]);
    const items = await service.list();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ code: 'LAM_1' });
    expect(prisma.beltRank.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { orderIndex: 'asc' } }),
    );
  });

  it('creates a rank and audits it', async () => {
    prisma.beltRank.create.mockResolvedValue({ id: 9, code: 'VANG_1', name: 'Yellow Belt I' });
    await expect(service.create(dto)).resolves.toMatchObject({ id: 9, code: 'VANG_1' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'belt_rank_created', success: true }),
    );
  });

  it('maps unique violations to distinct 409 messages', async () => {
    prisma.beltRank.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
        meta: { target: ['order_index'] },
      }),
    );
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create(dto)).rejects.toMatchObject({
      message: 'Order index already exists',
    });

    prisma.beltRank.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
        meta: { target: ['code'] },
      }),
    );
    await expect(service.create(dto)).rejects.toMatchObject({
      message: 'Belt rank code already exists',
    });
  });

  it('404s unknown ranks on update', async () => {
    prisma.beltRank.findUnique.mockResolvedValue(null);
    await expect(service.update(99, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates an existing rank and audits it', async () => {
    prisma.beltRank.findUnique.mockResolvedValue({ id: 9 });
    prisma.beltRank.update.mockResolvedValue({ id: 9, code: 'VANG_1', name: 'Renamed' });
    await expect(service.update(9, { name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'belt_rank_updated', success: true }),
    );
  });

  describe('distribution (matrix row 28)', () => {
    const adminCaller = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as never;
    const instructorCaller = {
      id: 'inst-1',
      role: 'INSTRUCTOR',
      sessionId: 's',
      jti: 'j',
    } as never;

    it('reports students per rank club-wide for the admin, unranked separately', async () => {
      prisma.beltRank.findMany.mockResolvedValue([
        { id: 1, code: 'LAM_1', name: 'Blue 1', orderIndex: 1, isActive: true },
        { id: 2, code: 'LAM_2', name: 'Blue 2', orderIndex: 2, isActive: true },
      ]);
      prisma.studentProfile.groupBy.mockResolvedValue([
        { currentBeltRankId: 2, _count: { _all: 5 } },
      ]);
      prisma.studentProfile.count.mockResolvedValue(3);
      const result = (await service.distribution(adminCaller)) as {
        distribution: Array<{ rankId: number; students: number }>;
        unrankedStudents: number;
      };
      expect(result.distribution.find((r) => r.rankId === 2)?.students).toBe(5);
      expect(result.unrankedStudents).toBe(3);
    });

    it('scopes the instructor to students currently enrolled in their classes', async () => {
      prisma.beltRank.findMany.mockResolvedValue([
        { id: 1, code: 'LAM_1', name: 'Blue 1', orderIndex: 1, isActive: true },
      ]);
      prisma.enrollment.findMany.mockResolvedValue([{ studentId: 'sp-1' }]);
      prisma.studentProfile.groupBy.mockResolvedValue([]);
      prisma.studentProfile.count.mockResolvedValue(0);
      await service.distribution(instructorCaller);
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ leftAt: null }) }),
      );
      const call = prisma.studentProfile.groupBy.mock.calls[0]?.[0] as { where: { id: unknown } };
      expect(call.where.id).toEqual({ in: ['sp-1'] });
    });
  });
});
