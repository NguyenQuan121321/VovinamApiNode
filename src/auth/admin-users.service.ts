import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { validatePasswordPolicy } from './domain/password-policy';
import type { AuthenticatedUser } from './guards/authenticated-request';
import type {
  CreateUserDto,
  ListAuditLogQueryDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/users.dto';

const PAGE_MAX = 100;

function serializeUser(user: {
  id: string;
  email: string;
  role: string;
  emailVerifiedAt: Date | null;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    isActive: user.isActive,
    deletedAt: user.deletedAt,
    createdAt: user.createdAt,
  };
}

/**
 * Admin backoffice over user accounts (matrix rows 2/5/6/30). The users table
 * stays owned by the auth domain (AD-08): admin account lifecycle lives here,
 * next to the self-service lifecycle in AuthService. Roles other than the four
 * in the enum do not exist — creating an INSTRUCTOR account through this
 * service is the supported path (no seed-only accounts).
 *
 * Every change that affects trust (role, password, activation) revokes all
 * sessions and bumps pwd_version so stale access/refresh tokens die at once.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<Record<string, unknown>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, PAGE_MAX);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.search === undefined || query.search === ''
        ? {}
        : { email: { contains: query.search, mode: 'insensitive' } }),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: users.map(serializeUser), total, page, limit };
  }

  async create(caller: AuthenticatedUser, dto: CreateUserDto): Promise<Record<string, unknown>> {
    if (!validatePasswordPolicy(dto.password, [dto.email, dto.email.split('@')[0] ?? ''])) {
      throw new BadRequestException(
        'Password must be 8+ characters with letters and digits and must not contain the email',
      );
    }
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: dto.role,
          // Admin-created accounts are verified by the admin (anti-enumeration
          // uniform flows do not apply to this backoffice surface).
          emailVerifiedAt: new Date(),
        },
      });
      this.audit.record({
        userId: caller.id,
        event: 'user_created',
        success: true,
        detail: `user:${user.id} role:${user.role}`,
      });
      return serializeUser(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }
  }

  async update(
    caller: AuthenticatedUser,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<Record<string, unknown>> {
    if (dto.role === undefined && dto.isActive === undefined && dto.newPassword === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    if (caller.id === userId && (dto.role !== undefined || dto.isActive === false)) {
      throw new BadRequestException('Admins cannot change their own role or deactivate themselves');
    }
    if (dto.newPassword !== undefined) {
      const target = await this.prisma.user.findUnique({ where: { id: userId } });
      if (
        target !== null &&
        !validatePasswordPolicy(dto.newPassword, [target.email, target.email.split('@')[0] ?? ''])
      ) {
        throw new BadRequestException(
          'Password must be 8+ characters with letters and digits and must not contain the email',
        );
      }
    }
    const existing = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    // Any trust-affecting change kills existing tokens immediately.
    const trustChanged =
      (dto.role !== undefined && dto.role !== existing.role) ||
      dto.isActive === false ||
      dto.newPassword !== undefined;
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(dto.role === undefined ? {} : { role: dto.role }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          ...(dto.newPassword === undefined
            ? {}
            : { passwordHash: await bcrypt.hash(dto.newPassword, 10) }),
          ...(trustChanged ? { pwdVersion: { increment: 1 } } : {}),
        },
      });
      if (trustChanged) {
        await tx.session.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        });
        await tx.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        });
      }
      return updated;
    });
    this.audit.record({
      userId: caller.id,
      event: 'user_updated',
      success: true,
      detail: `user:${userId} role:${dto.role ?? 'unchanged'} active:${dto.isActive ?? 'unchanged'} password:${dto.newPassword !== undefined}`,
    });
    return serializeUser(user);
  }

  async deactivate(caller: AuthenticatedUser, userId: string): Promise<Record<string, unknown>> {
    if (caller.id === userId) {
      throw new BadRequestException('Admins cannot deactivate their own account here');
    }
    const existing = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), isActive: false },
      }),
      this.prisma.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
    this.audit.record({
      userId: caller.id,
      event: 'user_deactivated',
      success: true,
      detail: `user:${userId} email:${existing.email}`,
    });
    return { id: userId, deactivated: true };
  }

  async listAuditLog(query: ListAuditLogQueryDto): Promise<Record<string, unknown>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, PAGE_MAX);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId === undefined || query.userId === '' ? {} : { userId: query.userId }),
      ...(query.event === undefined || query.event === '' ? {} : { event: query.event }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total, page, limit };
  }
}
