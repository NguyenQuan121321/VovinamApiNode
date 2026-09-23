import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const parent = { id: 'u-parent', role: 'PARENT', sessionId: 's', jti: 'j' } as AuthenticatedUser;
const studentUser = {
  id: 'u-student',
  role: 'STUDENT',
  sessionId: 's',
  jti: 'j',
} as AuthenticatedUser;

const MINOR_DOB = new Date('2014-05-01');
const ADULT_DOB = new Date('1995-05-01');

function makePrismaMock() {
  return {
    consentLog: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'consent-1',
        revokedAt: null,
        consentedAt: new Date(),
        ...data,
      })),
      updateMany: jest.fn(),
    },
    studentProfile: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock) {
  const audit = { record: jest.fn() };
  const ownership = { assertCanAccess: jest.fn().mockResolvedValue(undefined) };
  const service = new ConsentService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    ownership as unknown as StudentOwnershipService,
  );
  return { service, auditRecord: audit.record as jest.Mock, ownership };
}

describe('ConsentService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
  });

  it('grants self consent without an acting user', async () => {
    const { service, auditRecord } = makeService(prisma);
    prisma.consentLog.findFirst.mockResolvedValue(null);
    const result = await service.grant(studentUser, { purpose: 'DATA_PROCESSING' });
    expect(prisma.consentLog.create).toHaveBeenCalledWith({
      data: { userId: studentUser.id, purpose: 'DATA_PROCESSING', consentedByUserId: null },
    });
    expect(result.active).toBe(true);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'consent_granted', userId: studentUser.id }),
    );
  });

  it('is idempotent when the purpose already has an active row', async () => {
    const { service, auditRecord } = makeService(prisma);
    prisma.consentLog.findFirst.mockResolvedValue({
      id: 'existing',
      purpose: 'DATA_PROCESSING',
      consentedByUserId: null,
      consentedAt: new Date(),
      revokedAt: null,
    });
    const result = await service.grant(studentUser, { purpose: 'DATA_PROCESSING' });
    expect(prisma.consentLog.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'existing', alreadyActive: true }));
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('records a verified parent as the actor consenting for a linked minor with an account', async () => {
    const { service } = makeService(prisma);
    prisma.consentLog.findFirst.mockResolvedValue(null);
    prisma.studentProfile.findFirst.mockResolvedValue({
      userId: 'u-student',
      dob: MINOR_DOB,
    });
    const result = await service.grant(parent, {
      purpose: 'MEDIA_USAGE',
      studentId: 'sp-minor',
    });
    expect(prisma.consentLog.create).toHaveBeenCalledWith({
      data: { userId: 'u-student', purpose: 'MEDIA_USAGE', consentedByUserId: parent.id },
    });
    expect(result.consentedByUserId).toBe(parent.id);
  });

  it('rejects parent consent for an adult student', async () => {
    const { service } = makeService(prisma);
    prisma.studentProfile.findFirst.mockResolvedValue({ userId: 'u-adult', dob: ADULT_DOB });
    await expect(
      service.grant(parent, { purpose: 'MEDIA_USAGE', studentId: 'sp-adult' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentLog.create).not.toHaveBeenCalled();
  });

  it('rejects consent for a student profile without an account', async () => {
    const { service } = makeService(prisma);
    prisma.studentProfile.findFirst.mockResolvedValue({ userId: null, dob: MINOR_DOB });
    await expect(
      service.grant(parent, { purpose: 'MEDIA_USAGE', studentId: 'sp-no-account' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentLog.create).not.toHaveBeenCalled();
  });

  it('propagates the ownership-guard 404 for a foreign student id', async () => {
    const { service, ownership } = makeService(prisma);
    ownership.assertCanAccess.mockRejectedValue(new NotFoundException('Not found'));
    await expect(
      service.grant(parent, { purpose: 'MEDIA_USAGE', studentId: 'sp-foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokes the active row and audits it', async () => {
    const { service, auditRecord } = makeService(prisma);
    prisma.consentLog.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.revoke(studentUser, { purpose: 'DATA_PROCESSING' });
    expect(result.revokedAt).toBeInstanceOf(Date);
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ event: 'consent_revoked' }));
  });

  it('answers the uniform 404 when there is no active consent to revoke', async () => {
    const { service } = makeService(prisma);
    prisma.consentLog.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.revoke(studentUser, { purpose: 'MARKETING_NOTICE' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only the caller history, newest first', async () => {
    const { service } = makeService(prisma);
    prisma.consentLog.findMany.mockResolvedValue([
      {
        id: 'c-2',
        purpose: 'MEDIA_USAGE',
        consentedByUserId: null,
        consentedAt: new Date(),
        revokedAt: null,
      },
    ]);
    const result = await service.myHistory(studentUser);
    expect(prisma.consentLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: studentUser.id } }),
    );
    expect(result.items[0]).toEqual(expect.objectContaining({ id: 'c-2', active: true }));
  });
});
