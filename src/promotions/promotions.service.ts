import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type {
  CreatePromotionProposalDto,
  ListProposalsQueryDto,
  ReviewProposalDto,
  UpdateProposalDto,
} from './dto/promotions.dto';

const PROPOSAL_INCLUDE = {
  student: { select: { id: true, fullName: true } },
  proposedRank: { select: { code: true, name: true, orderIndex: true } },
} as const;

function serializeProposal(proposal: {
  id: string;
  studentId: string;
  student: { fullName: string };
  proposedRankId: number;
  proposedRank: { code: string; name: string; orderIndex: number };
  note: string | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: proposal.id,
    studentId: proposal.studentId,
    studentName: proposal.student.fullName,
    proposedRank: proposal.proposedRank,
    note: proposal.note,
    status: proposal.status,
    reviewNote: proposal.reviewNote,
    reviewedAt: proposal.reviewedAt,
    createdAt: proposal.createdAt,
  };
}

/**
 * Promotion proposals ("đề xuất thăng đai", matrix row 14): an instructor or the
 * master (ADMIN persona, AD-02) proposes a student for the next rank; the master
 * approves or rejects. Approval is advisory bookkeeping only — the belt itself
 * changes exclusively through an exam RESULT_PASS (plan 13.4), so this flow can
 * never move a rank by itself.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: StudentOwnershipService,
  ) {}

  async create(
    caller: AuthenticatedUser,
    dto: CreatePromotionProposalDto,
  ): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, dto.studentId);
    const student = await this.prisma.studentProfile.findFirst({
      where: { id: dto.studentId, deletedAt: null },
      include: { currentBeltRank: { select: { orderIndex: true } } },
    });
    if (student === null) {
      throw new NotFoundException('Not found');
    }
    const rank = await this.prisma.beltRank.findFirst({
      where: { id: dto.proposedRankId, isActive: true },
    });
    if (rank === null) {
      throw new NotFoundException('Not found');
    }
    const currentOrder = student.currentBeltRank?.orderIndex ?? 0;
    if (rank.orderIndex <= currentOrder) {
      throw new ConflictException('The proposed rank is not above the student’s current rank');
    }
    const openProposal = await this.prisma.promotionProposal.findFirst({
      where: { studentId: dto.studentId, status: 'PENDING' },
      select: { id: true },
    });
    if (openProposal !== null) {
      throw new ConflictException('The student already has an open promotion proposal');
    }
    const proposal = await this.prisma.promotionProposal.create({
      data: {
        studentId: dto.studentId,
        proposedRankId: dto.proposedRankId,
        proposedByUserId: caller.id,
        note: dto.note,
      },
      include: PROPOSAL_INCLUDE,
    });
    this.audit.record({
      userId: caller.id,
      event: 'proposal_created',
      success: true,
      detail: `proposal:${proposal.id} student:${dto.studentId} rank:${rank.code}`,
    });
    return serializeProposal(proposal);
  }

  async list(
    caller: AuthenticatedUser,
    query: ListProposalsQueryDto,
  ): Promise<Record<string, unknown>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const visible = await this.ownership.visibleStudentIds(caller);
    if (visible !== null && visible.length === 0) {
      return { items: [], total: 0, page, limit };
    }
    const where: Prisma.PromotionProposalWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.studentId === undefined ? {} : { studentId: query.studentId }),
      ...(visible === null ? {} : { studentId: { in: visible } }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.promotionProposal.count({ where }),
      this.prisma.promotionProposal.findMany({
        where,
        include: PROPOSAL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: items.map(serializeProposal), total, page, limit };
  }

  /** Author or admin may edit the note while the proposal is still pending. */
  async updateNote(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateProposalDto,
  ): Promise<Record<string, unknown>> {
    const proposal = await this.prisma.promotionProposal.findUnique({ where: { id } });
    if (proposal === null) {
      throw new NotFoundException('Not found');
    }
    if (proposal.status !== 'PENDING') {
      throw new ConflictException('Only pending proposals can be edited');
    }
    if (caller.role !== 'ADMIN' && proposal.proposedByUserId !== caller.id) {
      throw new NotFoundException('Not found');
    }
    const updated = await this.prisma.promotionProposal.update({
      where: { id },
      data: { note: dto.note },
      include: PROPOSAL_INCLUDE,
    });
    this.audit.record({
      userId: caller.id,
      event: 'proposal_updated',
      success: true,
      detail: `proposal:${id}`,
    });
    return serializeProposal(updated);
  }

  async review(
    caller: AuthenticatedUser,
    id: string,
    dto: ReviewProposalDto,
  ): Promise<Record<string, unknown>> {
    if (caller.role !== 'ADMIN') {
      // The master (ADMIN persona) is the only approver (matrix row 14, AD-02).
      throw new NotFoundException('Not found');
    }
    const proposal = await this.prisma.promotionProposal.findUnique({ where: { id } });
    if (proposal === null) {
      throw new NotFoundException('Not found');
    }
    if (proposal.status !== 'PENDING') {
      throw new ConflictException('Only pending proposals can be reviewed');
    }
    const updated = await this.prisma.promotionProposal.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedByUserId: caller.id,
        reviewedAt: new Date(),
        reviewNote: dto.note,
      },
      include: PROPOSAL_INCLUDE,
    });
    this.audit.record({
      userId: caller.id,
      event: 'proposal_reviewed',
      success: true,
      detail: `proposal:${id} status:${dto.status}`,
    });
    return serializeProposal(updated);
  }
}
