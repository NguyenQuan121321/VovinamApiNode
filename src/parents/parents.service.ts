import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { serializeStudent } from '../students/serialize-student';
import type { LinkChildDto } from '../students/dto/students.dto';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) {
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return code;
}

/**
 * Parent link flow (plan 7.1): the club hands the parent a single-use 8-char code;
 * entering the code here creates a VERIFIED link. Parents never type student ids.
 */
@Injectable()
export class ParentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async linkChild(parentUserId: string, dto: LinkChildDto): Promise<Record<string, unknown>> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { inviteCode: dto.inviteCode, deletedAt: null },
    });
    if (profile === null) {
      // Uniform 404: invalid or already-rotated codes reveal nothing.
      throw new NotFoundException('Not found');
    }
    const duplicate = await this.prisma.parentStudentLink.findFirst({
      where: { parentUserId, studentId: profile.id },
    });
    if (duplicate !== null) {
      throw new ConflictException('Already linked');
    }
    // The code is single-use: rotating it after use prevents reuse by anyone else.
    await this.prisma.$transaction([
      this.prisma.parentStudentLink.create({
        data: {
          parentUserId,
          studentId: profile.id,
          relationship: 'PARENT',
          verified: true,
        },
      }),
      this.prisma.studentProfile.update({
        where: { id: profile.id },
        data: { inviteCode: await this.rotateCode(profile.inviteCode) },
      }),
    ]);
    this.audit.record({
      event: 'parent_link_created',
      success: true,
      detail: `student_profile:${profile.id} parent:${parentUserId}`,
    });
    return serializeStudent(profile, 'PARENT');
  }

  async myChildren(parentUserId: string): Promise<Array<Record<string, unknown>>> {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentUserId, verified: true },
      include: { student: true },
    });
    return links
      .map((l) => l.student)
      .filter((s) => s.deletedAt === null)
      .map((s) => serializeStudent(s, 'PARENT'));
  }

  /** Unverified links go freely; verified ones need the club (plan 8). */
  async unlink(parentUserId: string, studentId: string): Promise<{ unlinked: boolean }> {
    const link = await this.prisma.parentStudentLink.findFirst({
      where: { parentUserId, studentId },
    });
    if (link === null) {
      throw new NotFoundException('Not found');
    }
    if (link.verified) {
      throw new ConflictException('Contact the club to unlink a verified child');
    }
    await this.prisma.parentStudentLink.delete({ where: { id: link.id } });
    this.audit.record({
      event: 'parent_link_removed',
      success: true,
      detail: `student_profile:${studentId} parent:${parentUserId}`,
    });
    return { unlinked: true };
  }

  /** Best-effort rotation so a consumed code cannot be reused by another parent. */
  private async rotateCode(current: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();
      if (code === current) {
        continue;
      }
      const clash = await this.prisma.studentProfile.findUnique({ where: { inviteCode: code } });
      if (clash === null) {
        return code;
      }
    }
    return current;
  }
}
