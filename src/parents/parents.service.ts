import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    // The code is single-use: the link is created only after the code was
    // claimed by rotating it away in the same transaction.
    await this.prisma.$transaction(async (tx) => {
      await this.claimRotation(tx, profile.id, dto.inviteCode);
      await tx.parentStudentLink.create({
        data: {
          parentUserId,
          studentId: profile.id,
          relationship: 'PARENT',
          verified: true,
        },
      });
    });
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

  /**
   * Single-use claim (DB baseline §12): the rotation is a conditional update
   * matching only the code being consumed, so of two parents racing the same
   * code exactly one wins and the loser sees count 0 — uniform 404, mirroring
   * the already-rotated-code posture. A P2002 means the fresh code collided
   * with another profile and is retried; after 5 collisions the link is
   * refused explicitly — the consumed code is never left reusable (P3-5).
   */
  private async claimRotation(
    tx: Prisma.TransactionClient,
    profileId: string,
    consumedCode: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();
      if (code === consumedCode) {
        continue;
      }
      try {
        const claimed = await tx.studentProfile.updateMany({
          where: { id: profileId, inviteCode: consumedCode },
          data: { inviteCode: code },
        });
        if (claimed.count === 1) {
          return;
        }
        throw new NotFoundException('Not found');
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not rotate the invite code');
  }
}
