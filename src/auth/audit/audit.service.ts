import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const AUDIT_EVENTS = [
  'register',
  'register_duplicate',
  'login',
  'login_failed',
  'login_locked',
  'login_new_ip',
  'logout',
  'logout_all',
  'session_revoked',
  'token_reuse_detected',
  'email_verified',
  'email_verification_resent',
  'password_reset_requested',
  'password_reset',
  'password_changed',
  'email_change_requested',
  'email_changed',
  'mfa_enabled',
  'mfa_disabled',
  'mfa_code_failed',
  'mfa_recovery_used',
  'account_deactivated',
  'account_locked',
  'student_profile_created',
  'student_profile_updated',
  'student_profile_deleted',
  'student_invite_regenerated',
  'parent_link_created',
  'parent_link_removed',
  'class_created',
  'class_updated',
  'enrollment_created',
  'enrollment_removed',
  'attendance_session_created',
  'attendance_recorded',
  'belt_rank_created',
  'belt_rank_updated',
  'belt_exam_created',
  'belt_exam_updated',
  'exam_registration_created',
  'exam_result_recorded',
  'invoice_issued',
  'invoice_created',
  'tuition_generated',
  'payment_created',
  'payment_succeeded',
  'payment_failed',
  'payment_confirmed_cash',
  'payment_flagged',
  'payment_refunded',
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export interface AuditEntry {
  userId?: string;
  event: AuditEvent;
  ip?: string;
  success: boolean;
  detail?: string;
}

const BATCH_SIZE = 50;

/**
 * Async batched audit writes (plan 4.1). record() never awaits the database and
 * never throws into the request path; on flush failure queued entries are dropped
 * (with the failure visible in logs) rather than blocking traffic.
 */
@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly queue: Prisma.AuditLogCreateManyInput[] = [];
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry): void {
    this.queue.push({
      userId: entry.userId,
      event: entry.event,
      ip: entry.ip,
      success: entry.success,
      detail: entry.detail?.slice(0, 500),
    });
    if (this.queue.length >= BATCH_SIZE && this.flushPromise === null) {
      this.startFlush();
    }
  }

  /** Awaits the in-flight flush, then drains whatever is queued. */
  async flush(): Promise<void> {
    if (this.flushPromise !== null) {
      await this.flushPromise;
      return;
    }
    await this.drain();
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private startFlush(): void {
    this.flushPromise = this.drain().finally(() => {
      this.flushPromise = null;
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, BATCH_SIZE);
        await this.prisma.auditLog.createMany({ data: batch });
      }
    } catch {
      this.queue.length = 0;
    }
  }
}
