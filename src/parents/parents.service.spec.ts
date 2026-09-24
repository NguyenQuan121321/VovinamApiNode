import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ParentsService } from './parents.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const studentProfile = {
  id: 'sp-1',
  userId: null,
  fullName: 'Tran Thi C',
  dob: new Date('2013-01-01'),
  gender: 'FEMALE',
  phone: '0903334445',
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  medicalNotes: null,
  currentBeltRankId: null,
  inviteCode: 'ABCD2345',
  joinedAt: new Date(),
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    studentProfile: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    parentStudentLink: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
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
  return new ParentsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
}

describe('ParentsService', () => {
  let prisma: PrismaMock;
  let service: ParentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService(prisma);
  });

  it('links a parent through a valid invite code and claims it by rotation', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(studentProfile);
    prisma.parentStudentLink.findFirst.mockResolvedValue(null);
    prisma.studentProfile.updateMany.mockResolvedValue({ count: 1 });
    prisma.parentStudentLink.create.mockResolvedValue({});

    const result = await service.linkChild('parent-1', { inviteCode: 'ABCD2345' });
    expect(result).toMatchObject({ fullName: 'Tran Thi C' });
    // DB baseline §12: the rotation is the single-use CLAIM — a conditional
    // update matching only the code being consumed, before the link is created.
    expect(prisma.studentProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'sp-1', inviteCode: 'ABCD2345' },
      data: { inviteCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/) },
    });
    const claimOrder = Math.min(
      ...(prisma.studentProfile.updateMany as jest.Mock).mock.invocationCallOrder,
    );
    const createOrder = Math.min(
      ...(prisma.parentStudentLink.create as jest.Mock).mock.invocationCallOrder,
    );
    expect(claimOrder).toBeLessThan(createOrder);
    const rotated = (prisma.studentProfile.updateMany as jest.Mock).mock.calls[0]?.[0]?.data
      ?.inviteCode as string;
    expect(rotated).not.toBe('ABCD2345');
  });

  it('answers a uniform 404 when the code was consumed by a concurrent link', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(studentProfile);
    prisma.parentStudentLink.findFirst.mockResolvedValue(null);
    prisma.studentProfile.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.linkChild('parent-1', { inviteCode: 'ABCD2345' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.parentStudentLink.create).not.toHaveBeenCalled();
  });

  it('retries the rotation once on a fresh-code collision, then links', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(studentProfile);
    prisma.parentStudentLink.findFirst.mockResolvedValue(null);
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.studentProfile.updateMany
      .mockRejectedValueOnce(collision)
      .mockResolvedValue({ count: 1 });
    prisma.parentStudentLink.create.mockResolvedValue({});

    await expect(service.linkChild('p', { inviteCode: 'ABCD2345' })).resolves.toMatchObject({
      fullName: 'Tran Thi C',
    });
    expect(prisma.studentProfile.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.parentStudentLink.create).toHaveBeenCalledTimes(1);
  });

  it('refuses the link explicitly after repeated fresh-code collisions (P3-5)', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(studentProfile);
    prisma.parentStudentLink.findFirst.mockResolvedValue(null);
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.studentProfile.updateMany.mockRejectedValue(collision);
    await expect(service.linkChild('p', { inviteCode: 'ABCD2345' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.parentStudentLink.create).not.toHaveBeenCalled();
  });

  it('answers a uniform 404 for unknown codes and 409 for duplicates', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(null);
    await expect(service.linkChild('p', { inviteCode: 'ZZZZ9999' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.studentProfile.findFirst.mockResolvedValue(studentProfile);
    prisma.parentStudentLink.findFirst.mockResolvedValue({ id: 'link-1' });
    await expect(service.linkChild('p', { inviteCode: 'ABCD2345' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lists verified, non-deleted children', async () => {
    prisma.parentStudentLink.findMany.mockResolvedValue([{ student: studentProfile }]);
    const children = await service.myChildren('parent-1');
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ fullName: 'Tran Thi C' });
  });

  it('unlinks unverified links freely but guards verified ones', async () => {
    prisma.parentStudentLink.findFirst.mockResolvedValue({ id: 'l1', verified: false });
    await expect(service.unlink('p', 'sp-1')).resolves.toEqual({ unlinked: true });

    prisma.parentStudentLink.findFirst.mockResolvedValue({ id: 'l2', verified: true });
    await expect(service.unlink('p', 'sp-1')).rejects.toBeInstanceOf(ConflictException);

    prisma.parentStudentLink.findFirst.mockResolvedValue(null);
    await expect(service.unlink('p', 'sp-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
