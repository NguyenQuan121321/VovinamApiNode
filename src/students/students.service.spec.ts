import { ConflictException, NotFoundException } from '@nestjs/common';
import { StudentsService, generateInviteCode } from './students.service';
import { StudentOwnershipService } from './student-ownership.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const profile = {
  id: 'sp-1',
  userId: 'u-student',
  fullName: 'Nguyen Van B',
  dob: new Date('2005-06-15'),
  gender: 'MALE',
  phone: '0901112223',
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

const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as AuthenticatedUser;

function makePrismaMock() {
  return {
    studentProfile: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    beltRank: { findUnique: jest.fn() },
    parentStudentLink: { findMany: jest.fn() },
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
  const ownership = new StudentOwnershipService(prisma as unknown as PrismaService);
  return new StudentsService(prisma as unknown as PrismaService, ownership);
}

const createDto = {
  fullName: 'Nguyen Van B',
  dob: '2005-06-15',
  gender: 'MALE' as const,
  phone: '0901112223',
};

describe('StudentsService', () => {
  let prisma: PrismaMock;
  let service: StudentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = makeService(prisma);
  });

  it('generates unambiguous 8-char invite codes', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it('creates a profile with a unique invite code and ACTIVE status', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-student', role: 'STUDENT', deletedAt: null });
    prisma.studentProfile.findUnique.mockResolvedValue(null);
    prisma.studentProfile.create.mockResolvedValue(profile);

    const result = await service.create({ ...createDto, linkedUserEmail: 's@example.com' });
    expect(result.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(result.status).toBe('ACTIVE');
    expect(prisma.studentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u-student' }) }),
    );
  });

  it('rejects unknown linked accounts, duplicates, and unknown belt ranks', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ ...createDto, linkedUserEmail: 'ghost@example.com' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.user.findUnique.mockResolvedValue({ id: 'u', role: 'STUDENT', deletedAt: null });
    prisma.studentProfile.findUnique
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValue(null);
    await expect(
      service.create({ ...createDto, linkedUserEmail: 's@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.studentProfile.findUnique.mockResolvedValue(null);
    prisma.beltRank.findUnique.mockResolvedValue(null);
    prisma.studentProfile.create.mockResolvedValue(profile);
    await expect(service.create({ ...createDto, currentBeltRankId: 99 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists non-deleted profiles with pagination', async () => {
    prisma.studentProfile.findMany.mockResolvedValue([profile]);
    prisma.studentProfile.count.mockResolvedValue(1);
    const page = await service.list({ page: 1, limit: 20 });
    expect(page).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(page.items[0]).toMatchObject({ fullName: 'Nguyen Van B' });
  });

  it('updates an existing profile and validates the belt rank', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(profile);
    prisma.studentProfile.update.mockResolvedValue(profile);
    prisma.beltRank.findUnique.mockResolvedValue({ id: 3 });
    await expect(
      service.update('sp-1', { phone: '0999', currentBeltRankId: 3 }),
    ).resolves.toMatchObject({ fullName: 'Nguyen Van B' });

    prisma.beltRank.findUnique.mockResolvedValue(null);
    await expect(service.update('sp-1', { currentBeltRankId: 99 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.studentProfile.findFirst.mockResolvedValue(null);
    await expect(service.update('missing', { status: 'ACTIVE' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes once and deactivates the linked account', async () => {
    prisma.studentProfile.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.softDelete('sp-1')).resolves.toEqual({ deleted: true });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );

    prisma.studentProfile.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.softDelete('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rotates invite codes for existing profiles', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(profile);
    prisma.studentProfile.findUnique.mockResolvedValue(null);
    prisma.studentProfile.update.mockResolvedValue({ ...profile, inviteCode: 'NEWCODE9' });
    await expect(service.regenerateInviteCode('sp-1')).resolves.toEqual({
      inviteCode: 'NEWCODE9',
    });
    prisma.studentProfile.findFirst.mockResolvedValue(null);
    await expect(service.regenerateInviteCode('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('myProfile returns the linked profile or a uniform 404', async () => {
    prisma.studentProfile.findFirst.mockResolvedValue(profile);
    await expect(service.myProfile(admin)).resolves.toMatchObject({ fullName: 'Nguyen Van B' });
    prisma.studentProfile.findFirst.mockResolvedValue(null);
    await expect(service.myProfile(admin)).rejects.toBeInstanceOf(NotFoundException);
  });
});
