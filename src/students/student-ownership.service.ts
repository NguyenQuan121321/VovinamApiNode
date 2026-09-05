import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

/**
 * Ownership guard (plan 7.3) — the most important control in the system. Applies to
 * EVERY route carrying a student id. Violations return 404, never 403, so callers
 * cannot probe which student ids exist.
 *
 * - ADMIN: full access.
 * - STUDENT: only the profile linked to their own account.
 * - PARENT: only profiles linked through a verified parent_student_links row.
 * - INSTRUCTOR: only students enrolled in a class they teach (no classes exist
 *   until the classes increment, so instructors get 404 for now — the clause is
 *   implemented in one place so it activates with the classes tables).
 */
@Injectable()
export class StudentOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAccess(caller: AuthenticatedUser, studentId: string): Promise<void> {
    const allowed = await this.canAccess(caller, studentId);
    if (!allowed) {
      throw new NotFoundException('Not found');
    }
  }

  async canAccess(caller: AuthenticatedUser, studentId: string): Promise<boolean> {
    // Existence first for every role, including admins: unknown or deleted student
    // ids answer 404 uniformly instead of revealing anything by passing the guard.
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (profile === null) {
      return false;
    }
    if (caller.role === 'ADMIN') {
      return true;
    }
    if (caller.role === 'STUDENT') {
      return profile.userId === caller.id;
    }
    if (caller.role === 'PARENT') {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentUserId: caller.id, studentId, verified: true },
        select: { id: true },
      });
      return link !== null;
    }
    if (caller.role === 'INSTRUCTOR') {
      // Classes/enrollments arrive with the classes increment; until then instructors
      // can access no student profiles (uniform 404, S-04 semantics). The enrollment
      // check belongs here so the guard never needs changing again.
      return false;
    }
    return false;
  }
}
