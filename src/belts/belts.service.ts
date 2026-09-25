import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type { CreateBeltRankDto, UpdateBeltRankDto } from './dto/belts.dto';

/** Maps the two unique constraints (code, orderIndex) to distinct 409 messages. */
function mapRankConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = (error.meta as { target?: string[] } | undefined)?.target ?? [];
    if (target.includes('orderIndex') || target.includes('order_index')) {
      return new ConflictException('Order index already exists');
    }
    return new ConflictException('Belt rank code already exists');
  }
  return error;
}

/**
 * Belt ranks (plan sections 6, 8): seeded catalog, admin-editable, readable by
 * any authenticated role (students need it to pick exam targets; plan 8).
 */
@Injectable()
export class BeltsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Array<Record<string, unknown>>> {
    const ranks = await this.prisma.beltRank.findMany({ orderBy: { orderIndex: 'asc' } });
    return ranks.map((rank) => ({
      id: rank.id,
      code: rank.code,
      name: rank.name,
      rankGroup: rank.rankGroup,
      orderIndex: rank.orderIndex,
      isActive: rank.isActive,
    }));
  }

  async create(dto: CreateBeltRankDto): Promise<Record<string, unknown>> {
    try {
      const rank = await this.prisma.beltRank.create({
        data: {
          code: dto.code,
          name: dto.name,
          rankGroup: dto.rankGroup,
          orderIndex: dto.orderIndex,
          isActive: dto.isActive,
        },
      });
      this.audit.record({
        event: 'belt_rank_created',
        success: true,
        detail: `belt_rank:${rank.id} code:${rank.code}`,
      });
      return { id: rank.id, code: rank.code, name: rank.name };
    } catch (error) {
      throw mapRankConflict(error);
    }
  }

  async update(rankId: number, dto: UpdateBeltRankDto): Promise<Record<string, unknown>> {
    const existing = await this.prisma.beltRank.findUnique({ where: { id: rankId } });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    try {
      const rank = await this.prisma.beltRank.update({ where: { id: rankId }, data: dto });
      this.audit.record({
        event: 'belt_rank_updated',
        success: true,
        detail: `belt_rank:${rankId}`,
      });
      return { id: rank.id, code: rank.code, name: rank.name };
    } catch (error) {
      throw mapRankConflict(error);
    }
  }

  /**
   * Belt distribution report (matrix row 28): active students grouped by their
   * current rank. ADMIN sees the club; INSTRUCTOR only students currently
   * enrolled in the classes they teach.
   */
  async distribution(caller: AuthenticatedUser): Promise<Record<string, unknown>> {
    const where: Prisma.StudentProfileWhereInput = { deletedAt: null };
    if (caller.role === 'INSTRUCTOR') {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { leftAt: null, class: { instructorId: caller.id } },
        select: { studentId: true },
        distinct: ['studentId'],
      });
      where.id = { in: enrollments.map((enrollment) => enrollment.studentId) };
    }
    const grouped = await this.prisma.studentProfile.groupBy({
      by: ['currentBeltRankId'],
      where,
      _count: { _all: true },
    });
    const ranks = await this.prisma.beltRank.findMany({ orderBy: { orderIndex: 'asc' } });
    const unranked = await this.prisma.studentProfile.count({
      where: { ...where, currentBeltRankId: null },
    });
    const countByRank = new Map(grouped.map((row) => [row.currentBeltRankId, row._count._all]));
    return {
      distribution: ranks.map((rank) => ({
        rankId: rank.id,
        code: rank.code,
        name: rank.name,
        orderIndex: rank.orderIndex,
        students: countByRank.get(rank.id) ?? 0,
      })),
      unrankedStudents: unranked,
    };
  }
}
