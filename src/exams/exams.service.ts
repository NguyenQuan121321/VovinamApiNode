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
import { BillingService } from '../billing/billing.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type {
  CreateBeltExamDto,
  ExamResultDto,
  ListExamsQueryDto,
  RegisterExamDto,
  UpdateBeltExamDto,
} from './dto/exams.dto';

type ExamRegistrationWithExam = Prisma.ExamRegistrationGetPayload<{
  include: {
    exam: { select: { code: true; title: true; feeAmount: true; examDate: true } };
    student: true;
  };
}> & { exam: { code: string; title: string; feeAmount: number; examDate: Date } };

/**
 * Belt exams (plan sections 6, 8, 7.1 of the AC list). Registration is
 * STUDENT (self) / PARENT (verified link) through the ownership guard and
 * atomically issues an EXAM_FEE invoice; result entry promotes the student's
 * rank on PASS (plan 13, P3 AC).
 */
@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: StudentOwnershipService,
    private readonly billing: BillingService,
  ) {}

  async list(query: ListExamsQueryDto): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where = { ...(query.status === undefined ? {} : { status: query.status }) };
    const [exams, total] = await this.prisma.$transaction([
      this.prisma.beltExam.findMany({
        where,
        include: { targetRank: { select: { code: true, name: true } } },
        orderBy: { examDate: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.beltExam.count({ where }),
    ]);
    return {
      items: exams.map((exam) => this.serializeExam(exam)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getById(examId: string): Promise<Record<string, unknown>> {
    const exam = await this.prisma.beltExam.findUnique({
      where: { id: examId },
      include: {
        targetRank: { select: { code: true, name: true } },
        _count: { select: { registrations: { where: { status: { not: 'CANCELLED' } } } } },
      },
    });
    if (exam === null) {
      throw new NotFoundException('Not found');
    }
    return { ...this.serializeExam(exam), registeredCount: exam._count.registrations };
  }

  async create(dto: CreateBeltExamDto): Promise<Record<string, unknown>> {
    await this.assertTargetRank(dto.targetRankId);
    this.assertDateOrder(dto.registrationDeadline, dto.examDate);
    const exam = await this.prisma.beltExam.create({
      data: {
        code: dto.code ?? (await this.generateExamCode()),
        title: dto.title,
        examDate: new Date(dto.examDate),
        location: dto.location,
        targetRankId: dto.targetRankId,
        feeAmount: dto.feeAmount,
        capacity: dto.capacity,
        registrationDeadline: new Date(dto.registrationDeadline),
      },
    });
    this.audit.record({
      event: 'belt_exam_created',
      success: true,
      detail: `belt_exam:${exam.id} code:${exam.code}`,
    });
    return { id: exam.id, code: exam.code, title: exam.title, status: exam.status };
  }

  async update(examId: string, dto: UpdateBeltExamDto): Promise<Record<string, unknown>> {
    const exam = await this.prisma.beltExam.findUnique({ where: { id: examId } });
    if (exam === null) {
      throw new NotFoundException('Not found');
    }
    if (dto.targetRankId !== undefined) {
      await this.assertTargetRank(dto.targetRankId);
    }
    const deadline = dto.registrationDeadline ?? exam.registrationDeadline.toISOString();
    const examDate = dto.examDate ?? exam.examDate.toISOString();
    this.assertDateOrder(deadline, examDate);
    const updated = await this.prisma.beltExam.update({ where: { id: examId }, data: dto });
    this.audit.record({
      event: 'belt_exam_updated',
      success: true,
      detail: `belt_exam:${examId}`,
    });
    return { id: updated.id, code: updated.code, status: updated.status };
  }

  /**
   * STUDENT self / PARENT verified-link registration (plan 7.3 via the ownership
   * guard). Creates the registration and its EXAM_FEE invoice atomically.
   */
  async register(
    caller: AuthenticatedUser,
    examId: string,
    dto: RegisterExamDto,
  ): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, dto.studentId);
    const registration = await this.prisma.$transaction(async (tx) => {
      const exam = await tx.beltExam.findUnique({ where: { id: examId } });
      if (exam === null) {
        throw new NotFoundException('Not found');
      }
      if (exam.status !== 'OPEN') {
        throw new ConflictException('Exam is not open for registration');
      }
      if (new Date() > exam.registrationDeadline) {
        throw new ConflictException('Registration deadline has passed');
      }
      const profile = await tx.studentProfile.findFirst({
        where: { id: dto.studentId, deletedAt: null },
      });
      if (profile === null) {
        throw new NotFoundException('Not found');
      }
      if (profile.status !== 'ACTIVE') {
        throw new ConflictException('Student profile is not active');
      }
      if (profile.currentBeltRankId !== null) {
        const ranks = await tx.beltRank.findMany({
          where: { id: { in: [profile.currentBeltRankId, exam.targetRankId] } },
          select: { id: true, orderIndex: true },
        });
        const current = ranks.find((r) => r.id === profile.currentBeltRankId);
        const target = ranks.find((r) => r.id === exam.targetRankId);
        if (
          current !== undefined &&
          target !== undefined &&
          current.orderIndex >= target.orderIndex
        ) {
          throw new ConflictException('Student already holds this rank or higher');
        }
      }
      if (exam.capacity !== null) {
        const registered = await tx.examRegistration.count({
          where: { examId, status: { not: 'CANCELLED' } },
        });
        if (registered >= exam.capacity) {
          throw new ConflictException('Exam is full');
        }
      }
      const duplicate = await tx.examRegistration.findUnique({
        where: { examId_studentId: { examId, studentId: dto.studentId } },
        select: { id: true },
      });
      if (duplicate !== null) {
        throw new ConflictException('Student is already registered for this exam');
      }
      const created = await tx.examRegistration.create({
        data: {
          examId,
          studentId: dto.studentId,
          currentRankId: profile.currentBeltRankId,
          targetRankId: exam.targetRankId,
        },
        include: {
          exam: { select: { code: true, title: true, feeAmount: true, examDate: true } },
          student: true,
        },
      });
      const invoice = await this.billing.createExamFeeInvoice(tx, {
        studentId: dto.studentId,
        exam: created.exam,
        examRegistrationId: created.id,
        createdBy: caller.id,
      });
      return { registration: created, invoice };
    });
    this.audit.record({
      event: 'exam_registration_created',
      success: true,
      detail: `exam_registration:${registration.registration.id} student:${dto.studentId} exam:${examId}`,
    });
    return this.serializeRegistration(registration.registration, registration.invoice);
  }

  /** ADMIN/INSTRUCTOR record the exam outcome; PASS promotes the student's rank. */
  async recordResult(
    caller: AuthenticatedUser,
    registrationId: string,
    dto: ExamResultDto,
  ): Promise<Record<string, unknown>> {
    let examinerId = caller.id;
    if (dto.examinerId !== undefined) {
      if (caller.role !== 'ADMIN') {
        throw new BadRequestException('Only an admin can attribute a different examiner');
      }
      const examiner = await this.prisma.user.findFirst({
        where: {
          id: dto.examinerId,
          deletedAt: null,
          isActive: true,
          role: { in: ['INSTRUCTOR', 'ADMIN'] },
        },
        select: { id: true },
      });
      if (examiner === null) {
        throw new NotFoundException('Not found');
      }
      examinerId = examiner.id;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const registration = await tx.examRegistration.findUnique({
        where: { id: registrationId },
        include: { exam: { select: { targetRankId: true } } },
      });
      if (registration === null) {
        throw new NotFoundException('Not found');
      }
      if (registration.status === 'RESULT_PASS' || registration.status === 'RESULT_FAIL') {
        throw new ConflictException('Result already recorded');
      }
      if (registration.status === 'CANCELLED') {
        throw new ConflictException('Registration is cancelled');
      }
      const result = await tx.examRegistration.update({
        where: { id: registrationId },
        data: {
          status: dto.status,
          resultNote: dto.resultNote,
          examinerId,
        },
      });
      if (dto.status === 'RESULT_PASS') {
        await tx.studentProfile.update({
          where: { id: registration.studentId },
          data: { currentBeltRankId: registration.exam.targetRankId },
        });
      }
      return result;
    });
    this.audit.record({
      event: 'exam_result_recorded',
      success: true,
      detail: `exam_registration:${registrationId} outcome:${dto.status} examiner:${examinerId}`,
    });
    return {
      id: updated.id,
      examId: updated.examId,
      studentId: updated.studentId,
      status: updated.status,
      resultNote: updated.resultNote,
      examinerId: updated.examinerId,
    };
  }

  private async assertTargetRank(rankId: number): Promise<void> {
    const rank = await this.prisma.beltRank.findUnique({ where: { id: rankId } });
    if (rank === null) {
      throw new NotFoundException('Not found');
    }
    // Exams may not target a deactivated rank (only existence was checked before).
    if (!rank.isActive) {
      throw new ConflictException('Belt rank is not active');
    }
  }

  private assertDateOrder(registrationDeadline: string | Date, examDate: string | Date): void {
    if (new Date(registrationDeadline) > new Date(examDate)) {
      throw new BadRequestException('Registration deadline must not be after the exam date');
    }
  }

  /** Exam code EXAM-<year>-<NN>; unique-constraint safe via bounded retries. */
  private async generateExamCode(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `EXAM-${year}-`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await this.prisma.beltExam.findFirst({
        where: { code: { startsWith: prefix } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      const seq = last === null ? 1 : Number.parseInt(last.code.slice(prefix.length), 10) + 1;
      const code = `${prefix}${String(seq).padStart(2, '0')}`;
      const clash = await this.prisma.beltExam.findUnique({ where: { code } });
      if (clash === null) {
        return code;
      }
    }
    throw new ConflictException('Could not generate a unique exam code');
  }

  private serializeExam(exam: {
    id: string;
    code: string;
    title: string;
    examDate: Date;
    location: string | null;
    feeAmount: number;
    capacity: number | null;
    registrationDeadline: Date;
    status: string;
    targetRank: { code: string; name: string };
  }): Record<string, unknown> {
    return {
      id: exam.id,
      code: exam.code,
      title: exam.title,
      examDate: exam.examDate,
      location: exam.location,
      targetRank: exam.targetRank,
      feeAmount: exam.feeAmount,
      capacity: exam.capacity,
      registrationDeadline: exam.registrationDeadline,
      status: exam.status,
    };
  }

  private serializeRegistration(
    registration: ExamRegistrationWithExam,
    invoice: { id: string; invoiceNo: string; total: number; status: string },
  ): Record<string, unknown> {
    return {
      id: registration.id,
      examId: registration.examId,
      studentId: registration.studentId,
      status: registration.status,
      currentRankId: registration.currentRankId,
      targetRankId: registration.targetRankId,
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        total: invoice.total,
        status: invoice.status,
      },
    };
  }
}
