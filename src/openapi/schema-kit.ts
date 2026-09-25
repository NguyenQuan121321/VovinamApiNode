/**
 * JSON-Schema builders for the enriched OpenAPI contract (plan 9 envelope).
 *
 * @nestjs/swagger only knows about controller DTOs; the runtime responses are
 * dynamically serialized, so the committed contract needs explicit response
 * schemas. These builders compose the shared envelope/pagination/error shapes
 * and the per-entity data schemas registered into components.schemas.
 */

export type JsonSchema = Record<string, unknown>;

/** The uniform success envelope: {"code": <http status>, "message", "data"}. */
export function envelopeOf(data: JsonSchema): JsonSchema {
  return {
    type: 'object',
    required: ['code', 'message', 'data'],
    properties: {
      code: {
        type: 'integer',
        description: 'HTTP status code mirrored in the body.',
        example: 200,
      },
      message: { type: 'string', description: 'Human-readable status message.', example: 'OK' },
      data,
    },
  };
}

/** The uniform error envelope: data is always null. */
export function envelopeError(): JsonSchema {
  return {
    type: 'object',
    required: ['code', 'message', 'data'],
    properties: {
      code: {
        type: 'integer',
        description: 'HTTP status code mirrored in the body.',
        example: 400,
      },
      message: {
        type: 'string',
        description:
          'Short, generic user-facing error description (validation details are joined into this message; internals stay in the server log).',
        example: 'Bad request',
      },
      data: {
        type: 'string',
        nullable: true,
        description: 'Always null on errors.',
        example: null,
      },
    },
  };
}

/** {items, total, page, limit} — the pagination shape every list returns. */
export function paginated(items: JsonSchema): JsonSchema {
  return {
    type: 'object',
    required: ['items', 'total', 'page', 'limit'],
    properties: {
      items: { type: 'array', items },
      total: {
        type: 'integer',
        description: 'Total rows matching the query across all pages.',
        example: 42,
      },
      page: { type: 'integer', description: 'Current 1-based page.', example: 1 },
      limit: {
        type: 'integer',
        description: 'Page size actually applied (capped at 100).',
        example: 20,
      },
    },
  };
}

const str = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  description,
  example,
});
const int = (description: string, example: unknown): JsonSchema => ({
  type: 'integer',
  description,
  example,
});
const bool = (description: string, example: unknown): JsonSchema => ({
  type: 'boolean',
  description,
  example,
});
const nullableStr = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  nullable: true,
  description,
  example,
});
const dateStr = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  format: 'date',
  description,
  example,
});
const dateTimeStr = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  format: 'date-time',
  description,
  example,
});
const nullableDateTime = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  format: 'date-time',
  nullable: true,
  description,
  example,
});
const nullableInt = (description: string, example: unknown): JsonSchema => ({
  type: 'integer',
  nullable: true,
  description,
  example,
});
const enumOf = (description: string, values: readonly string[], example: string) => ({
  type: 'string',
  enum: [...values],
  description,
  example,
});

export { str, int, bool, nullableStr, dateStr, dateTimeStr, nullableDateTime, nullableInt, enumOf };

const vnd = (description: string, example: number) => int(`${description} (VND integer).`, example);
export { vnd };

/** A serialized student profile; field availability varies by role (see serializer). */
export const StudentSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'fullName', 'dob', 'gender', 'status', 'joinedAt'],
  properties: {
    id: str('StudentProfile id (UUID).', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    fullName: str('Full name.', 'Võ Văn Thảo'),
    dob: dateStr('Date of birth.', '2008-05-14'),
    gender: enumOf('Recorded gender.', ['MALE', 'FEMALE', 'OTHER'], 'MALE'),
    currentBeltRankId: nullableInt(
      'BeltRank id the student currently holds; null when unranked.',
      2,
    ),
    status: enumOf('Lifecycle status.', ['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'], 'ACTIVE'),
    joinedAt: dateTimeStr('When the profile was created.', '2026-09-01T00:00:00.000Z'),
    phone: nullableStr(
      'Contact phone. Hidden from instructors; present for admin/student/parent views.',
      '+84901234567',
    ),
    address: nullableStr('Home address. Hidden from instructors.', '12 Nguyễn Trãi, Q.1, TP.HCM'),
    emergencyContactName: nullableStr(
      'Emergency contact person. Hidden from instructors.',
      'Võ Văn Bảo',
    ),
    emergencyContactPhone: nullableStr(
      'Emergency contact phone. Hidden from instructors.',
      '+84909876543',
    ),
    medicalNotes: nullableStr(
      'Medical notes; visible to every role for safety.',
      'Mild asthma; inhaler in gym bag',
    ),
    hasLinkedAccount: bool(
      'Whether the profile is linked to a loginable STUDENT account. Absent on instructor views.',
      true,
    ),
    inviteCode: str(
      'Single-use parent invite code; returned only by student creation and invite regeneration.',
      'K7M2PQ4X',
    ),
  },
};

export const ScheduleSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'weekday', 'startTime', 'endTime', 'effectiveFrom'],
  properties: {
    id: str('Schedule id (UUID).', 'd1b2c3d4-1111-4bad-9bdd-2b0d7b3dcb6d'),
    weekday: int('Day of week, 0 = Sunday .. 6 = Saturday.', 2),
    startTime: str('Start time HH:MM (24h).', '18:00'),
    endTime: str('End time HH:MM (24h).', '19:30'),
    effectiveFrom: dateStr('First date the slot applies.', '2026-09-01'),
    effectiveTo: dateStr('Last date the slot applies; null when open-ended.', '2026-12-31'),
  },
};

export const ClassSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'name', 'instructorId', 'status', 'createdAt', 'updatedAt', 'schedules'],
  properties: {
    id: str('Class id (UUID).', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    name: str('Class name.', 'Cơ bản A1 — Thứ 3/5'),
    instructorId: str(
      'User id of the assigned instructor.',
      '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
    ),
    location: nullableStr('Training location.', 'Sân A — CLB Q.1'),
    capacity: nullableInt('Maximum number of active enrollments; null when unbounded.', 30),
    status: enumOf('Lifecycle status.', ['ACTIVE', 'PAUSED', 'ARCHIVED'], 'ACTIVE'),
    createdAt: dateTimeStr('Created at.', '2026-09-01T00:00:00.000Z'),
    updatedAt: dateTimeStr('Last update.', '2026-09-10T00:00:00.000Z'),
    schedules: { type: 'array', items: { $ref: '#/components/schemas/ClassScheduleResponse' } },
    activeEnrollmentCount: int(
      'Currently active enrollments; present on the class detail endpoint only.',
      24,
    ),
  },
};

export const EnrollmentSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'student', 'classId', 'className', 'classStatus', 'enrolledAt'],
  properties: {
    id: str('Enrollment id (UUID).', 'a1b2c3d4-2222-4bad-9bdd-2b0d7b3dcb6d'),
    student: { $ref: '#/components/schemas/StudentProfileResponse' },
    classId: str('Class id.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    className: str('Class name (denormalized for convenience).', 'Cơ bản A1 — Thứ 3/5'),
    classStatus: enumOf('Class status.', ['ACTIVE', 'PAUSED', 'ARCHIVED'], 'ACTIVE'),
    enrolledAt: dateTimeStr('Enrollment timestamp.', '2026-09-02T00:00:00.000Z'),
    leftAt: nullableDateTime('When the student left (soft leave); null while enrolled.', null),
  },
};

export const AttendanceSessionSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'classId', 'sessionDate', 'instructorId'],
  properties: {
    id: str('Session id (UUID).', 'b2c3d4e5-3333-4bad-9bdd-2b0d7b3dcb6d'),
    classId: str('Class id.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    sessionDate: dateStr('Session date (one per class per date).', '2026-09-22'),
    instructorId: str('User id of the teacher of record.', '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f'),
    topic: nullableStr('Lesson topic.', 'Đòn thế số 5-6, phản đòn'),
  },
};

export const AttendanceRecordSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'studentId', 'status'],
  properties: {
    id: str('Record id (UUID).', 'c3d4e5f6-4444-4bad-9bdd-2b0d7b3dcb6d'),
    studentId: str('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    fullName: nullableStr('Student full name (present when records are listed).', 'Võ Văn Thảo'),
    status: enumOf('Attendance status.', ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'], 'PRESENT'),
    note: nullableStr('Optional note.', 'Came 10 min late'),
  },
};

export const BeltRankSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'code', 'name', 'rankGroup', 'orderIndex', 'isActive'],
  properties: {
    id: int('BeltRank id.', 2),
    code: str('Club code.', 'VANG_1'),
    name: str('Display name.', 'Vai đai vàng đệ nhất'),
    rankGroup: enumOf('Rank group.', ['LAM', 'VANG', 'DO', 'HUYEN'], 'VANG'),
    orderIndex: int('Global ordering; promotion always targets a higher order.', 4),
    isActive: bool('Deactivated ranks cannot be exam/proposal targets.', true),
  },
};

export const BeltExamSchema: JsonSchema = {
  type: 'object',
  required: [
    'id',
    'code',
    'title',
    'examDate',
    'targetRank',
    'feeAmount',
    'registrationDeadline',
    'status',
  ],
  properties: {
    id: str('Exam id (UUID).', 'd4e5f6a7-5555-4bad-9bdd-2b0d7b3dcb6d'),
    code: str('Exam code.', 'EXAM-2026-03'),
    title: str('Exam title.', 'Kỳ thi thăng đai vàng — tháng 3'),
    examDate: dateStr('Exam date.', '2026-03-28'),
    location: nullableStr('Exam venue.', 'Nhà thi đấu Q.1'),
    targetRank: {
      type: 'object',
      required: ['code', 'name'],
      properties: {
        code: str('Target rank code.', 'VANG_1'),
        name: str('Target rank name.', 'Vai đai vàng đệ nhất'),
      },
    },
    feeAmount: vnd('Exam fee', 150000),
    capacity: int('Maximum active registrations; null when unbounded.', 40),
    registrationDeadline: dateTimeStr(
      'Registration cutoff; later registrations are rejected.',
      '2026-03-20T00:00:00.000Z',
    ),
    status: enumOf('Lifecycle.', ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'], 'OPEN'),
    registeredCount: int(
      'Active (non-cancelled) registrations; present on the detail endpoint only.',
      12,
    ),
  },
};

export const InvoiceItemSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'description', 'quantity', 'unitAmount', 'amount'],
  properties: {
    id: str('Item id (UUID).', 'e5f6a7b8-6666-4bad-9bdd-2b0d7b3dcb6d'),
    description: str('Line description.', 'Tuition 9/2026 — Cơ bản A1'),
    quantity: int('Quantity.', 1),
    unitAmount: vnd('Unit price', 400000),
    amount: vnd('Line total = quantity × unitAmount', 400000),
  },
};

export const InvoiceSchema: JsonSchema = {
  type: 'object',
  required: [
    'id',
    'invoiceNo',
    'studentId',
    'type',
    'subtotal',
    'discount',
    'total',
    'status',
    'dueDate',
    'issuedAt',
  ],
  properties: {
    id: str('Invoice id (UUID).', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'),
    invoiceNo: str('Sequential human code INV-<year>-NNNN.', 'INV-2026-0007'),
    studentId: str('StudentProfile id billed.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    type: enumOf('Invoice type.', ['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'], 'TUITION'),
    periodMonth: int('Billing period month (TUITION only).', 9),
    periodYear: int('Billing period year (TUITION only).', 2026),
    subtotal: vnd('Sum of line items', 400000),
    discount: vnd('Total discount applied (manual + discount code)', 0),
    total: vnd('Amount payable = subtotal − discount', 400000),
    status: enumOf(
      'Payment status.',
      ['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'],
      'UNPAID',
    ),
    dueDate: dateTimeStr('Payment due date.', '2026-10-15T00:00:00.000Z'),
    issuedAt: dateTimeStr('Issue timestamp.', '2026-09-25T00:00:00.000Z'),
    note: nullableStr('Free-text note.', 'Võ phục mới'),
    items: {
      type: 'array',
      description: 'Line items; present on the detail/create endpoints only.',
      items: { $ref: '#/components/schemas/InvoiceItemResponse' },
    },
  },
};

export const PaymentSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'invoiceId', 'orderRef', 'gateway', 'amount', 'status'],
  properties: {
    id: str('PaymentTransaction id (UUID).', 'a7b8c9d0-7777-4bad-9bdd-2b0d7b3dcb6d'),
    invoiceId: str('Invoice the payment belongs to.', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'),
    orderRef: str(
      'Transfer content reference (VV + 8 chars); the webhook reconciles on it.',
      'VVAB23CDE4',
    ),
    gateway: enumOf(
      'Settlement channel.',
      ['BANK_TRANSFER', 'PAYOS', 'SEPAY', 'CASH'],
      'BANK_TRANSFER',
    ),
    amount: vnd('Transferred amount', 400000),
    status: enumOf(
      'Payment state.',
      ['PENDING', 'SUCCESS', 'FAILED', 'DISPUTED', 'REFUNDED'],
      'SUCCESS',
    ),
    paidAt: dateTimeStr(
      'When the payment succeeded; null while pending.',
      '2026-09-25T01:00:00.000Z',
    ),
    expiresAt: dateTimeStr(
      'QR expiry (30 minutes); settlement can still arrive later.',
      '2026-09-25T01:30:00.000Z',
    ),
    note: nullableStr('Cash note or gateway mismatch detail.', 'Cash at dojo, receipt #014'),
  },
};

export const DiscountCodeSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'code', 'validFrom', 'validUntil', 'isActive'],
  properties: {
    id: str('DiscountCode id (UUID).', 'b8c9d0e1-8888-4bad-9bdd-2b0d7b3dcb6d'),
    code: str('Code (uppercase).', 'TET2026'),
    description: nullableStr('Internal description.', 'Tết promotion for tuition'),
    percentOff: int('Percent discount when the code is percent-based.', 10),
    amountOff: vnd('Fixed discount when the code is amount-based', 50000),
    validFrom: dateTimeStr('First valid moment.', '2026-01-01T00:00:00.000Z'),
    validUntil: dateTimeStr('Last valid moment.', '2026-02-28T23:59:59.000Z'),
    isActive: bool('Inactive codes are refused at invoice time.', true),
  },
};

export const NotificationSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'channel', 'templateCode', 'status', 'createdAt'],
  properties: {
    id: str('Notification id (UUID).', 'c9d0e1f2-9999-4bad-9bdd-2b0d7b3dcb6d'),
    channel: enumOf('Delivery channel.', ['IN_APP', 'EMAIL'], 'IN_APP'),
    templateCode: str('Template code, e.g. invoice_issued.', 'invoice_issued'),
    payload: {
      type: 'object',
      description: 'Template payload (e.g. {message}); render the message from this.',
      properties: {
        message: str(
          'Human-readable message.',
          'Invoice INV-2026-0007 (TUITION) issued — total 400000 VND, due 2026-10-15',
        ),
      },
    },
    status: enumOf('Outbox status.', ['PENDING', 'SENT'], 'SENT'),
    readAt: nullableDateTime('When the user marked it read; null while unread.', null),
    sentAt: dateTimeStr('When the worker delivered it.', '2026-09-25T01:00:00.000Z'),
    createdAt: dateTimeStr('Created at.', '2026-09-25T00:00:00.000Z'),
  },
};

export const ConsentSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'purpose', 'consentedAt', 'active'],
  properties: {
    id: str('ConsentLog id (UUID).', 'd0e1f2a3-aaaa-4bad-9bdd-2b0d7b3dcb6d'),
    purpose: enumOf(
      'Consent purpose.',
      ['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'],
      'MEDIA_USAGE',
    ),
    consentedByUserId: nullableStr(
      'Acting parent when granted on behalf of a minor; null for self-consent.',
      '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
    ),
    consentedAt: dateTimeStr('Grant timestamp.', '2026-09-25T00:00:00.000Z'),
    revokedAt: nullableDateTime('Revocation timestamp; null while active.', null),
    active: bool('True while not revoked.', true),
    alreadyActive: bool(
      'True when the grant was idempotent (an active grant already existed).',
      false,
    ),
  },
};

export const AnnouncementSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'title', 'body', 'audience', 'publishedAt', 'createdAt', 'updatedAt'],
  properties: {
    id: str('Announcement id (UUID).', 'e1f2a3b4-bbbb-4bad-9bdd-2b0d7b3dcb6d'),
    title: str('Title.', 'Nghỉ lễ 2/9'),
    body: str('Body (Markdown/plain text).', 'CLB nghỉ các ngày 1-2/9.'),
    audience: enumOf('Audience.', ['ALL', 'CLASS'], 'CLASS'),
    classId: nullableStr(
      'Target class when audience=CLASS; null when club-wide.',
      '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    ),
    className: nullableStr('Class name for CLASS announcements.', 'Cơ bản A1 — Thứ 3/5'),
    publishedAt: dateTimeStr('Publication timestamp (feed ordering).', '2026-09-25T00:00:00.000Z'),
    createdAt: dateTimeStr('Created at.', '2026-09-25T00:00:00.000Z'),
    updatedAt: dateTimeStr('Last update.', '2026-09-25T00:00:00.000Z'),
  },
};

export const LeaveRequestSchema: JsonSchema = {
  type: 'object',
  required: [
    'id',
    'studentId',
    'studentName',
    'classId',
    'className',
    'sessionDate',
    'reason',
    'status',
    'createdAt',
  ],
  properties: {
    id: str('LeaveRequest id (UUID).', 'f2a3b4c5-cccc-4bad-9bdd-2b0d7b3dcb6d'),
    studentId: str('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    studentName: str('Student full name.', 'Võ Văn Thảo'),
    classId: str('Class id.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    className: str('Class name.', 'Cơ bản A1 — Thứ 3/5'),
    sessionDate: dateStr('Session date that will be missed.', '2026-09-29'),
    reason: str('Reason for the absence.', 'School event in the evening'),
    status: enumOf('Workflow status.', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], 'PENDING'),
    reviewNote: nullableStr('Reviewer note.', 'Approved'),
    reviewedAt: nullableDateTime('Review timestamp; null while pending.', null),
    createdAt: dateTimeStr('Created at.', '2026-09-25T00:00:00.000Z'),
  },
};

export const PromotionProposalSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'studentId', 'studentName', 'proposedRank', 'status', 'createdAt'],
  properties: {
    id: str('Proposal id (UUID).', 'a3b4c5d6-dddd-4bad-9bdd-2b0d7b3dcb6d'),
    studentId: str('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    studentName: str('Student full name.', 'Võ Văn Thảo'),
    proposedRank: {
      type: 'object',
      required: ['code', 'name', 'orderIndex'],
      properties: {
        code: str('Proposed rank code.', 'VANG_1'),
        name: str('Proposed rank name.', 'Vai đai vàng đệ nhất'),
        orderIndex: int('Proposed rank order index.', 4),
      },
    },
    note: nullableStr('Proposer note.', 'Consistent training, ready for the exam'),
    status: enumOf('Workflow status.', ['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'),
    reviewNote: nullableStr('Master decision note.', null),
    reviewedAt: nullableDateTime('Review timestamp; null while pending.', null),
    createdAt: dateTimeStr('Created at.', '2026-09-25T00:00:00.000Z'),
  },
};

export const EvaluationSchema: JsonSchema = {
  type: 'object',
  required: [
    'id',
    'studentId',
    'studentName',
    'authorUserId',
    'authorEmail',
    'rating',
    'createdAt',
  ],
  properties: {
    id: str('Evaluation id (UUID).', 'b4c5d6e7-eeee-4bad-9bdd-2b0d7b3dcb6d'),
    studentId: str('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    studentName: str('Student full name.', 'Võ Văn Thảo'),
    authorUserId: str('Author user id.', '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f'),
    authorEmail: str('Author email.', 'hlv.hong@example.com'),
    classId: nullableStr('Optional class context.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    periodMonth: int('Period bucket month; null when the evaluation is not period-bound.', 9),
    periodYear: int('Period bucket year; null when the evaluation is not period-bound.', 2026),
    rating: int('Rating on the club 1..10 scale.', 8),
    comment: nullableStr(
      'Comment shown to the student and their parents.',
      'Strong progress on đòn thế',
    ),
    createdAt: dateTimeStr('Created at.', '2026-09-25T00:00:00.000Z'),
  },
};

export const UserAccountSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'email', 'role', 'emailVerified', 'isActive', 'createdAt'],
  properties: {
    id: str('User id (UUID).', '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f'),
    email: str('Account email.', 'hlv.hong@example.com'),
    role: enumOf('Role.', ['ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT'], 'INSTRUCTOR'),
    emailVerified: bool('Whether the email is verified.', true),
    isActive: bool('Deactivated accounts cannot log in.', true),
    deletedAt: nullableDateTime('Soft-deactivation timestamp; null while active.', null),
    createdAt: dateTimeStr('Created at.', '2026-09-01T00:00:00.000Z'),
  },
};

export const AuditEntrySchema: JsonSchema = {
  type: 'object',
  required: ['id', 'event', 'success', 'createdAt'],
  properties: {
    id: str('AuditLog id (UUID).', 'c5d6e7f8-ffff-4bad-9bdd-2b0d7b3dcb6d'),
    event: str('Event name, e.g. login, user_updated, invoice_created.', 'login'),
    ip: nullableStr('Client IP when recorded.', '203.0.113.7'),
    success: bool('Whether the recorded action succeeded.', true),
    detail: nullableStr('Truncated detail string (≤500 chars).', 'mfa'),
    createdAt: dateTimeStr('Recorded at.', '2026-09-25T00:00:00.000Z'),
  },
};

export const SessionSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'lastActiveAt', 'createdAt'],
  properties: {
    id: str(
      'Session id (UUID); pass to DELETE /auth/sessions/{id}.',
      'd6e7f8a9-0a0a-4bad-9bdd-2b0d7b3dcb6d',
    ),
    ip: nullableStr('Login/last-active IP.', '203.0.113.7'),
    userAgent: nullableStr('Browser user agent.', 'Mozilla/5.0'),
    deviceName: nullableStr('Friendly device label when provided.', 'Pixel 8'),
    lastActiveAt: dateTimeStr('Last activity seen for the session.', '2026-09-25T01:00:00.000Z'),
    createdAt: dateTimeStr('Login time.', '2026-09-24T01:00:00.000Z'),
  },
};

export const PublicUserSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'email', 'role', 'emailVerified', 'mfaEnabled', 'createdAt'],
  properties: {
    id: str('User id (UUID).', '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f'),
    email: str('Account email.', 'thao.vovan@example.com'),
    role: enumOf('Role.', ['ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT'], 'STUDENT'),
    emailVerified: bool('Whether the email is verified.', true),
    mfaEnabled: bool('Whether TOTP MFA is enabled.', false),
    createdAt: dateTimeStr('Account created at.', '2026-09-01T00:00:00.000Z'),
  },
};

export const SessionTokensSchema: JsonSchema = {
  type: 'object',
  required: ['accessToken', 'refreshToken', 'sessionId'],
  properties: {
    accessToken: str(
      'JWT access token; send as `Authorization: Bearer <token>`.',
      'eyJhbGciOiJIUzI1NiIs...',
    ),
    refreshToken: str(
      'Opaque refresh token; rotate via POST /auth/refresh-token.',
      'cJhbGciOiJIUzI1NiIs...',
    ),
    sessionId: str(
      'Session created by this login (manageable under GET /auth/sessions).',
      'd6e7f8a9-0a0a-4bad-9bdd-2b0d7b3dcb6d',
    ),
  },
};

/** Response component schemas registered verbatim into components.schemas. */
export const RESPONSE_COMPONENTS: Record<string, JsonSchema> = {
  StudentProfileResponse: StudentSchema,
  ClassScheduleResponse: ScheduleSchema,
  ClassResponse: ClassSchema,
  EnrollmentResponse: EnrollmentSchema,
  AttendanceSessionResponse: AttendanceSessionSchema,
  AttendanceRecordResponse: AttendanceRecordSchema,
  BeltRankResponse: BeltRankSchema,
  BeltExamResponse: BeltExamSchema,
  InvoiceItemResponse: InvoiceItemSchema,
  InvoiceResponse: InvoiceSchema,
  PaymentResponse: PaymentSchema,
  DiscountCodeResponse: DiscountCodeSchema,
  NotificationResponse: NotificationSchema,
  ConsentResponse: ConsentSchema,
  AnnouncementResponse: AnnouncementSchema,
  LeaveRequestResponse: LeaveRequestSchema,
  PromotionProposalResponse: PromotionProposalSchema,
  EvaluationResponse: EvaluationSchema,
  UserAccountResponse: UserAccountSchema,
  AuditEntryResponse: AuditEntrySchema,
  SessionResponse: SessionSchema,
  PublicUserResponse: PublicUserSchema,
  SessionTokensResponse: SessionTokensSchema,
};
