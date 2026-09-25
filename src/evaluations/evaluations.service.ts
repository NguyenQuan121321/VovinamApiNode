import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type {
  CreateEvaluationDto,
  ListEvaluationsQueryDto,
  UpdateEvaluationDto,
} from './dto/evaluations.dto';

const EVALUATION_INCLUDE = {
  student: { select: { id: true, fullName: true } },
  author: { select: { id: true, email: true } },
} as const;

function serializeEvaluation(evaluation: {
  id: string;
  studentId: string;
  student: { fullName: string };
  authorUserId: string;
  author: { email: string };
  classId: string | null;
  periodMonth: number | null;
  periodYear: number | null;
  rating: number;
  comment: string | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: evaluation.id,
    studentId: evaluation.studentId,
    studentName: evaluation.student.fullName,
    authorUserId: evaluation.authorUserId,
    authorEmail: evaluation.author.email,
    classId: evaluation.classId,
    periodMonth: evaluation.periodMonth,
    periodYear: evaluation.periodYear,
    rating: evaluation.rating,
    comment: evaluation.comment,
    createdAt: evaluation.createdAt,
  };
}

/**
 * Instructor evaluations of students ("đánh giá võ sinh", matrix row 12): an
 * instructor or admin records a 1..10 rating with an optional comment per
 * period; the student (and linked parents) can read them through guard 7.3.
 */
@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: StudentOwnershipService,
  ) {}

  async create(
    caller: AuthenticatedUser,
    dto: CreateEvaluationDto,
  ): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, dto.studentId);
    if ((dto.periodMonth === undefined) !== (dto.periodYear === undefined)) {
      throw new BadRequestException('Period month and year must be given together');
    }
    try {
      const evaluation = await this.prisma.studentEvaluation.create({
        data: {
          studentId: dto.studentId,
          authorUserId: caller.id,
          classId: dto.classId,
          periodMonth: dto.periodMonth,
          periodYear: dto.periodYear,
          rating: dto.rating,
          comment: dto.comment,
        },
        include: EVALUATION_INCLUDE,
      });
      this.audit.record({
        userId: caller.id,
        event: 'evaluation_recorded',
        success: true,
        detail: `evaluation:${evaluation.id} student:${dto.studentId} rating:${dto.rating}`,
      });
      return serializeEvaluation(evaluation);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This author already evaluated the student for that period');
      }
      throw error;
    }
  }

  async listForStudent(
    caller: AuthenticatedUser,
    query: ListEvaluationsQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, query.studentId);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where = { studentId: query.studentId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.studentEvaluation.count({ where }),
      this.prisma.studentEvaluation.findMany({
        where,
        include: EVALUATION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: items.map(serializeEvaluation), total, page, limit };
  }

  async update(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateEvaluationDto,
  ): Promise<Record<string, unknown>> {
    const evaluation = await this.prisma.studentEvaluation.findUnique({ where: { id } });
    if (evaluation === null) {
      throw new NotFoundException('Not found');
    }
    if (caller.role !== 'ADMIN' && evaluation.authorUserId !== caller.id) {
      throw new NotFoundException('Not found');
    }
    const updated = await this.prisma.studentEvaluation.update({
      where: { id },
      data: {
        rating: dto.rating,
        comment: dto.comment,
      },
      include: EVALUATION_INCLUDE,
    });
    this.audit.record({
      userId: caller.id,
      event: 'evaluation_updated',
      success: true,
      detail: `evaluation:${id} rating:${updated.rating}`,
    });
    return serializeEvaluation(updated);
  }

  async delete(caller: AuthenticatedUser, id: string): Promise<Record<string, unknown>> {
    const evaluation = await this.prisma.studentEvaluation.findUnique({ where: { id } });
    if (evaluation === null) {
      throw new NotFoundException('Not found');
    }
    if (caller.role !== 'ADMIN' && evaluation.authorUserId !== caller.id) {
      throw new NotFoundException('Not found');
    }
    await this.prisma.studentEvaluation.delete({ where: { id } });
    this.audit.record({
      userId: caller.id,
      event: 'evaluation_deleted',
      success: true,
      detail: `evaluation:${id}`,
    });
    return { id, deleted: true };
  }
}
