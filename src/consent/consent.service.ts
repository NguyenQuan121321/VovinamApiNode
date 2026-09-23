import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type { GrantConsentDto, RevokeConsentDto } from './dto/consent.dto';

type ConsentPurpose = 'DATA_PROCESSING' | 'MEDIA_USAGE' | 'MARKETING_NOTICE';

const MINOR_CUTOFF_YEARS = 18;

const isActive = (purpose: ConsentPurpose): Prisma.ConsentLogWhereInput => ({
  purpose,
  revokedAt: null,
});

/**
 * Purpose-specific consent records (plan sections 6, 7.1, 10). Append-only:
 * a grant on a purpose that already has an active row is idempotent (returns
 * the active row); revocation stamps revokedAt; a re-grant adds a new row —
 * history is never erased. The subject is always an account holder; a verified
 * parent may consent for a linked MINOR who has an account, and the acting
 * parent is recorded in consented_by_user_id.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: StudentOwnershipService,
  ) {}

  async grant(caller: AuthenticatedUser, dto: GrantConsentDto): Promise<Record<string, unknown>> {
    const { subjectUserId, consentedByUserId, subjectLabel } = await this.resolveSubject(
      caller,
      dto,
    );
    const existing = await this.prisma.consentLog.findFirst({
      where: { userId: subjectUserId, ...isActive(dto.purpose) },
    });
    if (existing !== null) {
      return this.serialize(existing, true);
    }
    const row = await this.prisma.consentLog.create({
      data: {
        userId: subjectUserId,
        purpose: dto.purpose,
        consentedByUserId,
      },
    });
    this.audit.record({
      userId: caller.id,
      event: 'consent_granted',
      success: true,
      detail: `purpose:${dto.purpose} subject_user:${subjectUserId}${subjectLabel}`,
    });
    return this.serialize(row, false);
  }

  async revoke(caller: AuthenticatedUser, dto: RevokeConsentDto): Promise<Record<string, unknown>> {
    const { subjectUserId, subjectLabel } = await this.resolveSubject(caller, dto);
    const revokedAt = new Date();
    const updated = await this.prisma.consentLog.updateMany({
      where: { userId: subjectUserId, ...isActive(dto.purpose) },
      data: { revokedAt },
    });
    if (updated.count === 0) {
      // Uniform 404 whether the purpose was never granted or already revoked.
      throw new NotFoundException('No active consent for this purpose');
    }
    this.audit.record({
      userId: caller.id,
      event: 'consent_revoked',
      success: true,
      detail: `purpose:${dto.purpose} subject_user:${subjectUserId}${subjectLabel}`,
    });
    return { purpose: dto.purpose, revokedAt };
  }

  /** Own consent history (plan 8: GET /consent/me) — newest first, revocations included. */
  async myHistory(caller: AuthenticatedUser): Promise<{
    items: Array<Record<string, unknown>>;
  }> {
    const rows = await this.prisma.consentLog.findMany({
      where: { userId: caller.id },
      orderBy: { consentedAt: 'desc' },
    });
    return { items: rows.map((row) => this.serialize(row, false)) };
  }

  /**
   * Resolves whose consent is being acted on. Without studentId the caller is
   * the subject. With studentId the caller must pass the ownership guard (404
   * posture), the student must have an account (no-account minors are an
   * organizational consent matter, not an API one), and parent-proxy consent
   * applies to minors only.
   */
  private async resolveSubject(
    caller: AuthenticatedUser,
    dto: GrantConsentDto | RevokeConsentDto,
  ): Promise<{ subjectUserId: string; consentedByUserId: string | null; subjectLabel: string }> {
    if (dto.studentId === undefined) {
      return { subjectUserId: caller.id, consentedByUserId: null, subjectLabel: '' };
    }
    await this.ownership.assertCanAccess(caller, dto.studentId);
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: dto.studentId, deletedAt: null },
      select: { userId: true, dob: true },
    });
    if (profile === null) {
      // Unreachable for authorized callers (guard verified existence), kept as
      // the fail-safe branch.
      throw new NotFoundException('Not found');
    }
    if (profile.userId === null) {
      // No-account minors have no subject account to attach consent to; this is
      // an organizational consent matter (plan 7.1), not an API one.
      throw new BadRequestException('Consent requires the student to have an account');
    }
    if (profile.userId === caller.id) {
      return { subjectUserId: caller.id, consentedByUserId: null, subjectLabel: '' };
    }
    const adultAt = new Date();
    adultAt.setUTCFullYear(adultAt.getUTCFullYear() - MINOR_CUTOFF_YEARS);
    if (profile.dob <= adultAt) {
      throw new BadRequestException('Parent consent applies to minors only');
    }
    return {
      subjectUserId: profile.userId,
      consentedByUserId: caller.id,
      subjectLabel: ` student_profile:${dto.studentId}`,
    };
  }

  private serialize(
    row: {
      id: string;
      purpose: ConsentPurpose;
      consentedByUserId: string | null;
      consentedAt: Date;
      revokedAt: Date | null;
    },
    alreadyActive: boolean,
  ): Record<string, unknown> {
    return {
      id: row.id,
      purpose: row.purpose,
      consentedByUserId: row.consentedByUserId,
      consentedAt: row.consentedAt,
      revokedAt: row.revokedAt,
      active: row.revokedAt === null,
      ...(alreadyActive ? { alreadyActive: true } : {}),
    };
  }
}
