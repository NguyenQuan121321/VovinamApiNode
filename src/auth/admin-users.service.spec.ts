import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AdminUsersService } from './admin-users.service';
import { AuditService } from './audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './guards/authenticated-request';

const caller: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' };

function makePrismaMock() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  // The interactive form passes the mock itself as the tx client.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

describe('AdminUsersService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: AdminUsersService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    const audit = { record: jest.fn() };
    service = new AdminUsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    auditRecord = audit.record;
  });

  it('creates an account with a policy-valid password, verified by the admin', async () => {
    prisma.user.create.mockResolvedValue({
      id: 'u1',
      email: 'coach@example.com',
      role: 'INSTRUCTOR',
      emailVerifiedAt: new Date(),
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
    });
    const result = await service.create(caller, {
      email: 'coach@example.com',
      password: 'Str0ngPass',
      role: 'INSTRUCTOR',
    });
    expect(result).toMatchObject({
      email: 'coach@example.com',
      role: 'INSTRUCTOR',
      emailVerified: true,
    });
    const data = prisma.user.create.mock.calls[0]?.[0] as { data: { passwordHash: string } };
    expect(await bcrypt.compare('Str0ngPass', data.data.passwordHash)).toBe(true);
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ event: 'user_created' }));
  });

  it('rejects a policy-violating password', async () => {
    await expect(
      service.create(caller, { email: 'x@example.com', password: 'short', role: 'INSTRUCTOR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a duplicate email to 409', async () => {
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );
    await expect(
      service.create(caller, { email: 'x@example.com', password: 'Str0ngPass', role: 'STUDENT' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('role change revokes sessions and bumps pwd_version', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'STUDENT' });
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u@example.com',
      role: 'INSTRUCTOR',
      emailVerifiedAt: new Date(),
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
    });
    await service.update(caller, 'u1', { role: 'INSTRUCTOR' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'INSTRUCTOR', pwdVersion: { increment: 1 } }),
      }),
    );
    expect(prisma.session.updateMany).toHaveBeenCalled();
  });

  it('an admin cannot deactivate or demote their own account', async () => {
    await expect(service.update(caller, 'admin-1', { isActive: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.deactivate(caller, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivating soft-deletes instead of hard-deleting', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'u@example.com' });
    await service.deactivate(caller, 'u1');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false, deletedAt: expect.any(Date) }),
      }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'user_deactivated' }),
    );
  });

  it('unknown ids answer the uniform 404', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.update(caller, 'nope', { role: 'INSTRUCTOR' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.deactivate(caller, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the audit log newest-first with the standard envelope', async () => {
    prisma.auditLog.findMany.mockResolvedValue([{ id: 2, event: 'login' }]);
    const result = await service.listAuditLog({ page: 1, limit: 20 });
    expect(result).toMatchObject({ total: 0, page: 1, limit: 20 });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'desc' } }),
    );
  });
});
