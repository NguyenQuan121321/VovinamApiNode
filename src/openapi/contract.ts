import type { JsonSchema } from './schema-kit';

/**
 * The per-operation API contract: summary, business description, auth class,
 * response envelope data schema, error catalog, query parameters and request
 * examples for every route.
 *
 * `enrichOpenApiDocument()` applies this table onto the generated OpenAPI
 * document and FAILS when an operation is missing from the table or the table
 * references a route that no longer exists — a route can never ship without a
 * contract entry (both runtime Swagger and scripts/generate-openapi.ts route
 * through it).
 */

export type AuthKind = 'public' | 'bearer' | 'webhook' | 'metrics';

export interface QueryParam {
  name: string;
  description: string;
  required?: boolean;
  schema: JsonSchema;
}

export interface ErrorSpec {
  status: number;
  description: string;
}

export interface OpContract {
  summary: string;
  description: string;
  auth: AuthKind;
  roles?: readonly string[];
  status?: number;
  data?: JsonSchema;
  dataDescription?: string;
  errors?: readonly ErrorSpec[];
  query?: readonly QueryParam[];
  requestExample?: Record<string, unknown>;
}

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });

const page = (items: JsonSchema): JsonSchema => ({
  type: 'object',
  required: ['items', 'total', 'page', 'limit'],
  properties: {
    items: { type: 'array', items },
    total: { type: 'integer', description: 'Total rows across all pages.', example: 42 },
    page: { type: 'integer', description: 'Current 1-based page.', example: 1 },
    limit: { type: 'integer', description: 'Page size applied (capped at 100).', example: 20 },
  },
});

const s = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  description,
  example,
});
const i = (description: string, example: number): JsonSchema => ({
  type: 'integer',
  description,
  example,
});
const b = (description: string, example: boolean): JsonSchema => ({
  type: 'boolean',
  description,
  example,
});
const ns = (description: string, example: unknown): JsonSchema => ({
  type: 'string',
  nullable: true,
  description,
  example,
});
const en = (description: string, values: readonly string[], example: string): JsonSchema => ({
  type: 'string',
  enum: [...values],
  description,
  example,
});
const dt = (description: string, example: string): JsonSchema => ({
  type: 'string',
  format: 'date-time',
  description,
  example,
});
const d = (description: string, example: string): JsonSchema => ({
  type: 'string',
  format: 'date',
  description,
  example,
});
const pageParam = (name: 'page' | 'limit'): QueryParam =>
  name === 'page'
    ? {
        name: 'page',
        description: '1-based page number (default 1).',
        schema: { type: 'integer', minimum: 1, default: 1 },
      }
    : {
        name: 'limit',
        description: 'Page size (default 20, hard cap 100).',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      };

const uuid = (description: string): JsonSchema => ({ type: 'string', format: 'uuid', description });

// ── Error catalog ─────────────────────────────────────────────────────────────

const E400: ErrorSpec = {
  status: 400,
  description:
    'Validation failure: malformed body/query or unknown fields (the global whitelist rejects them).',
};
const E401: ErrorSpec = {
  status: 401,
  description: 'Missing, invalid, expired or revoked bearer token.',
};
const E403: ErrorSpec = {
  status: 403,
  description:
    'Authenticated, but the role does not admit this operation (ADMIN MFA not enrolled also lands here on admin surfaces).',
};
const E404: ErrorSpec = {
  status: 404,
  description:
    'Unknown resource or one owned by someone else — foreign ids answer the same uniform 404 so ids cannot be probed.',
};
const E409: ErrorSpec = {
  status: 409,
  description: 'Business conflict (duplicate, wrong state, capacity, ...).',
};
const E429: ErrorSpec = {
  status: 429,
  description: 'Per-IP rate limit exceeded (global throttle or the stricter auth window).',
};

// ── Shared data schemas ───────────────────────────────────────────────────────

const PublicUser = ref('PublicUserResponse');
const Tokens = ref('SessionTokensResponse');
const auditPage = page(ref('AuditEntryResponse'));

const loginData: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      title: 'MFA required',
      required: ['mfaRequired', 'mfaToken', 'user'],
      properties: {
        mfaRequired: b('A second factor is required before tokens are issued.', true),
        mfaToken: s(
          'Short-lived token; send it with POST /auth/mfa/login-verify.',
          'eyJhbGciOiJIUzI1NiIs...',
        ),
        user: PublicUser,
      },
    },
    {
      type: 'object',
      title: 'Session issued',
      required: ['mfaRequired', 'tokens', 'user'],
      properties: {
        mfaRequired: b('No second factor required.', false),
        tokens: Tokens,
        user: PublicUser,
      },
    },
  ],
};

const mfaMethod: JsonSchema = {
  type: 'object',
  required: ['type', 'enabled'],
  properties: {
    type: s('MFA method identifier.', 'totp'),
    enabled: b('Whether the method is enrolled.', false),
  },
};

const Student = ref('StudentProfileResponse');
const Class = ref('ClassResponse');
const Enrollment = ref('EnrollmentResponse');
const AttendanceSession = ref('AttendanceSessionResponse');
const AttendanceRecord = ref('AttendanceRecordResponse');
const BeltRank = ref('BeltRankResponse');
const BeltExam = ref('BeltExamResponse');
const Invoice = ref('InvoiceResponse');
const Payment = ref('PaymentResponse');
const DiscountCode = ref('DiscountCodeResponse');
const Notification = ref('NotificationResponse');
const Consent = ref('ConsentResponse');
const Announcement = ref('AnnouncementResponse');
const LeaveRequest = ref('LeaveRequestResponse');
const Proposal = ref('PromotionProposalResponse');
const Evaluation = ref('EvaluationResponse');
const UserAccount = ref('UserAccountResponse');

const beltDistribution: JsonSchema = {
  type: 'object',
  required: ['distribution', 'unrankedStudents'],
  properties: {
    distribution: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rankId', 'code', 'name', 'orderIndex', 'students'],
        properties: {
          rankId: i('BeltRank id.', 2),
          code: s('Rank code.', 'VANG_1'),
          name: s('Rank name.', 'Vai đai vàng đệ nhất'),
          orderIndex: i('Rank order index.', 4),
          students: i('Active students currently holding the rank.', 12),
        },
      },
    },
    unrankedStudents: i('Active students without a belt rank yet.', 3),
  },
};

const settingsData: JsonSchema = {
  type: 'object',
  required: ['tuitionRates', 'bankAccount'],
  properties: {
    tuitionRates: {
      type: 'object',
      description: 'Map of classId → monthly tuition in VND (drives the monthly tuition close).',
      additionalProperties: { type: 'integer' },
      example: { '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d': 400000 },
    },
    bankAccount: {
      type: 'object',
      nullable: true,
      description: 'Receiving account for QR payments (null until configured).',
      required: ['bin', 'number', 'name', 'owner_type'],
      properties: {
        bin: s('Bank BIN.', '970422'),
        number: s('Account number.', '9012345678901'),
        name: s('Account holder name.', 'CONG TY TNHH VOVINAM ANH QUAN'),
        owner_type: en(
          'Account owner type; only BUSINESS may collect fees.',
          ['BUSINESS'],
          'BUSINESS',
        ),
      },
    },
  },
};

const revenueData: JsonSchema = {
  type: 'object',
  required: ['from', 'to', 'rows', 'grandTotal'],
  properties: {
    from: dt('Window start.', '2026-09-01T00:00:00.000Z'),
    to: dt('Window end (inclusive).', '2026-09-30T00:00:00.000Z'),
    rows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['month', 'gateway', 'total', 'count'],
        properties: {
          month: s('Month bucket YYYY-MM (UTC).', '2026-09'),
          gateway: en('Settlement channel.', ['BANK_TRANSFER', 'PAYOS', 'SEPAY', 'CASH'], 'CASH'),
          total: i('Revenue total in VND.', 1200000),
          count: i('Successful payments in the bucket.', 3),
        },
      },
    },
    grandTotal: i('Revenue across all rows and gateways (VND).', 1200000),
  },
};

const tuitionReportData: JsonSchema = {
  type: 'object',
  required: ['month', 'year', 'byStatus', 'collectedVnd'],
  properties: {
    month: i('Reported period month.', 9),
    year: i('Reported period year.', 2026),
    byStatus: {
      type: 'array',
      items: {
        type: 'object',
        required: ['status', 'invoices', 'totalVnd'],
        properties: {
          status: en(
            'Invoice status.',
            ['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'],
            'PAID',
          ),
          invoices: i('TUITION invoices in the status.', 24),
          totalVnd: i('Sum of invoice totals in the status (VND).', 9600000),
        },
      },
    },
    collectedVnd: i('Actually settled (SUCCESS payments) for the period (VND).', 9600000),
  },
};

const generateMonthlyData: JsonSchema = {
  type: 'object',
  required: ['month', 'year', 'created', 'skippedExisting', 'classesSkipped'],
  properties: {
    month: i('Closed period month.', 9),
    year: i('Closed period year.', 2026),
    created: i('Invoices created in this run.', 24),
    skippedExisting: i(
      'Student/period pairs skipped because the period invoice already exists (idempotent rerun).',
      0,
    ),
    classesSkipped: {
      type: 'array',
      items: {
        type: 'object',
        required: ['classId', 'reason'],
        properties: {
          classId: s('Class without a configured rate.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
          reason: s('Why the class was skipped.', 'no tuition rate configured'),
        },
      },
    },
    dueDate: dt(
      'Due date stamped on the created invoices (10th of the period).',
      '2026-09-10T00:00:00.000Z',
    ),
  },
};

const attendanceSummaryData: JsonSchema = {
  type: 'object',
  required: ['studentId', 'month', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'total'],
  properties: {
    studentId: s('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    month: s('Month bucket YYYY-MM.', '2026-09'),
    PRESENT: i('Present count.', 7),
    LATE: i('Late count (counts as attended).', 1),
    ABSENT: i('Unexcused absence count.', 1),
    EXCUSED: i('Excused absence count.', 2),
    total: i('All records in the month.', 11),
  },
};

const attendanceReportRow: JsonSchema = {
  type: 'object',
  required: ['classId', 'className', 'sessionsHeld', 'markedRecords'],
  properties: {
    classId: s('Class id.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    className: s('Class name.', 'Cơ bản A1 — Thứ 3/5'),
    sessionsHeld: i('Sessions held in the month.', 8),
    PRESENT: i('Present records.', 160),
    LATE: i('Late records.', 12),
    ABSENT: i('Unexcused absences.', 20),
    EXCUSED: i('Excused absences.', 8),
    markedRecords: i('Total marked records.', 200),
    attendanceRate: {
      type: 'number',
      nullable: true,
      description: '(present + late) / marked × 100, rounded to 0.1; null when nothing was marked.',
      example: 86.0,
    },
  },
};

const attendanceHistoryItem: JsonSchema = {
  type: 'object',
  required: ['sessionId', 'sessionDate', 'classId', 'className', 'status'],
  properties: {
    sessionId: s('Attendance session id.', 'b2c3d4e5-3333-4bad-9bdd-2b0d7b3dcb6d'),
    sessionDate: d('Session date.', '2026-09-22'),
    classId: s('Class id.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
    className: s('Class name.', 'Cơ bản A1 — Thứ 3/5'),
    status: en('Attendance status.', ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'], 'PRESENT'),
    note: ns('Optional note.', null),
  },
};

const examRegistrationData: JsonSchema = {
  type: 'object',
  required: ['id', 'examId', 'studentId', 'status', 'invoice'],
  properties: {
    id: s('ExamRegistration id (UUID).', 'a7b8c9d0-7777-4bad-9bdd-2b0d7b3dcb6d'),
    examId: s('Exam id.', 'd4e5f6a7-5555-4bad-9bdd-2b0d7b3dcb6d'),
    studentId: s('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
    status: en(
      'Registration status; PENDING until a result is recorded.',
      ['PENDING', 'RESULT_PASS', 'RESULT_FAIL', 'CANCELLED'],
      'PENDING',
    ),
    currentRankId: i('Rank the student held at registration time.', 1),
    targetRankId: i('Rank the exam promotes to.', 2),
    invoice: {
      type: 'object',
      description: 'The EXAM_FEE invoice issued atomically with the registration.',
      required: ['id', 'invoiceNo', 'total', 'status'],
      properties: {
        id: s('Invoice id.', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'),
        invoiceNo: s('Invoice number.', 'INV-2026-0007'),
        total: i('Fee amount (VND).', 150000),
        status: en(
          'Invoice status.',
          ['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'],
          'UNPAID',
        ),
      },
    },
  },
};

const examHistoryItem: JsonSchema = {
  type: 'object',
  required: ['id', 'exam', 'status', 'targetRank'],
  properties: {
    id: s('ExamRegistration id.', 'a7b8c9d0-7777-4bad-9bdd-2b0d7b3dcb6d'),
    exam: {
      type: 'object',
      required: ['id', 'code', 'title', 'examDate'],
      properties: {
        id: s('Exam id.', 'd4e5f6a7-5555-4bad-9bdd-2b0d7b3dcb6d'),
        code: s('Exam code.', 'EXAM-2026-03'),
        title: s('Exam title.', 'Kỳ thi thăng đai vàng — tháng 3'),
        examDate: d('Exam date.', '2026-03-28'),
      },
    },
    status: en(
      'Registration status.',
      ['PENDING', 'RESULT_PASS', 'RESULT_FAIL', 'CANCELLED'],
      'RESULT_PASS',
    ),
    rankAtRegistration: {
      type: 'object',
      nullable: true,
      description: 'Rank held at registration.',
      required: ['code', 'name', 'orderIndex'],
      properties: {
        code: s('Rank code.', 'LAM_3'),
        name: s('Rank name.', 'Vai đai lam đệ tam'),
        orderIndex: i('Order index.', 3),
      },
    },
    targetRank: {
      type: 'object',
      description: 'Rank the exam targeted.',
      required: ['code', 'name', 'orderIndex'],
      properties: {
        code: s('Rank code.', 'VANG_1'),
        name: s('Rank name.', 'Vai đai vàng đệ nhất'),
        orderIndex: i('Order index.', 4),
      },
    },
    resultNote: ns('Examiner note.', 'Good spirit'),
    resultRecordedAt: dt(
      'When the result was recorded (registration row update time).',
      '2026-03-28T02:00:00.000Z',
    ),
  },
};

/** Tag descriptions surfaced in Swagger UI. */
export const TAG_DESCRIPTIONS: Record<string, string> = {
  Auth: 'Registration, login, MFA, sessions and account lifecycle.',
  AdminUsers: 'ADMIN backoffice over user accounts and the system-wide audit log.',
  Students: 'Student profiles: directory, self-service, invite codes and soft deletion.',
  Parents: 'Parent linking via single-use invite codes and child visibility.',
  Classes: 'Classes and their weekly schedules.',
  Enrollments: 'Class enrollment management (capacity, duplicate and rejoin rules).',
  Attendance: 'Attendance sessions, bulk record upserts, history, summaries and reports.',
  Belts: 'Belt rank catalog and distribution report.',
  Exams: 'Belt exams: lifecycle, registration with automatic fee invoice, results and promotion.',
  Billing: 'Invoices, monthly tuition close, revenue/tuition reports, settings and discount codes.',
  Payments: 'QR payment initiation, the gateway webhook and admin cash/refund operations.',
  Notifications: 'In-app notification feed and outbox diagnostics.',
  Consent: 'Purpose-specific consent records with parent proxy for minors.',
  Announcements: 'Club/class announcements with audience-scoped visibility.',
  Leaves: 'Absence (leave) requests with instructor review.',
  Promotions: 'Promotion proposals: advisory only, never moves the belt itself.',
  Evaluations: 'Instructor evaluations of students (1..10 rating per period).',
  Health: 'Liveness/readiness probes and Prometheus metrics.',
};

/** The full contract: "METHOD path" → operation metadata. */
export const CONTRACT: Record<string, OpContract> = {
  // ── Health ────────────────────────────────────────────────────────────────
  'GET /healthz': {
    summary: 'Liveness probe',
    description:
      'Answers 200 while the process is up. Never touches the database, so it stays green even during a database outage.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['status'],
      properties: { status: s('Constant ok.', 'ok') },
    },
  },
  'GET /readyz': {
    summary: 'Readiness probe',
    description:
      'Answers 200 only when the database answers a `SELECT 1`; 503 (uniform envelope) otherwise. Deploy orchestrations should gate traffic on it.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['status', 'database'],
      properties: { status: s('Constant ok.', 'ok'), database: s('Database reachability.', 'up') },
    },
    errors: [{ status: 503, description: 'The database does not answer.' }],
  },
  'GET /metrics': {
    summary: 'Prometheus metrics',
    description:
      'Prometheus text exposition of process/HTTP metrics. Requires the METRICS_TOKEN bearer token; returns 404 when no token is configured. Raw text/plain — NOT wrapped in the JSON envelope.',
    auth: 'metrics',
    dataDescription: 'Prometheus text exposition (text/plain; version=0.0.4).',
    errors: [
      { status: 401, description: 'Missing or wrong metrics bearer token.' },
      { status: 404, description: 'No metrics token is configured on the server.' },
    ],
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'POST /api/v1/auth/register': {
    summary: 'Register a STUDENT or PARENT account',
    description:
      'Creates an unverified account and emails a verification token (valid 24h). STUDENT accounts also need a club-created student profile (via invite-code linking or admin creation) before profile data appears. The response is identical for new and already-registered emails (anti-enumeration) — an existing address receives a "you already registered" mail instead. Password policy: 8+ chars, letters and digits, must not contain the email.',
    auth: 'public',
    status: 201,
    data: {
      type: 'object',
      required: ['email', 'requiresVerification'],
      properties: {
        email: s('Email the verification mail was sent to.', 'thao.vovan@example.com'),
        requiresVerification: b('Always true: the account is unusable until verified.', true),
      },
    },
    errors: [E400, E429],
    requestExample: {
      email: 'thao.vovan@example.com',
      password: 'VoSinh2026!x',
      role: 'STUDENT',
      fullName: 'Võ Văn Thảo',
      dateOfBirth: '2008-05-14',
      phone: '+84901234567',
    },
  },
  'POST /api/v1/auth/login': {
    summary: 'Log in (password, optional MFA)',
    description:
      'Verifies credentials and issues a session (access + refresh token). When TOTP MFA is enrolled the response instead carries a short-lived mfaToken — complete login via POST /auth/mfa/login-verify. Every failure (unknown email, wrong password, locked, deactivated, unverified) answers the same 401 message. Per-account lockout after repeated failures; strict per-IP throttle on the whole auth surface.',
    auth: 'public',
    data: loginData,
    errors: [E400, E401, E429],
    requestExample: { email: 'thao.vovan@example.com', password: 'VoSinh2026!x' },
  },
  'POST /api/v1/auth/refresh-token': {
    summary: 'Rotate the refresh token',
    description:
      'Exchanges a valid refresh token for a new session pair; the presented token is consumed (rotation). Reusing an already-consumed token is treated as theft: every session of the user is revoked and security mail is sent.',
    auth: 'public',
    data: Tokens,
    errors: [E400, E401, E429],
    requestExample: { refreshToken: 'EXAMPLE_REFRESH_TOKEN_NOT_A_SECRET' },
  },
  'POST /api/v1/auth/verify-email': {
    summary: 'Verify the email address',
    description:
      'Consumes the single-use token from the verification mail (24h TTL) and marks the address verified. Verified accounts can log in.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['emailVerified'],
      properties: { emailVerified: b('Constant true after a successful verification.', true) },
    },
    errors: [E400, E401, E429],
    requestExample: { token: '8f1c...a9' },
  },
  'POST /api/v1/auth/resend-verification': {
    summary: 'Resend the verification email',
    description:
      'Sends the verification mail again. Always answers the same body whether or not the address exists (anti-enumeration); per-account mail budget limits abuse.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['sent'],
      properties: { sent: b('Constant true.', true) },
    },
    errors: [E400, E429],
    requestExample: { email: 'thao.vovan@example.com' },
  },
  'POST /api/v1/auth/forgot-password': {
    summary: 'Request a password reset',
    description:
      'Emails a reset token (15 min TTL). Always answers the same body regardless of account existence (anti-enumeration); per-account mail budget limits abuse.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['sent'],
      properties: { sent: b('Constant true.', true) },
    },
    errors: [E400, E429],
    requestExample: { email: 'thao.vovan@example.com' },
  },
  'POST /api/v1/auth/reset-password': {
    summary: 'Reset the password with the emailed token',
    description:
      'Consumes the single-use reset token and replaces the password. All existing sessions and refresh tokens are revoked.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['reset'],
      properties: { reset: b('Constant true.', true) },
    },
    errors: [E400, E401, E429],
    requestExample: { token: '3b7e...c1', password: 'VoSinh2026!y' },
  },
  'POST /api/v1/auth/logout': {
    summary: 'Log out the current device',
    description:
      'Revokes the presented session: refresh tokens die immediately, the access token is denylisted until it expires.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['loggedOut'],
      properties: { loggedOut: b('Constant true.', true) },
    },
    errors: [E401, E429],
  },
  'POST /api/v1/auth/logout-all': {
    summary: 'Log out every device',
    description:
      'Revokes all sessions and refresh tokens of the account and bumps the token version so every outstanding access token dies.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['loggedOut'],
      properties: { loggedOut: b('Constant true.', true) },
    },
    errors: [E401, E429],
  },
  'GET /api/v1/auth/sessions': {
    summary: 'List active sessions',
    description:
      'The account’s currently active (non-revoked, unexpired) sessions, newest activity first — the "logged in devices" screen.',
    auth: 'bearer',
    data: { type: 'array', items: ref('SessionResponse') },
    errors: [E401],
  },
  'DELETE /api/v1/auth/sessions/{id}': {
    summary: 'Revoke one session',
    description:
      'Revokes one of the caller’s own sessions (e.g. a lost device). Foreign or unknown session ids answer 401.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['revoked'],
      properties: { revoked: b('Constant true.', true) },
    },
    errors: [E400, E401, E429],
  },
  'GET /api/v1/auth/me': {
    summary: 'Current account',
    description:
      'The authenticated account’s id, email, role, verification and MFA status — the "who am I" call for session bootstrap.',
    auth: 'bearer',
    data: PublicUser,
    errors: [E401],
  },
  'GET /api/v1/auth/me/audit-log': {
    summary: 'Own security audit log',
    description:
      'Paginated security events of the calling account (logins, password changes, MFA, token reuse, ...), newest first — the "recent activity" screen.',
    auth: 'bearer',
    data: auditPage,
    query: [pageParam('page'), pageParam('limit')],
    errors: [E401],
  },
  'POST /api/v1/auth/change-password': {
    summary: 'Change own password',
    description:
      'Re-authenticates with the current password (plus TOTP code when MFA is on), applies the password policy, revokes all sessions and bumps the token version.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['changed'],
      properties: { changed: b('Constant true.', true) },
    },
    errors: [E400, E401, E429],
    requestExample: {
      currentPassword: 'VoSinh2026!x',
      newPassword: 'VoSinh2026!z',
      code: '492031',
    },
  },
  'POST /api/v1/auth/change-email/request': {
    summary: 'Request an email change',
    description:
      'Re-authenticates with the current password and emails a confirmation token (24h TTL) to the NEW address. The address is not changed until POST /auth/change-email/confirm consumes it.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['sent'],
      properties: { sent: b('Constant true.', true) },
    },
    errors: [E400, E401, E409, E429],
    requestExample: { currentPassword: 'VoSinh2026!z', newEmail: 'thao.vovan+new@example.com' },
  },
  'POST /api/v1/auth/change-email/confirm': {
    summary: 'Confirm the email change',
    description:
      'Consumes the emailed token and switches the account email. Single-use; conflicting tokens fail with the uniform invalid-token error.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['changed'],
      properties: { changed: b('Constant true.', true) },
    },
    errors: [E400, E401, E409, E429],
    requestExample: { token: '55ac...77' },
  },
  'POST /api/v1/auth/deactivate': {
    summary: 'Deactivate own account',
    description:
      'Re-authenticates (password + TOTP when enrolled), soft-deletes the account, revokes all sessions and blocks future logins. Financial history is retained (soft deletion).',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['deactivated'],
      properties: { deactivated: b('Constant true.', true) },
    },
    errors: [E400, E401, E429],
    requestExample: { password: 'VoSinh2026!z', code: '492031' },
  },
  'DELETE /api/v1/auth/me': {
    summary: 'Delete own account (alias of deactivate)',
    description:
      'REST-delete alias of POST /auth/deactivate with identical semantics and body, so clients can use the idiomatic verb.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['deactivated'],
      properties: { deactivated: b('Constant true.', true) },
    },
    errors: [E400, E401, E429],
    requestExample: { password: 'VoSinh2026!z' },
  },
  'POST /api/v1/auth/mfa/login-verify': {
    summary: 'Complete MFA login',
    description:
      'Exchanges the mfaToken from POST /auth/login (mfaRequired=true) plus a TOTP code (or an 8-char recovery code) for a full session. Failure budget: 5 wrong codes per 5 minutes lock the second factor out temporarily.',
    auth: 'public',
    data: {
      type: 'object',
      required: ['mfaRequired', 'tokens', 'user'],
      properties: {
        mfaRequired: b('Constant false: tokens are issued in the same response.', false),
        tokens: Tokens,
        user: PublicUser,
      },
    },
    errors: [E400, E401, E429],
    requestExample: { mfaToken: 'EXAMPLE_MFA_TOKEN_NOT_A_SECRET', code: '492031' },
  },
  'GET /api/v1/auth/mfa/methods': {
    summary: 'List enrolled MFA methods',
    description:
      'Which second factors are enrolled on the account (currently only TOTP). Used to render account-security UI.',
    auth: 'bearer',
    data: { type: 'array', items: mfaMethod },
    errors: [E401],
  },
  'POST /api/v1/auth/mfa/totp/enable': {
    summary: 'Start TOTP enrollment',
    description:
      'Generates a TOTP secret (stored sealed) and returns the otpauth URL plus a QR data URL for the authenticator app. Enrollment is only ACTIVE after POST /auth/mfa/totp/verify succeeds; until then login does not require MFA.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['otpauthUrl', 'qrDataUrl'],
      properties: {
        otpauthUrl: s(
          'otpauth:// URL to encode.',
          'otpauth://totp/VovinamApiNode:thao.vovan%40example.com?secret=...',
        ),
        qrDataUrl: s('PNG data URL of the QR code to scan.', 'data:image/png;base64,...'),
      },
    },
    errors: [E401],
  },
  'POST /api/v1/auth/mfa/totp/verify': {
    summary: 'Confirm TOTP enrollment',
    description:
      'Confirms the pending enrollment with the first valid code. On success returns the ONE-TIME recovery codes (shown exactly once, store them) and MFA becomes mandatory for this account’s logins.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['recoveryCodes'],
      properties: {
        recoveryCodes: {
          type: 'array',
          description: 'Single-use 8-character recovery codes; only hashes are stored.',
          items: { type: 'string', example: 'K7M2PQ4X' },
        },
      },
    },
    errors: [E400, E401],
    requestExample: { code: '492031' },
  },
  'POST /api/v1/auth/mfa/totp/validate': {
    summary: 'Validate a TOTP code',
    description:
      'Inline second-factor confirmation for sensitive screens (step-up). Shares the failure budget with all other TOTP surfaces (5 fails / 5 minutes).',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['valid'],
      properties: { valid: b('Constant true; failures answer 401.', true) },
    },
    errors: [E400, E401],
    requestExample: { code: '492031' },
  },
  'POST /api/v1/auth/mfa/totp/disable': {
    summary: 'Disable TOTP MFA',
    description:
      'Re-authenticates with password + current TOTP code, removes the enrollment and revokes all sessions.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['disabled'],
      properties: { disabled: b('Constant true.', true) },
    },
    errors: [E400, E401],
    requestExample: { code: '492031', password: 'VoSinh2026!z' },
  },
  'GET /api/v1/auth/mfa/totp/recovery-codes': {
    summary: 'Recovery codes remaining',
    description:
      'How many single-use recovery codes are still unused — the "codes left" indicator.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['remaining'],
      properties: { remaining: i('Unused recovery codes left.', 7) },
    },
    errors: [E401],
  },

  // ── Admin users ───────────────────────────────────────────────────────────
  'GET /api/v1/users': {
    summary: 'List user accounts (ADMIN)',
    description:
      'Paginated account directory, newest first, with role filter and case-insensitive email search. Never includes credential material.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: page(UserAccount),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'role',
        description: 'Filter by role.',
        schema: en('Role.', ['ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT'], 'STUDENT'),
      },
      {
        name: 'search',
        description: 'Case-insensitive substring match on the email.',
        schema: s('Search substring.', '@example.com'),
      },
    ],
    errors: [E401, E403],
  },
  'POST /api/v1/users': {
    summary: 'Create a user account (ADMIN)',
    description:
      'Creates a verified account of any role — the supported path for INSTRUCTOR/ADMIN staff accounts. The initial password must satisfy the policy and is handed to the user out of band. Duplicate emails answer 409.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: UserAccount,
    errors: [E400, E401, E403, E409],
    requestExample: {
      email: 'hlv.hong@example.com',
      password: 'VoSinh2026!a',
      role: 'INSTRUCTOR',
      fullName: 'Nguyễn Thị Hồng',
    },
  },
  'PATCH /api/v1/users/{id}': {
    summary: 'Update a user account (ADMIN)',
    description:
      'Changes role, activation or password. Any trust-affecting change (role change, deactivation, new password) revokes all sessions and refresh tokens immediately. Admins cannot change their own role or deactivate themselves.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: UserAccount,
    errors: [E400, E401, E403, E404],
    requestExample: { role: 'INSTRUCTOR', isActive: true },
  },
  'DELETE /api/v1/users/{id}': {
    summary: 'Deactivate a user account (ADMIN)',
    description:
      'Soft-deletes the account (deletedAt + isActive=false) and revokes all sessions. Self-deactivation is refused (400). Invoices and other history are retained.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['id', 'deactivated'],
      properties: {
        id: s('Deactivated user id.', '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f'),
        deactivated: b('Constant true.', true),
      },
    },
    errors: [E400, E401, E403, E404],
  },
  'GET /api/v1/admin/audit-log': {
    summary: 'System-wide audit log (ADMIN)',
    description:
      'Paginated audit trail of every recorded event (auth, billing, admin actions, ...), filterable by acting user and event name, newest first.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: auditPage,
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'userId',
        description: 'Filter by acting user id (UUID).',
        schema: uuid('Acting user id.'),
      },
      {
        name: 'event',
        description: 'Filter by event name, e.g. login, user_updated.',
        schema: s('Event name.', 'login'),
      },
    ],
    errors: [E401, E403],
  },

  // ── Students ──────────────────────────────────────────────────────────────
  'GET /api/v1/students/me': {
    summary: 'Own student profile (STUDENT)',
    description:
      'The profile linked to the calling STUDENT account (contact fields included). 404 until the club has created/approved the profile.',
    auth: 'bearer',
    roles: ['STUDENT'],
    data: Student,
    errors: [E401, E403, E404],
  },
  'PATCH /api/v1/students/me': {
    summary: 'Edit own contact details (STUDENT)',
    description:
      'Self-service edit of contact fields only (phone, address, emergency contact, medical notes). Identity fields (name, dob, gender), belt and status stay admin-managed.',
    auth: 'bearer',
    roles: ['STUDENT'],
    data: Student,
    errors: [E400, E401, E403, E404],
    requestExample: { phone: '+84901234567', address: '12 Nguyễn Trãi, Q.1, TP.HCM' },
  },
  'GET /api/v1/students': {
    summary: 'List student profiles',
    description:
      'ADMIN sees the whole non-deleted directory; INSTRUCTOR sees only students currently enrolled in their own classes (a foreign classId filter yields an empty list, never an error). Fields: instructors receive identity/belt/medical only; admin receives contacts as well.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: page(Student),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'status',
        description: 'Filter by lifecycle status.',
        schema: en('Lifecycle status.', ['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'], 'ACTIVE'),
      },
      {
        name: 'search',
        description: 'Substring match on the full name (min 2 chars).',
        schema: s('Name substring.', 'Thảo'),
      },
      {
        name: 'classId',
        description: 'Limit to students currently enrolled in this class.',
        schema: uuid('Class id.'),
      },
    ],
    errors: [E401, E403],
  },
  'POST /api/v1/students': {
    summary: 'Create a student profile (ADMIN)',
    description:
      'Creates the profile (ACTIVE) and its first single-use parent invite code. `linkedUserEmail` attaches the profile to an existing verified STUDENT account. The invite code is returned exactly once here — hand it to the parent.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: Student,
    dataDescription:
      'The created profile plus the one-time inviteCode field. Subsequent reads never include the code.',
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      fullName: 'Võ Văn Thảo',
      dob: '2008-05-14',
      gender: 'MALE',
      phone: '+84901234567',
      medicalNotes: 'Mild asthma; inhaler in gym bag',
    },
  },
  'GET /api/v1/students/{id}': {
    summary: 'Student profile detail',
    description:
      'Role-scoped through the ownership guard: STUDENT sees their own profile, PARENT verified-linked children, INSTRUCTOR students currently enrolled in classes they teach (contacts hidden), ADMIN everyone. Foreign/unknown ids answer the uniform 404.',
    auth: 'bearer',
    data: Student,
    errors: [E400, E401, E404],
  },
  'PATCH /api/v1/students/{id}': {
    summary: 'Update a student profile (ADMIN)',
    description:
      'Full-field admin edit: identity, contacts, medical notes, belt rank and lifecycle status (e.g. approving a PENDING profile to ACTIVE).',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: Student,
    errors: [E400, E401, E403, E404],
    requestExample: { status: 'ACTIVE', currentBeltRankId: 1 },
  },
  'DELETE /api/v1/students/{id}': {
    summary: 'Soft-delete a student profile (ADMIN)',
    description:
      'Marks the profile deleted and deactivates the linked account. Invoices and attendance history are retained (financial integrity); the profile disappears from every directory query. Idempotent-per-state: repeating answers 404.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['deleted'],
      properties: { deleted: b('Constant true.', true) },
    },
    errors: [E400, E401, E403, E404],
  },
  'POST /api/v1/students/{id}/invite-code': {
    summary: 'Regenerate the parent invite code (ADMIN)',
    description:
      'Replaces the single-use invite code. The old code stops working immediately (e.g. a code leaked or mistyped too often). Returns the new code — hand it to the parent.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['inviteCode'],
      properties: { inviteCode: s('Fresh single-use 8-character code.', 'K7M2PQ4X') },
    },
    errors: [E400, E401, E403, E404],
  },

  // ── Parents ───────────────────────────────────────────────────────────────
  'POST /api/v1/parents/link': {
    summary: 'Link a child by invite code (PARENT)',
    description:
      'Claims the single-use invite code and creates a VERIFIED parent-student link. The code is rotated away in the same transaction, so of two parents racing the same code exactly one wins (the loser sees the uniform 404). Linking the same child twice answers 409.',
    auth: 'bearer',
    roles: ['PARENT'],
    status: 201,
    data: Student,
    errors: [E400, E401, E403, E404, E409, E429],
    requestExample: { inviteCode: 'K7M2PQ4X' },
  },
  'GET /api/v1/parents/me/children': {
    summary: 'List linked children (PARENT)',
    description:
      'The verified-linked, non-deleted student profiles of the calling parent — the family screen.',
    auth: 'bearer',
    roles: ['PARENT'],
    data: { type: 'array', items: Student },
    errors: [E401, E403],
  },
  'DELETE /api/v1/parents/links/{studentId}': {
    summary: 'Unlink a child (PARENT)',
    description:
      'Removes a link. Verified links (created via invite code) can only be removed by the club — a self-unlink attempt answers 409 by design. Access to the child’s data ends immediately after an unlink.',
    auth: 'bearer',
    roles: ['PARENT'],
    data: {
      type: 'object',
      required: ['unlinked'],
      properties: { unlinked: b('Constant true.', true) },
    },
    errors: [E400, E401, E403, E404, E409],
  },

  // ── Classes ───────────────────────────────────────────────────────────────
  'GET /api/v1/classes': {
    summary: 'List classes',
    description:
      'Paginated class catalog with weekly schedules; every authenticated role can read it (students need it to see what to attend). Filter by lifecycle status.',
    auth: 'bearer',
    data: page(Class),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'status',
        description: 'Filter by lifecycle status.',
        schema: en('Lifecycle status.', ['ACTIVE', 'PAUSED', 'ARCHIVED'], 'ACTIVE'),
      },
    ],
    errors: [E401],
  },
  'GET /api/v1/classes/{id}': {
    summary: 'Class detail',
    description:
      'One class with schedules and the current number of active enrollments (the "how full is it" field).',
    auth: 'bearer',
    data: Class,
    dataDescription: 'Class with `activeEnrollmentCount` present.',
    errors: [E400, E401, E404],
  },
  'POST /api/v1/classes': {
    summary: 'Create a class (ADMIN)',
    description:
      'Creates a class taught by an active INSTRUCTOR-role user; assigning anyone else answers 404/400.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: Class,
    errors: [E400, E401, E403, E404],
    requestExample: {
      name: 'Cơ bản A1 — Thứ 3/5',
      instructorId: '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
      location: 'Sân A — CLB Q.1',
      capacity: 30,
    },
  },
  'PATCH /api/v1/classes/{id}': {
    summary: 'Update a class (ADMIN)',
    description:
      'Renames, moves, re-staffs, resizes or pauses/archives a class. Capacity cannot drop below the current active enrollments (409). PAUSED/ARCHIVED classes accept no new sessions or enrollments; history stays readable.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: Class,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { capacity: 35 },
  },
  'POST /api/v1/classes/{id}/schedules': {
    summary: 'Add a weekly schedule slot (ADMIN)',
    description:
      'Adds a recurring slot (weekday + HH:MM window + validity range). Start must be before end; the effective range must be ordered.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: {
      type: 'object',
      required: ['id', 'classId'],
      properties: {
        id: s('Schedule id (UUID).', 'd1b2c3d4-1111-4bad-9bdd-2b0d7b3dcb6d'),
        classId: s('Class id.', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'),
      },
    },
    errors: [E400, E401, E403, E404],
    requestExample: {
      weekday: 2,
      startTime: '18:00',
      endTime: '19:30',
      effectiveFrom: '2026-09-01',
    },
  },
  'DELETE /api/v1/classes/{id}/schedules/{scheduleId}': {
    summary: 'Remove a schedule slot (ADMIN)',
    description:
      'Deletes one schedule slot of the class. Foreign/unknown slot ids answer the uniform 404.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['removed'],
      properties: { removed: b('Constant true.', true) },
    },
    errors: [E400, E401, E403, E404],
  },

  // ── Enrollments ───────────────────────────────────────────────────────────
  'POST /api/v1/enrollments': {
    summary: 'Enroll a student (ADMIN)',
    description:
      'Enrolls an ACTIVE student into an ACTIVE class. Serialized per class (row lock), so concurrent enrollments cannot overbook capacity. Rules enforced: no duplicate open enrollment, one enrollment per (student, class, day) — rejoining is allowed on a later day, class capacity must have room. Each violation answers a distinct 409.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: Enrollment,
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
      classId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    },
  },
  'GET /api/v1/enrollments': {
    summary: 'List enrollments (ADMIN)',
    description:
      'Paginated enrollment ledger (newest first), filterable by class and/or student. Includes past (left) enrollments for history screens.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: page(Enrollment),
    query: [
      pageParam('page'),
      pageParam('limit'),
      { name: 'classId', description: 'Filter by class.', schema: uuid('Class id.') },
      { name: 'studentId', description: 'Filter by student.', schema: uuid('StudentProfile id.') },
    ],
    errors: [E401, E403],
  },
  'DELETE /api/v1/enrollments/{id}': {
    summary: 'Remove an enrollment (ADMIN)',
    description:
      'Soft leave: sets leftAt so attendance history, reports and the FK chain survive. Re-enrollment later is a new row.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['left'],
      properties: { left: b('Constant true.', true) },
    },
    errors: [E400, E401, E403, E404],
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  'POST /api/v1/attendance-sessions': {
    summary: 'Create an attendance session',
    description:
      'Opens a session for one class date. ADMIN for any class; INSTRUCTOR only for classes they teach (foreign class → 404) and the teacher of record defaults to the class instructor. One session per class per date (409 on duplicate); PAUSED/ARCHIVED classes refuse new sessions (409).',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    status: 201,
    data: AttendanceSession,
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      classId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      sessionDate: '2026-09-22',
      topic: 'Đòn thế số 5-6, phản đòn',
    },
  },
  'POST /api/v1/attendance-sessions/{id}/records': {
    summary: 'Bulk-upsert attendance records',
    description:
      'Creates or overwrites the record of every listed student in one atomic batch (upsert keyed by session+student). Every student must be currently enrolled in the session class and appear at most once; sessions of foreign classes answer 404. Corrections after the fact simply resend the affected students.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: { type: 'array', items: AttendanceRecord },
    errors: [E400, E401, E403, E404],
    requestExample: {
      records: [
        { studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01', status: 'PRESENT' },
        {
          studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a02',
          status: 'LATE',
          note: 'Came 10 min late',
        },
      ],
    },
  },
  'GET /api/v1/attendance-sessions/{id}/records': {
    summary: 'List records of a session',
    description:
      'All marked students of one session (student names included). ADMIN anywhere; INSTRUCTOR only their own classes (foreign session → 404).',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: {
      type: 'object',
      required: ['items', 'total'],
      properties: {
        items: { type: 'array', items: AttendanceRecord },
        total: { type: 'integer', description: 'Number of records.', example: 24 },
      },
    },
    errors: [E400, E401, E403, E404],
  },
  'GET /api/v1/students/{id}/attendance': {
    summary: 'Attendance history of a student',
    description:
      'Paginated attendance records (newest session first) with class names. Scoped by the ownership guard: own (STUDENT), linked children (PARENT), currently taught students (INSTRUCTOR), all (ADMIN); optional date window.',
    auth: 'bearer',
    data: page(attendanceHistoryItem),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'from',
        description: 'Only sessions on/after this date (ISO).',
        schema: d('From date.', '2026-09-01'),
      },
      {
        name: 'to',
        description: 'Only sessions on/before this date (ISO).',
        schema: d('To date.', '2026-09-30'),
      },
    ],
    errors: [E400, E401, E404],
  },
  'GET /api/v1/attendance/summary': {
    summary: 'Monthly attendance summary of a student',
    description:
      'PRESENT/LATE/ABSENT/EXCUSED counts for one student and month bucket, ownership-guard scoped.',
    auth: 'bearer',
    data: attendanceSummaryData,
    query: [
      {
        name: 'studentId',
        description: 'StudentProfile to summarize.',
        required: true,
        schema: uuid('StudentProfile id.'),
      },
      {
        name: 'month',
        description: 'Month bucket YYYY-MM.',
        required: true,
        schema: s('Month bucket.', '2026-09'),
      },
    ],
    errors: [E400, E401, E404],
  },
  'GET /api/v1/admin/reports/attendance': {
    summary: 'Monthly attendance report',
    description:
      'Per-class session counts and status totals for one month. ADMIN sees the whole club; INSTRUCTOR only classes they teach (archived classes excluded). Empty result when nothing was held.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: { type: 'array', items: attendanceReportRow },
    query: [
      {
        name: 'month',
        description: 'Month bucket YYYY-MM.',
        required: true,
        schema: s('Month bucket.', '2026-09'),
      },
    ],
    errors: [E400, E401, E403],
  },

  // ── Belts ─────────────────────────────────────────────────────────────────
  'GET /api/v1/belt-ranks': {
    summary: 'List belt ranks',
    description:
      'The rank catalog ordered by orderIndex (the promotion ladder). Readable by every authenticated role.',
    auth: 'bearer',
    data: { type: 'array', items: BeltRank },
    errors: [E401],
  },
  'POST /api/v1/belt-ranks': {
    summary: 'Create a belt rank (ADMIN)',
    description:
      'Adds a rung to the ladder. code and orderIndex are unique (distinct 409 messages tell which one collided).',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: {
      type: 'object',
      required: ['id', 'code', 'name'],
      properties: {
        id: i('New BeltRank id.', 9),
        code: s('Rank code.', 'VANG_3'),
        name: s('Rank name.', 'Vai đai vàng đệ tam'),
      },
    },
    errors: [E400, E401, E403, E409],
    requestExample: {
      code: 'VANG_3',
      name: 'Vai đai vàng đệ tam',
      rankGroup: 'VANG',
      orderIndex: 6,
    },
  },
  'PATCH /api/v1/belt-ranks/{id}': {
    summary: 'Update a belt rank (ADMIN)',
    description:
      'Renames/reorders/deactivates a rank. Deactivated ranks can no longer be exam or proposal targets. id is the integer BeltRank id.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['id', 'code', 'name'],
      properties: {
        id: i('BeltRank id.', 9),
        code: s('Rank code.', 'VANG_3'),
        name: s('Rank name.', 'Vai đai vàng đệ tam'),
      },
    },
    errors: [E400, E401, E403, E404, E409],
    requestExample: { name: 'Vai đai vàng đệ tam (hiệu chỉnh)' },
  },
  'GET /api/v1/admin/reports/belts': {
    summary: 'Belt distribution report',
    description:
      'Active students grouped by current rank plus the unranked count. ADMIN sees the club; INSTRUCTOR only students currently enrolled in classes they teach.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: beltDistribution,
    errors: [E401, E403],
  },

  // ── Exams ─────────────────────────────────────────────────────────────────
  'GET /api/v1/belt-exams': {
    summary: 'List belt exams',
    description:
      'Paginated exam catalog (soonest first) with target rank and fee — students browse it to register. Filter by lifecycle status.',
    auth: 'bearer',
    data: page(BeltExam),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'status',
        description: 'Filter by lifecycle status.',
        schema: en('Exam status.', ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'], 'OPEN'),
      },
    ],
    errors: [E401],
  },
  'GET /api/v1/belt-exams/{id}': {
    summary: 'Belt exam detail',
    description:
      'One exam with its target rank, fee and the current number of active registrations.',
    auth: 'bearer',
    data: BeltExam,
    dataDescription: 'Exam with `registeredCount` present.',
    errors: [E400, E401, E404],
  },
  'POST /api/v1/belt-exams': {
    summary: 'Create a belt exam (ADMIN)',
    description:
      'Creates an exam in DRAFT. The target rank must exist and be active; the registration deadline must not be after the exam date. Exam code is generated as EXAM-<year>-NN when omitted.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: {
      type: 'object',
      required: ['id', 'code', 'title', 'status'],
      properties: {
        id: s('Exam id (UUID).', 'd4e5f6a7-5555-4bad-9bdd-2b0d7b3dcb6d'),
        code: s('Exam code.', 'EXAM-2026-03'),
        title: s('Exam title.', 'Kỳ thi thăng đai vàng — tháng 3'),
        status: en('Initial status.', ['DRAFT'], 'DRAFT'),
      },
    },
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      title: 'Kỳ thi thăng đai vàng — tháng 3',
      examDate: '2026-03-28',
      targetRankId: 4,
      feeAmount: 150000,
      registrationDeadline: '2026-03-20',
      capacity: 40,
    },
  },
  'PATCH /api/v1/belt-exams/{id}': {
    summary: 'Update a belt exam (ADMIN)',
    description:
      'Edits metadata or moves the lifecycle (typically DRAFT → OPEN → CLOSED → COMPLETED, or CANCELLED). Registration requires OPEN and an unpassed deadline; deadline must stay ordered against the exam date.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['id', 'code', 'status'],
      properties: {
        id: s('Exam id.', 'd4e5f6a7-5555-4bad-9bdd-2b0d7b3dcb6d'),
        code: s('Exam code.', 'EXAM-2026-03'),
        status: en('Exam status.', ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'], 'OPEN'),
      },
    },
    errors: [E400, E401, E403, E404, E409],
    requestExample: { status: 'OPEN' },
  },
  'POST /api/v1/belt-exams/{id}/register': {
    summary: 'Register a student for an exam',
    description:
      'STUDENT registers themselves; PARENT a verified-linked child (ownership guard). Atomically (transaction + exam row lock) it checks: exam OPEN, deadline unpassed, student ACTIVE, target rank strictly above the student’s current rank, capacity, and no duplicate registration — then creates the registration AND its EXAM_FEE invoice together. Distinct 409 messages name the violated rule.',
    auth: 'bearer',
    roles: ['STUDENT', 'PARENT'],
    status: 201,
    data: examRegistrationData,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01' },
  },
  'GET /api/v1/exam-registrations': {
    summary: 'Exam history of a student',
    description:
      'Paginated belt history (matrix row 17): every exam registration of one student with ranks and results, newest exam first. The RESULT_PASS rows in order ARE the promotion timeline. Ownership-guard scoped for every role; `studentId` is required.',
    auth: 'bearer',
    data: page(examHistoryItem),
    query: [
      {
        name: 'studentId',
        description: 'StudentProfile whose history to list.',
        required: true,
        schema: uuid('StudentProfile id.'),
      },
      pageParam('page'),
      pageParam('limit'),
    ],
    errors: [E400, E401, E404],
  },
  'POST /api/v1/exam-registrations/{id}/result': {
    summary: 'Record an exam result',
    description:
      'ADMIN/INSTRUCTOR record the outcome. RESULT_PASS promotes the student to the exam’s target rank (re-validated at result time so a pass can never move a belt down); RESULT_FAIL leaves the belt untouched. Results are final: a second result answers 409. ADMIN may attribute another examiner; instructors may only record results of students currently enrolled in their own classes (foreign ids → 404).',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: {
      type: 'object',
      required: ['id', 'examId', 'studentId', 'status', 'examinerId'],
      properties: {
        id: s('ExamRegistration id.', 'a7b8c9d0-7777-4bad-9bdd-2b0d7b3dcb6d'),
        examId: s('Exam id.', 'd4e5f6a7-5555-4bad-9bdd-2b0d7b3dcb6d'),
        studentId: s('StudentProfile id.', 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01'),
        status: en('Recorded outcome.', ['RESULT_PASS', 'RESULT_FAIL'], 'RESULT_PASS'),
        resultNote: ns('Examiner note.', 'Good spirit'),
        examinerId: s('User id of the examiner of record.', '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f'),
      },
    },
    errors: [E400, E401, E403, E404, E409],
    requestExample: { status: 'RESULT_PASS', resultNote: 'Good spirit; polish đòn thế 5' },
  },

  // ── Billing ───────────────────────────────────────────────────────────────
  'GET /api/v1/invoices': {
    summary: 'List invoices',
    description:
      'Role-scoped: ADMIN everything (optionally filtered by studentId), STUDENT their own, PARENT their linked children’s. INSTRUCTOR has no financial surface. Filters by status and type; newest first. Detail endpoint includes line items.',
    auth: 'bearer',
    roles: ['ADMIN', 'STUDENT', 'PARENT'],
    data: page(Invoice),
    dataDescription: 'Invoices without line items (use GET /invoices/{id} for the full detail).',
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'status',
        description: 'Filter by payment status.',
        schema: en(
          'Invoice status.',
          ['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'],
          'UNPAID',
        ),
      },
      {
        name: 'type',
        description: 'Filter by invoice type.',
        schema: en('Invoice type.', ['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'], 'TUITION'),
      },
      {
        name: 'studentId',
        description: 'ADMIN-only filter by student; other roles are always scoped to themselves.',
        schema: uuid('StudentProfile id.'),
      },
    ],
    errors: [E400, E401, E403],
  },
  'GET /api/v1/invoices/{id}': {
    summary: 'Invoice detail',
    description:
      'Full invoice with line items, ownership-guard scoped. Instructors never see invoices (uniform 404).',
    auth: 'bearer',
    data: Invoice,
    dataDescription: 'Invoice with `items` present.',
    errors: [E400, E401, E404],
  },
  'POST /api/v1/invoices': {
    summary: 'Issue a manual invoice (ADMIN)',
    description:
      'Creates an invoice from explicit line items. TUITION invoices require periodMonth/periodYear (they drive the monthly idempotency key); other types forbid them. total = subtotal − manual discount − discount-code discount, and cannot go below 0 (400). An active discount code is resolved and burned-in at creation time; the invoice number is sequential and unique. The student’s linked account receives an in-app + email notification in the same transaction.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: Invoice,
    dataDescription: 'The created invoice with `items` present.',
    errors: [E400, E401, E403, E404],
    requestExample: {
      studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
      type: 'UNIFORM',
      items: [{ description: 'Võ phục', quantity: 1, unitAmount: 250000 }],
      note: 'Võ phục mới',
    },
  },
  'POST /api/v1/admin/billing/generate-monthly': {
    summary: 'Monthly tuition close (ADMIN)',
    description:
      'Generates one TUITION invoice per ACTIVE student per period from the configured tuition rates — a student enrolled in two selected classes gets one invoice with two line items. Idempotent per (student, period): rerunning skips existing invoices. Classes without a configured rate are reported in classesSkipped. Due date: 10th of the period.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: generateMonthlyData,
    errors: [E400, E401, E403],
    requestExample: { month: 9, year: 2026, classIds: ['9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'] },
  },
  'GET /api/v1/admin/reports/revenue': {
    summary: 'Revenue report (ADMIN)',
    description:
      'Revenue by month and settlement channel over SUCCESS payments inside the window, plus the grand total. Refunded/disputed money is excluded; refunding moves it out of the window sum on the next call.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: revenueData,
    query: [
      {
        name: 'from',
        description: 'Window start (ISO date, inclusive).',
        required: true,
        schema: d('From date.', '2026-09-01'),
      },
      {
        name: 'to',
        description: 'Window end (ISO date, inclusive).',
        required: true,
        schema: d('To date.', '2026-09-30'),
      },
    ],
    errors: [E400, E401, E403],
  },
  'GET /api/v1/admin/reports/tuition': {
    summary: 'Tuition close report (ADMIN)',
    description:
      'For one period: invoice counts and sums per status, plus the actually settled (SUCCESS payments) amount — the receivables picture of the monthly close.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: tuitionReportData,
    query: [
      {
        name: 'month',
        description: 'Period month (1..12).',
        required: true,
        schema: i('Month.', 9),
      },
      { name: 'year', description: 'Period year.', required: true, schema: i('Year.', 2026) },
    ],
    errors: [E400, E401, E403],
  },
  'GET /api/v1/admin/billing/settings': {
    summary: 'Read billing settings (ADMIN)',
    description:
      'The two billing configuration keys: the tuition_rates map (classId → VND/month) and the receiving bank account (null until configured).',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: settingsData,
    errors: [E401, E403],
  },
  'PUT /api/v1/admin/billing/settings/tuition-rates': {
    summary: 'Replace tuition rates (ADMIN)',
    description:
      'Replaces the whole tuition_rates map. Unknown class ids and duplicate entries in the payload are rejected. Only future invoice runs use the new rates — existing invoices keep their stored amounts.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: settingsData,
    errors: [E400, E401, E403],
    requestExample: {
      rates: [{ classId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', monthlyAmount: 400000 }],
    },
  },
  'PUT /api/v1/admin/billing/settings/bank-account': {
    summary: 'Set the receiving bank account (ADMIN)',
    description:
      'Configures the account QR payments settle into. Only BUSINESS owner type is accepted (fee collection rule). QR creation fails with 409 until this is set.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: settingsData,
    errors: [E400, E401, E403],
    requestExample: {
      bankAccount: {
        bin: '970422',
        number: '9012345678901',
        name: 'CONG TY TNHH VOVINAM ANH QUAN',
        ownerType: 'BUSINESS',
      },
    },
  },
  'GET /api/v1/discounts': {
    summary: 'List discount codes (ADMIN)',
    description: 'Paginated discount code catalog, newest first.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: page(DiscountCode),
    query: [pageParam('page'), pageParam('limit')],
    errors: [E401, E403],
  },
  'POST /api/v1/discounts': {
    summary: 'Create a discount code (ADMIN)',
    description:
      'Creates a code. Exactly ONE of percentOff/amountOff must be set (XOR, validated); validUntil must be after validFrom. Codes are unique case-insensitively (stored uppercase); duplicates answer 409.',
    auth: 'bearer',
    roles: ['ADMIN'],
    status: 201,
    data: DiscountCode,
    errors: [E400, E401, E403, E409],
    requestExample: {
      code: 'TET2026',
      percentOff: 10,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-02-28T23:59:59.000Z',
      description: 'Tết promotion',
    },
  },
  'PATCH /api/v1/discounts/{id}': {
    summary: 'Update a discount code (ADMIN)',
    description:
      'Edits description, expiry or active flag. The percent/amount type is immutable — retire the code and create a new one instead.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: DiscountCode,
    errors: [E400, E401, E403, E404],
    requestExample: { validUntil: '2026-03-15T23:59:59.000Z' },
  },
  'DELETE /api/v1/discounts/{id}': {
    summary: 'Delete a discount code (ADMIN)',
    description:
      'Hard-deletes the code (configuration, not a financial record). Invoices already issued keep their burned-in discount amount.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['id', 'deleted'],
      properties: {
        id: s('Deleted code id.', 'b8c9d0e1-8888-4bad-9bdd-2b0d7b3dcb6d'),
        deleted: b('Constant true.', true),
      },
    },
    errors: [E400, E401, E403, E404],
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  'POST /api/v1/payments/qr/{invoiceId}': {
    summary: 'Start a QR payment for an invoice',
    description:
      'Creates a PENDING payment transaction with a unique order reference and gateway checkout/QR payload (30-minute QR expiry). Ownership guard: ADMIN/STUDENT own, PARENT linked children. Only UNPAID/OVERDUE invoices are payable (409); the receiving bank account must be configured (409). Instructors have no money surface.',
    auth: 'bearer',
    roles: ['ADMIN', 'STUDENT', 'PARENT'],
    status: 201,
    data: {
      type: 'object',
      required: ['paymentId', 'orderRef', 'amount', 'status', 'expiresAt', 'checkoutUrl'],
      properties: {
        paymentId: s('PaymentTransaction id.', 'a7b8c9d0-7777-4bad-9bdd-2b0d7b3dcb6d'),
        orderRef: s('Transfer-content reference the gateway reports back.', 'VVAB23CDE4'),
        amount: i('Amount to pay (VND) — equals the invoice total.', 400000),
        status: en('Initial status.', ['PENDING'], 'PENDING'),
        expiresAt: dt('QR expiry (30 minutes).', '2026-09-25T01:30:00.000Z'),
        checkoutUrl: s(
          'Gateway-hosted payment page (null for the simulated gateway).',
          'https://pay.payos.vn/...',
        ),
        qrCodeDataUrl: s(
          'PNG data URL of the QR when the gateway provides one.',
          'data:image/png;base64,...',
        ),
      },
    },
    errors: [E400, E401, E403, E404, E409],
  },
  'POST /api/v1/payments/webhook/{provider}': {
    summary: 'Payment gateway webhook (public, HMAC-signed)',
    description:
      'PUBLIC webhook — authentication is the HMAC signature over the RAW request body, not a JWT. A bad signature answers 401 so the gateway retries; everything else answers 200 to stop retries (unknown orders and malformed-but-signed events are 200 no-ops). Processing is idempotent: the gateway transaction id is claimed exactly once, so duplicate/parallel deliveries never double-settle. A signed amount mismatch marks the payment DISPUTED and never marks the invoice paid; a matching SUCCESS amount settles the invoice once SUCCESS transactions cover the total.',
    auth: 'webhook',
    data: {
      type: 'object',
      required: ['processed'],
      properties: {
        processed: b('Whether the event changed state.', true),
        outcome: en('Settlement outcome when processed.', ['SUCCESS', 'FAILED'], 'SUCCESS'),
        flagged: b(
          'True when the event was processed but flagged (amount mismatch → DISPUTED).',
          false,
        ),
      },
    },
    errors: [{ status: 401, description: 'HMAC signature verification failed.' }],
  },
  'POST /api/v1/payments/{invoiceId}/confirm-cash': {
    summary: 'Confirm a cash payment (ADMIN)',
    description:
      'Marks the invoice PAID and records a CASH settlement in one transaction; the invoice-status claim makes double confirmation impossible (second call → 409). Only UNPAID/OVERDUE invoices qualify.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: Payment,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { note: 'Cash at dojo, receipt #014' },
  },
  'PATCH /api/v1/payments/{id}': {
    summary: 'Refund or dispute a payment (ADMIN)',
    description:
      'Marks a SUCCESS payment REFUNDED or DISPUTED (wrong transfer). Only SUCCESS payments qualify (409). The invoice status is re-derived: after a refund the invoice flips back to UNPAID unless another settlement still covers the total.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: Payment,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { status: 'REFUNDED', note: 'Wrong transfer, refunded in person' },
  },
  'GET /api/v1/payments': {
    summary: 'Payment history of an invoice',
    description:
      'All settlement attempts of one invoice, newest first, ownership-guard scoped (ADMIN/STUDENT own, PARENT linked).',
    auth: 'bearer',
    roles: ['ADMIN', 'STUDENT', 'PARENT'],
    data: {
      type: 'object',
      required: ['items', 'total'],
      properties: {
        items: { type: 'array', items: Payment },
        total: { type: 'integer', description: 'Number of payments.', example: 1 },
      },
    },
    query: [
      {
        name: 'invoiceId',
        description: 'Invoice whose payments to list.',
        required: true,
        schema: uuid('Invoice id.'),
      },
    ],
    errors: [E400, E401, E403, E404],
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  'GET /api/v1/notifications/me': {
    summary: 'Own notification feed',
    description:
      'The caller’s in-app notifications (and email outbox rows), newest first. Always scoped to the caller; nothing foreign is addressable.',
    auth: 'bearer',
    data: page(Notification),
    query: [pageParam('page'), pageParam('limit')],
    errors: [E401],
  },
  'POST /api/v1/admin/notifications/flush': {
    summary: 'Flush the outbox (ADMIN)',
    description:
      'Runs one in-process worker pass synchronously (ops/diagnostics helper). Normally the background worker drains the outbox automatically.',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['flushed'],
      properties: { flushed: b('Constant true.', true) },
    },
    errors: [E401, E403],
  },
  'PATCH /api/v1/notifications/{id}/read': {
    summary: 'Mark a notification read',
    description:
      'Marks one of the caller’s notifications read. Idempotent: re-reading returns the row with its readAt unchanged; foreign/unknown ids answer the uniform 404.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['id', 'readAt'],
      properties: {
        id: s('Notification id.', 'c9d0e1f2-9999-4bad-9bdd-2b0d7b3dcb6d'),
        readAt: dt('Read timestamp.', '2026-09-25T02:00:00.000Z'),
      },
    },
    errors: [E400, E401, E404],
  },

  // ── Consent ───────────────────────────────────────────────────────────────
  'POST /api/v1/consent': {
    summary: 'Grant a consent purpose',
    description:
      'Grants one purpose for the caller, or — with studentId — for a verified-linked MINOR (the acting parent is recorded). Idempotent: an already-active purpose returns the existing row with alreadyActive=true. Append-only: revoking and re-granting adds a new history row. Parents cannot consent for adults; students without an account cannot be proxied (400).',
    auth: 'bearer',
    status: 201,
    data: Consent,
    errors: [E400, E401, E404],
    requestExample: { purpose: 'MEDIA_USAGE', studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01' },
  },
  'POST /api/v1/consent/revoke': {
    summary: 'Revoke a consent purpose',
    description:
      'Stamps the active row of one purpose as revoked (history stays). 404 when the purpose was never granted or is already revoked.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['purpose', 'revokedAt'],
      properties: {
        purpose: en(
          'Revoked purpose.',
          ['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'],
          'MEDIA_USAGE',
        ),
        revokedAt: dt('Revocation timestamp.', '2026-09-25T03:00:00.000Z'),
      },
    },
    errors: [E400, E401, E404],
    requestExample: { purpose: 'MEDIA_USAGE' },
  },
  'GET /api/v1/consent/me': {
    summary: 'Own consent history',
    description:
      'The caller’s consent rows (grants and revocations), newest first — the consent audit screen.',
    auth: 'bearer',
    data: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: Consent } },
    },
    errors: [E401],
  },

  // ── Announcements ─────────────────────────────────────────────────────────
  'GET /api/v1/announcements': {
    summary: 'Announcement feed',
    description:
      'Audience-scoped feed, newest first. ALL announcements reach everyone; CLASS announcements only users related to the class (instructor, enrolled students, verified-linked parents). ADMIN sees everything.',
    auth: 'bearer',
    data: page(Announcement),
    query: [pageParam('page'), pageParam('limit')],
    errors: [E401],
  },
  'POST /api/v1/announcements': {
    summary: 'Publish an announcement',
    description:
      'ADMIN may post club-wide (ALL) or class-scoped; INSTRUCTOR only CLASS announcements for classes they teach (club-wide attempts answer 403, foreign classes 404). audience=ALL forbids classId; audience=CLASS requires it.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    status: 201,
    data: Announcement,
    errors: [E400, E401, E403, E404],
    requestExample: {
      title: 'Nghỉ lễ 2/9',
      body: 'CLB nghỉ các ngày 1-2/9.',
      audience: 'CLASS',
      classId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    },
  },
  'PATCH /api/v1/announcements/{id}': {
    summary: 'Update an announcement',
    description:
      'ADMIN edits anything; INSTRUCTOR only their own announcements and only within CLASS audience of classes they teach (foreign/foreign-authored → 404). The effective audience/class pair must stay consistent (switching to ALL drops the class target).',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: Announcement,
    errors: [E400, E401, E403, E404],
    requestExample: { body: 'Học bù vào thứ 7 này.' },
  },
  'DELETE /api/v1/announcements/{id}': {
    summary: 'Delete an announcement',
    description: 'ADMIN deletes anything; INSTRUCTOR only their own (foreign → uniform 404).',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: {
      type: 'object',
      required: ['deleted'],
      properties: { deleted: b('Constant true.', true) },
    },
    errors: [E400, E401, E403, E404],
  },

  // ── Leaves ────────────────────────────────────────────────────────────────
  'POST /api/v1/leave-requests': {
    summary: 'Request an absence',
    description:
      'STUDENT (self) or PARENT (linked child) asks to miss one class session. The student must be actively enrolled (409 otherwise); the date must be today or later (400) and one request per (student, class, date) (409). Foreign students answer the uniform 404.',
    auth: 'bearer',
    roles: ['ADMIN', 'STUDENT', 'PARENT'],
    status: 201,
    data: LeaveRequest,
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
      classId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      sessionDate: '2026-09-29',
      reason: 'School event in the evening',
    },
  },
  'GET /api/v1/leave-requests': {
    summary: 'List leave requests',
    description:
      'Role-scoped: ADMIN all, INSTRUCTOR requests of their own classes, STUDENT/PARENT their own. Filters by status/class/student; newest first.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT'],
    data: page(LeaveRequest),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'status',
        description: 'Filter by workflow status.',
        schema: en('Workflow status.', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], 'PENDING'),
      },
      { name: 'classId', description: 'Filter by class.', schema: uuid('Class id.') },
      { name: 'studentId', description: 'Filter by student.', schema: uuid('StudentProfile id.') },
    ],
    errors: [E401, E403],
  },
  'POST /api/v1/leave-requests/{id}/review': {
    summary: 'Review a leave request',
    description:
      'The class instructor (or an ADMIN) approves/rejects a PENDING request; only PENDING can be reviewed (409 after finality). Instructors reviewing a foreign class request get the uniform 404.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: LeaveRequest,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { status: 'APPROVED', note: 'Approved — have fun at the event' },
  },
  'POST /api/v1/leave-requests/{id}/cancel': {
    summary: 'Cancel a leave request',
    description:
      'The requester (or an ADMIN) cancels a PENDING request; final states cannot be cancelled (409). Non-owner cancellations answer the uniform 404.',
    auth: 'bearer',
    roles: ['ADMIN', 'STUDENT', 'PARENT'],
    data: LeaveRequest,
    errors: [E400, E401, E403, E404, E409],
  },
  'DELETE /api/v1/leave-requests/{id}': {
    summary: 'Delete a leave request (ADMIN)',
    description:
      'Hard-deletes a request row (cleanup tool; workflow states should be driven through review/cancel).',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: {
      type: 'object',
      required: ['id', 'deleted'],
      properties: {
        id: s('Deleted request id.', 'f2a3b4c5-cccc-4bad-9bdd-2b0d7b3dcb6d'),
        deleted: b('Constant true.', true),
      },
    },
    errors: [E400, E401, E403, E404],
  },

  // ── Promotions ────────────────────────────────────────────────────────────
  'POST /api/v1/promotion-proposals': {
    summary: 'Propose a promotion',
    description:
      'INSTRUCTOR (own-class students) or ADMIN proposes a student for a higher rank. The proposed rank must be active and strictly above the current one (409), and the student may not already have an open proposal (409). Advisory only: approval never changes the belt — only an exam RESULT_PASS does.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    status: 201,
    data: Proposal,
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
      proposedRankId: 5,
      note: 'Consistent training, ready for the exam',
    },
  },
  'GET /api/v1/promotion-proposals': {
    summary: 'List promotion proposals',
    description:
      'Role-scoped: ADMIN all, INSTRUCTOR own-class students, STUDENT/PARENT their own. Filter by status/student; newest first.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT'],
    data: page(Proposal),
    query: [
      pageParam('page'),
      pageParam('limit'),
      {
        name: 'status',
        description: 'Filter by workflow status.',
        schema: en('Workflow status.', ['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'),
      },
      { name: 'studentId', description: 'Filter by student.', schema: uuid('StudentProfile id.') },
    ],
    errors: [E401, E403],
  },
  'PATCH /api/v1/promotion-proposals/{id}': {
    summary: 'Edit a proposal note',
    description:
      'The author (or an ADMIN) edits the note while the proposal is still PENDING; final proposals are immutable (409), foreign ones 404.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: Proposal,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { note: 'Also passed the grading test' },
  },
  'POST /api/v1/promotion-proposals/{id}/review': {
    summary: 'Review a promotion proposal (ADMIN)',
    description:
      'The master (ADMIN persona) approves or rejects a PENDING proposal. Approval is bookkeeping only — it NEVER moves the belt; scheduling the exam is the next organizational step. Instructors cannot review (uniform 404), only PENDING can be reviewed (409).',
    auth: 'bearer',
    roles: ['ADMIN'],
    data: Proposal,
    errors: [E400, E401, E403, E404, E409],
    requestExample: { status: 'APPROVED', note: 'Approved — schedule the exam' },
  },

  // ── Evaluations ───────────────────────────────────────────────────────────
  'POST /api/v1/evaluations': {
    summary: 'Record a student evaluation',
    description:
      'INSTRUCTOR/ADMIN record a 1..10 rating with optional comment (own-class students for instructors; ownership guard). With periodMonth+periodYear the evaluation is unique per (author, student, period) — a duplicate answers 409; omit the period for unbound evaluations.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    status: 201,
    data: Evaluation,
    errors: [E400, E401, E403, E404, E409],
    requestExample: {
      studentId: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
      rating: 8,
      periodMonth: 9,
      periodYear: 2026,
      comment: 'Strong progress on đòn thế',
    },
  },
  'GET /api/v1/evaluations': {
    summary: 'List evaluations of a student',
    description:
      'Paginated evaluations of one student, newest first, ownership-guard scoped (student self, linked parents, instructors, admin). `studentId` is required.',
    auth: 'bearer',
    data: page(Evaluation),
    query: [
      {
        name: 'studentId',
        description: 'StudentProfile whose evaluations to list.',
        required: true,
        schema: uuid('StudentProfile id.'),
      },
      pageParam('page'),
      pageParam('limit'),
    ],
    errors: [E400, E401, E404],
  },
  'PATCH /api/v1/evaluations/{id}': {
    summary: 'Update an evaluation',
    description:
      'The author (or an ADMIN) corrects rating/comment. Foreign-authored evaluations answer the uniform 404.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: Evaluation,
    errors: [E400, E401, E403, E404],
    requestExample: { rating: 9, comment: 'Guard improved after drills' },
  },
  'DELETE /api/v1/evaluations/{id}': {
    summary: 'Delete an evaluation',
    description:
      'The author (or an ADMIN) removes a mistaken evaluation; foreign ones answer the uniform 404.',
    auth: 'bearer',
    roles: ['ADMIN', 'INSTRUCTOR'],
    data: {
      type: 'object',
      required: ['id', 'deleted'],
      properties: {
        id: s('Deleted evaluation id.', 'b4c5d6e7-eeee-4bad-9bdd-2b0d7b3dcb6d'),
        deleted: b('Constant true.', true),
      },
    },
    errors: [E400, E401, E403, E404],
  },
};
