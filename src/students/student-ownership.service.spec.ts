import { NotFoundException } from '@nestjs/common';
import { StudentOwnershipService } from './student-ownership.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StudentOwnershipService (plan 7.3 — 404 never 403)', () => {
  const studentId = 'sp-1';
  let prisma: {
    studentProfile: { findFirst: jest.Mock };
    parentStudentLink: { findFirst: jest.Mock };
    enrollment: { findFirst: jest.Mock };
  };
  let service: StudentOwnershipService;

  const caller = (role: string, id = 'caller-1') =>
    ({ id, role, sessionId: 's', jti: 'j' }) as never;

  beforeEach(() => {
    prisma = {
      studentProfile: { findFirst: jest.fn() },
      parentStudentLink: { findFirst: jest.fn() },
      enrollment: { findFirst: jest.fn() },
    };
    service = new StudentOwnershipService(prisma as unknown as PrismaService);
    prisma.studentProfile.findFirst.mockResolvedValue({ id: studentId, userId: 'student-user-1' });
    prisma.parentStudentLink.findFirst.mockResolvedValue({ id: 'link-1' });
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e-1' });
  });

  it('grants admins access to any existing profile', async () => {
    await expect(service.assertCanAccess(caller('ADMIN'), studentId)).resolves.toBeUndefined();
  });

  it('grants the student only their own profile', async () => {
    await expect(
      service.assertCanAccess(caller('STUDENT', 'student-user-1'), studentId),
    ).resolves.toBeUndefined();
    await expect(
      service.assertCanAccess(caller('STUDENT', 'someone-else'), studentId),
    ).rejects.toThrow(NotFoundException);
  });

  it('grants parents access only via a verified link', async () => {
    await expect(service.assertCanAccess(caller('PARENT'), studentId)).resolves.toBeUndefined();
    prisma.parentStudentLink.findFirst.mockResolvedValue(null);
    await expect(service.assertCanAccess(caller('PARENT'), studentId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('grants instructors only own-class enrollments and rejects unknown profiles', async () => {
    await expect(
      service.assertCanAccess(caller('INSTRUCTOR', 'inst-1'), studentId),
    ).resolves.toBeUndefined();
    expect(prisma.enrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId,
          leftAt: null,
          class: { instructorId: 'inst-1' },
        }),
      }),
    );
    prisma.enrollment.findFirst.mockResolvedValue(null);
    await expect(service.assertCanAccess(caller('INSTRUCTOR'), studentId)).rejects.toThrow(
      NotFoundException,
    );
    prisma.studentProfile.findFirst.mockResolvedValue(null);
    await expect(service.assertCanAccess(caller('ADMIN'), studentId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
