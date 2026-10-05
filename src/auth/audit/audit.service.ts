import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
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
  'consent_granted',
  'consent_revoked',
  'announcement_created',
  'announcement_updated',
  'announcement_deleted',
  'user_created',
  'user_updated',
  'user_deactivated',
  'settings_updated',
  'discount_code_created',
  'discount_code_updated',
  'discount_code_deleted',
  'discount_code_applied',
  'leave_request_created',
  'leave_request_reviewed',
  'leave_request_cancelled',
  'leave_request_deleted',
  'proposal_created',
  'proposal_updated',
  'proposal_reviewed',
  'evaluation_recorded',
  'evaluation_updated',
  'evaluation_deleted',
  'student_profile_self_updated',
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
const MAX_QUEUE_SIZE = 10_000;
const FLUSH_INTERVAL_MS = 5_000;

/**
 * Async batched audit writes (plan 4.1). record() never awaits the database and
 * never throws into the request path. Failed batches retain stable IDs for
 * idempotent retry; bounded buffering and failures are observable without PII.
 */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Prisma.AuditLogCreateManyInput[] = [];
  private flushPromise: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.logger.error({ event: 'audit_queue_capacity_exceeded', buffered: this.queue.length });
      return;
    }
    this.queue.push({
      eventId: randomUUID(),
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
    if (this.flushPromise === null) {
      this.startFlush();
    }
    await this.flushPromise;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    await this.flush();
    if (this.queue.length > 0) {
      this.logger.error({ event: 'audit_shutdown_pending', buffered: this.queue.length });
    }
  }

  private startFlush(): void {
    this.flushPromise = this.drain().finally(() => {
      this.flushPromise = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, BATCH_SIZE);
      try {
        await this.prisma.auditLog.createMany({ data: batch, skipDuplicates: true });
      } catch {
        this.queue.unshift(...batch);
        this.logger.error({ event: 'audit_flush_failed', buffered: this.queue.length });
        return;
      }
    }
  }
}
