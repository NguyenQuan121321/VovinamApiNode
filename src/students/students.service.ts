import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, StudentProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { StudentOwnershipService } from './student-ownership.service';
import { serializeStudent, type CallerRole } from './serialize-student';
import type { CreateStudentDto, ListStudentsQueryDto, UpdateStudentDto } from './dto/students.dto';

/** 8-char invite code from an unambiguous alphabet (no O/0/I/1), ~40 bits (plan 7.1). */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: StudentOwnershipService,
  ) {}

  /** ADMIN: paginated directory of non-deleted profiles. */
  async list(query: ListStudentsQueryDto): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.StudentProfileWhereInput = { deletedAt: null };
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.search !== undefined) {
      where.fullName = { contains: query.search };
    }
    const [profiles, total] = await this.prisma.$transaction([
      this.prisma.studentProfile.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.studentProfile.count({ where }),
    ]);
    return {
      items: profiles.map((p) => serializeStudent(p, 'ADMIN')),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * ADMIN: creates a profile and returns the single-use invite code for the parent
   * (plan 7.1). Minors never self-register, so no age validation blocks this path.
   */
  async create(dto: CreateStudentDto): Promise<Record<string, unknown>> {
    let userId: string | undefined;
    if (dto.linkedUserEmail !== undefined) {
      const user = await this.prisma.user.findUnique({ where: { email: dto.linkedUserEmail } });
      if (user === null || user.deletedAt !== null || user.role !== 'STUDENT') {
        throw new NotFoundException('Not found');
      }
      const existing = await this.prisma.studentProfile.findUnique({ where: { userId: user.id } });
      if (existing !== null) {
        throw new ConflictException('Student profile already exists for this account');
      }
      userId = user.id;
    }
    if (dto.currentBeltRankId !== undefined) {
      await this.assertBeltRankExists(dto.currentBeltRankId);
    }
    const profile = await this.prisma.studentProfile.create({
      data: {
        userId,
        fullName: dto.fullName,
        dob: new Date(dto.dob),
        gender: dto.gender,
        phone: dto.phone,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        medicalNotes: dto.medicalNotes,
        currentBeltRankId: dto.currentBeltRankId,
        // An approved adult self-registration starts ACTIVE; parent-created minors too
        // (the club accepted them in person).
        status: 'ACTIVE',
        inviteCode: await this.uniqueInviteCode(),
      },
    });
    return {
      ...serializeStudent(profile, 'ADMIN'),
      // The code is handed to the parent through Zalo/in person (plan 7.1); it is the
      // only way a parent can link, so it is returned exactly once here.
      inviteCode: profile.inviteCode,
    };
  }

  /** Any role per the ownership guard; response fields depend on the caller role. */
  async getById(caller: AuthenticatedUser, studentId: string): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, studentId);
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: studentId, deletedAt: null },
    });
    if (profile === null) {
      throw new NotFoundException('Not found');
    }
    return serializeStudent(profile, caller.role as CallerRole);
  }

  /** STUDENT: own profile (plan 8, GET /students/me). */
  async myProfile(caller: AuthenticatedUser): Promise<Record<string, unknown>> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { userId: caller.id, deletedAt: null },
    });
    if (profile === null) {
      // An account without an approved profile is not a student yet.
      throw new NotFoundException('Not found');
    }
    return serializeStudent(profile, 'STUDENT');
  }

  /** ADMIN only (plan 8): full-field edit incl. approval (PENDING -> ACTIVE). */
  async update(studentId: string, dto: UpdateStudentDto): Promise<Record<string, unknown>> {
    const existing = await this.prisma.studentProfile.findFirst({
      where: { id: studentId, deletedAt: null },
    });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    if (dto.currentBeltRankId !== undefined) {
      await this.assertBeltRankExists(dto.currentBeltRankId);
    }
    const updated = await this.prisma.studentProfile.update({
      where: { id: studentId },
      data: {
        fullName: dto.fullName,
        dob: dto.dob === undefined ? undefined : new Date(dto.dob),
        gender: dto.gender,
        phone: dto.phone,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        medicalNotes: dto.medicalNotes,
        currentBeltRankId: dto.currentBeltRankId,
        status: dto.status,
      },
    });
    return serializeStudent(updated, 'ADMIN');
  }

  /** ADMIN: soft delete only (plan 7.2) — invoices stay, profile leaves all queries. */
  async softDelete(studentId: string): Promise<{ deleted: boolean }> {
    const updated = await this.prisma.studentProfile.updateMany({
      where: { id: studentId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Not found');
    }
    // Soft-deleted students can no longer log in as students (guard sees deletedAt).
    await this.prisma.user.updateMany({
      where: { studentProfile: { id: studentId }, isActive: true },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  /** ADMIN: replaces the invite code; the old code stops working immediately (plan 8). */
  async regenerateInviteCode(studentId: string): Promise<Record<string, unknown>> {
    const existing = await this.prisma.studentProfile.findFirst({
      where: { id: studentId, deletedAt: null },
    });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    const updated = await this.prisma.studentProfile.update({
      where: { id: studentId },
      data: { inviteCode: await this.uniqueInviteCode() },
    });
    return { inviteCode: updated.inviteCode };
  }

  private async uniqueInviteCode(): Promise<string> {
    // 8 chars from a 32-char alphabet; collisions are rare but the unique constraint
    // is authoritative, so retry on P2002 (plan 9: creation guarded by a constraint).
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateInviteCode();
      const clash = await this.prisma.studentProfile.findUnique({ where: { inviteCode: code } });
      if (clash === null) {
        return code;
      }
    }
    throw new ConflictException('Could not generate a unique invite code');
  }

  private async assertBeltRankExists(beltRankId: number): Promise<void> {
    const rank = await this.prisma.beltRank.findUnique({ where: { id: beltRankId } });
    if (rank === null) {
      throw new NotFoundException('Not found');
    }
  }

  /** Exposed for the parent module and tests. */
  async findProfileForParent(parentUserId: string): Promise<StudentProfile[]> {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentUserId, verified: true },
      include: { student: true },
    });
    return links.map((l) => l.student).filter((s) => s.deletedAt === null);
  }
}
