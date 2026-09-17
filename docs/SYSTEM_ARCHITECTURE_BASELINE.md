# VovinamApiNode — System Architecture Baseline (TASK-01)

Baseline date: 2026-09-15. Status: **APPROVED** — authoritative architecture baseline for the thesis.
Produced by TASK-01-ARCHITECTURE-RECONCILIATION. Documentation only: no schema, migration, API,
or code change was made by this task.

Inputs (source-of-truth priority per `.agents/AGENTS.md` — code > schema > migrations > git >
tests/CI > OpenAPI > progress > plan):

1. `docs/CURRENT_STATE_AUDIT.md` (TASK-00, verified 2026-09-15)
2. Repository re-inspection performed for this baseline: `src/app.module.ts`, the 13 controller
   files (layer-rule grep; billing + health read in depth; full route/role decorator scan from
   TASK-00), `src/students/student-ownership.service.ts`, `src/billing/billing.controller.ts`,
   ports and jobs, `prisma/schema.prisma` (23 domain models, `UserRole` enum), module dependency
   graph, layer-rule greps (controllers↔Prisma, services↔HTTP), committed `openapi.json`
   (71 operations, zero notification/consent paths), git state (`main` @ `9e371ac` + uncommitted
   P5 working set)
3. `docs/PLAN.md` (§2 actors, §3 stack, §6 schema incl. `announcements`, §7 business rules,
   §8 endpoints, §10 legal, §16 non-goals)
4. `.agents/prompts/00-global-contract.md` (immutable engineering rules)

Authority: this document is the architecture source of truth for TASK-02…TASK-06. Where future
code contradicts it, code wins and the baseline must be reconciled — the same hierarchy applies
to this document as to `docs/PLAN.md`.

Every major decision is recorded as a DECISION block (DECISION / RATIONALE / EVIDENCE / IMPACT /
STATUS) in §16–§17 and cross-referenced (AD-xx / DD-xx) from the body sections.

---

## 1. System Purpose

VovinamApiNode is the **backend REST API for one legally registered Vovinam club**. It manages the
club's real operational data: students (including minors), parent relationships, classes and
training schedules, enrollment, attendance, belt ranks and belt examinations, tuition invoices,
QR/cash payments, club announcements, and per-user notifications — under role-based authorization
with ownership protection for children's data.

Primary user value (thesis objective):

1. **Võ sinh can quickly access class schedules** — via the class/schedule catalog
   (`GET /classes`, `GET /classes/:id`); a per-student aggregated "my schedule" view is an
   approved optional extension (DD-02).
2. **Võ sinh can view tuition information** — role-scoped invoice reads
   (`GET /invoices`, `GET /invoices/:id`).
3. **Võ sinh can view club activities** — announcements to the club or their class. **Not yet
   implemented**; the design is adopted by AD-07 and scheduled for TASK-02 (schema) / TASK-04
   (implementation). This is the only primary-value domain gap.

The system also supports club management (admin backoffice: student management, class/training
management, attendance, belt/rank management, belt examination, tuition management, QR payment,
revenue reporting), role-based authorization, a three-tier test suite, and a deployment trial.

The system is **not**: the frontend (separate React project), a multi-club/multi-tenant platform,
an e-invoice/tax authority integration, or a legal authority — compliance claims require named
human/legal verification (contract §11).

## 2. System Scope

In scope (this repository, backend API only):

| Area | Status in architecture |
|---|---|
| Self-contained auth (register/verify/login/refresh/MFA/sessions/audit trail) | Implemented (P1) |
| Student profiles + parent linking (incl. minors, invite-code flow) | Implemented (P2) |
| Classes, schedules, enrollment, attendance | Implemented (P2) |
| Belt ranks, belt exams, exam registration, results, promotion | Implemented (P3) |
| Invoices, monthly tuition generation, QR payment, cash confirmation, revenue report | Implemented (P4) |
| Notifications (outbox + INAPP feed) and consent | Implemented, UNCOMMITTED (P5 working set) |
| Club activity announcements | **Missing** — designed (AD-07), TASK-02/04 |
| CI/CD, Docker, migrations, health/metrics | Implemented; deploy trial undemonstrated (TASK-06) |

Out of scope (plan §16 and thesis boundary — none of these may be added without a new task):
React frontend (separate project, §5), multi-club/multi-tenancy, OAuth/passkeys/Zalo login,
Zalo Mini App / mobile app, instructor payroll, uniform/inventory management, tournament
management, e-invoice gateway integration, Redis/horizontal scaling, attendance analytics.

## 3. Actors and Role Model

### 3.1 Actor ↔ role mapping (authoritative)

Authorization roles are exactly the `UserRole` enum — `ADMIN, INSTRUCTOR, STUDENT, PARENT`
(`prisma/schema.prisma:17-23`). One role per user is a documented, accepted limitation
(plan §2); a person with two roles uses two accounts.

| Thesis actor | Authorization role | Persona or role? | Notes |
|---|---|---|---|
| Admin (quản trị câu lạc bộ) | `ADMIN` | Role | Club management + money. |
| Võ sư (grand master / club master) | `ADMIN` (typically); grading authority via `ExamRegistration.examinerId` | **Persona, not a role** | AD-02. In a single-club reality the Võ sư is the club's operator (management, money) and chief grader. `ADMIN` is a permission superset of `INSTRUCTOR` on every route in the system (verified: attendance sessions/records, exam results, and student lists all admit `ADMIN` in addition to `INSTRUCTOR`; every other route is ADMIN-only). A Võ sư using an ADMIN account therefore loses no capability. "The master grades" is already modeled without a role: `exam_registrations.examiner_id` (`prisma/schema.prisma:486-487`). |
| Huấn luyện viên (instructor/coach) | `INSTRUCTOR` | Role | Direct match: attendance, exam-result entry, own-class student visibility with contact fields dropped (plan §7.4). |
| Võ sinh (student) | `STUDENT` **role** + `StudentProfile` **domain row** | Both — deliberate role-vs-domain split | AD-02. Adults ≥18: STUDENT account (self-registration, PENDING → ACTIVE approval). Minors: `StudentProfile` row **without** a user account, linked to a PARENT via invite code (plan §7.1). |
| — (not in thesis list) | `PARENT` | Role, supporting actor | AD-03. Required by the minor flow (Children Law 2016 posture, plan §7.1/§10), exam registration for children, and consent proxying (`consent_logs.consented_by_user_id`). |

### 3.2 Decision summary

- **No dedicated VÕ SƯ / MASTER role is added.** The current 4-role model is sufficient and
  expressive for the actual club (AD-02). Adding a fifth role would touch the enum, a migration,
  the permission matrix, the serializer matrix, guards, seed, and tests, for zero
  authorization-expression gain: no thesis use case requires a person with more authority than
  INSTRUCTOR but less than ADMIN.
- **PARENT stays** as the fourth role (AD-03).
- Domain concepts that are deliberately **not** roles: examiner (attribution field), minor
  student (profile row without account), club master (persona of an ADMIN user).

## 4. System Boundary

The system is **one NestJS 11 process plus one PostgreSQL 16 database**, deployed as a Docker
image (multi-stage, non-root), fronted by a provider TLS/reverse proxy.

| Component | Inside boundary | Boundary crossing |
|---|---|---|
| NestJS application (13 feature modules + shared infra) | Yes | — |
| PostgreSQL database (Prisma-owned schema, committed migrations) | Yes | Prisma engine over TCP (only data path) |
| In-process background workers (outbox, purge, aging) | Yes | — |
| React frontend | **No** (separate project) | HTTPS REST `/api/v1`, committed `openapi.json` contract |
| Payment gateway (payOS or SePay) | No | Outbound: gateway create-payment API. Inbound: `POST /payments/webhook/:provider` (public, HMAC-signed raw body) |
| SMTP provider | No | `MAIL_PORT` adapter (outbound) |
| Zalo ZNS / SMS provider | No | `ZNS/SMS_SENDER_PORT` adapters (outbound) |
| TLS termination / WAF / network DDoS mitigation | No | Provider responsibility (contract §12/§13); application throttling is application-layer only |
| Bank account (fee collection) | No | Legal-entity account guarded by `app_settings.bank_account.owner_type='BUSINESS'` (plan §10) |
| Organizational processes (cash handling, admin training, legal/tax filings) | No | Outside software scope |

Boundary rules: no component other than the app process touches PostgreSQL; the frontend gets no
database access and no shared secrets (plan §3); every external provider call goes through a port
(§11).

## 5. Frontend/Backend Boundary

This repository is the backend only (plan §2: "backend API only"). The thesis stack places a React
frontend in the overall project; it is a **pure API client**.

The contract between them consists of exactly:

- REST under `/api/v1` (fixed, contract §1);
- the response envelope `{"code","message","data"}`, global pagination `?page=1&limit=20`
  (limit ≤ 100), uniform error envelope, uniform-401/404 postures (anti-enumeration,
  anti-IDOR disclosure) (contract §4);
- JWT bearer authentication (15-minute access tokens, rotating refresh tokens);
- the committed, spectral-linted `openapi.json`, kept current by the CI contract-gate — the
  frontend's single source of API truth.

Frontend-owned responsibilities (explicitly out of the backend's): QR image rendering from the
payment URL returned by `POST /payments/qr/:invoiceId` (audit C-6), redirect flows to the gateway
checkout, session/refresh token storage, and all client-side role-based UX (never trusted;
authorization is enforced server-side on every route).

Current contract state: the committed `openapi.json` (59 paths / 71 operations) does not yet
include the uncommitted P5 endpoints (notifications 3, consent 3) — a known task-order issue
(AF-12, AD-13), not a boundary-design problem.

## 6. Domain Boundary

Classification of every module (task-01 §5 list) into domain categories:

| Category | Modules |
|---|---|
| **Core domain** (the thesis is about these) | `students`, `parents`, `classes` (incl. enrollments), `attendance`, `belts`, `exams`, `billing` (incl. payments), `announcements` (**to be created** — AD-07) |
| **Supporting domain** (justified by thesis context: minors, money, communication) | `auth` (identity/session/MFA/audit trail), `notifications` (outbox + INAPP feed), `consent` (Decree 13/2023 posture) |
| **Infrastructure** | `prisma`, `common` (envelope, exception filter, throttler, SharedStore, parse-uuid, raw-body capture), `config` (fail-fast env), `logging` (pino), `health` (healthz/readyz/metrics) |
| **Optional extension** | none currently exists as a module; per-student schedule read is an approved endpoint-level extension (DD-02) |
| **Out of scope** | none exists as a module (plan §16 list stays out) |

Notes on classification:

- `auth` is both security infrastructure and a small domain (registration, verification,
  deactivation flows with real business rules). It is classified as a supporting domain because
  the thesis demonstrates it (RBAC + account lifecycle), not merely consumes it.
- There is **no `users` module** although plan §3's repo layout lists one; user-account
  functionality lives in `auth`. Accepted drift (audit L-8); renaming/splitting is not justified.
- Detected pathologies: **none.** No overlapping responsibilities, no duplicated business rules,
  no circular module dependencies (verified dependency graph below), no infrastructure leaking
  into domain modules. The one controller-level Prisma use is the `readyz` probe (AF-7) — an ops
  endpoint, not a domain module.

Module dependency graph (verified from `*.module.ts` imports; acyclic):

```
attendance  → {AuthModule, ClassesModule, StudentsModule}
exams       → {AuthModule, StudentsModule, BillingModule}
billing     → {AuthModule, StudentsModule, NotificationsModule}
consent     → {AuthModule, StudentsModule}
parents     → {AuthModule, StudentsModule}
students    → {AuthModule}      classes → {AuthModule}
belts, notifications, health → {AuthModule / standalone infra}
```

Shared policy reuse: `StudentOwnershipService` (students module) is consumed by attendance,
billing/payments, consent, and exams — a deliberate read-side policy service, not duplicated
ownership logic.

## 7. Module Responsibility Matrix

| Module | Responsibility (business) | Owns (tables) | Exposes (API) | Must not |
|---|---|---|---|---|
| `auth` | Account lifecycle: register/verify, login, refresh rotation + reuse detection, TOTP MFA, recovery codes, sessions, change-email, deactivation, per-user audit trail; guard issuance/validation | `users`, `sessions`, `refresh_tokens`, `totp_credentials`, `recovery_codes`, `used_tokens`, `audit_logs` | 25 ops (24 paths) | Touch domain tables; issue domain data outside serializer rules |
| `students` | Student profile lifecycle (create/approve/edit/soft-delete), invite-code issuance/rotation, role-based field serializer, **ownership guard 7.3** (policy reused system-wide) | `student_profiles` | 7 ops | Expose contact fields to INSTRUCTOR (plan §7.4) |
| `parents` | Parent↔student verified linking (single-use invite code), children list, unlink (unverified self-service only) | `parent_student_links` | 3 ops | Accept raw student ids as link input (invite code only) |
| `classes` | Class catalog CRUD, schedule management (effective ranges), enrollment (capacity + same-day guards, soft-leave) | `classes`, `class_schedules`, `enrollments` | 6 + 3 ops | Delete/overwrite historical enrollment rows (soft-leave only) |
| `attendance` | Attendance sessions (per class+date), bulk record upsert, per-student history, monthly summary | `attendance_sessions`, `attendance_records` | 5 ops | Write records for PAUSED/ARCHIVED classes' new sessions |
| `belts` | Belt rank catalog (15 seeded ranks) | `belt_ranks` | 3 ops | Delete ranks referenced by profiles/exams |
| `exams` | Belt exam CRUD + lifecycle (DRAFT→OPEN→…), registration (atomic with EXAM_FEE invoice), result entry (final, examiner-attributed), **promotion write** | `belt_exams`, `exam_registrations`; writes `student_profiles.current_belt_rank_id` (AD-08) | 6 ops | Re-open results (409 on re-entry); promote without invoice path |
| `billing` | Invoices + items, monthly tuition generation (idempotent), revenue report, payments (QR initiation, webhook settlement, cash confirmation, refund/dispute re-derivation), overdue aging; gateway port + simulated adapter | `invoices`, `invoice_items`, `payment_transactions` | 5 + 5 ops | Hard-delete financial rows; mark PAID on amount mismatch; expose financial reads to INSTRUCTOR (AD-06) |
| `notifications` | Outbox worker (delivery with retry/fallback), INAPP feed, read-marking, admin flush | `notifications` | 3 ops | Deliver without going through the outbox status machine |
| `consent` | Purpose-scoped consent recording with parent-proxy for minors, revocation | `consent_logs` | 3 ops | Record consent for a minor without verified-link proxy |
| `health` | Liveness/readiness probes, prom-client metrics (bearer-only) | — (no tables) | 3 ops | Touch domain data |
| `common` / `config` / `logging` / `prisma` | Envelope, filters, interceptors, request-id, IP throttler, SharedStore, UUID parsing, raw-body capture; fail-fast env; pino; Prisma | `app_settings` (config key/value, seeded: `tuition_rates`, `bank_account`) | — | Contain business rules |

## 8. Application Architecture

**Verdict: KEEP — NestJS 11 modular monolith (AD-01).** Layer model as implemented:

```
HTTP/API layer        controllers, DTOs (class-validator), guards, interceptors, filters
    ↓ delegates only
Application services  business rules, transactions, audit emission, port calls
    ↓ uses
Domain components     serializer, time utilities, ownership policy, ports (interfaces)
    ↓ via
Persistence/infra     PrismaService, SharedStore, mail/gateway/sender adapters, loggers
```

Verified layer rules (contract §1) and their status:

| Rule | Status |
|---|---|
| Controllers never access Prisma | **Holds, one documented exception**: `HealthController.getReadiness` runs `SELECT 1` (`src/health/health.controller.ts:18`) — an ops probe mandated by plan §4.1 with no business logic to delegate. Accepted; do not "fix" by inventing a HealthService. |
| Services never import HTTP-layer classes | **Holds.** All 9 service-level imports from `auth/guards/` are `import type { AuthenticatedUser }` — a plain claims interface, zero runtime dependency on guard behavior. |
| Business rules live in services | Holds (spot-verified in billing/payments/exams/ownership services; audit §E). |
| Shared infrastructure reused, not duplicated | Holds (global pipe/filter/guards in `app.module.ts:55-60`; SharedStore/AuthModule imported, never re-implemented). |

Global request pipeline: `RequestIdMiddleware` + `MetricsMiddleware` (all routes) →
`IpThrottlerGuard` (APP_GUARD) → `JwtAuthGuard` → `RolesGuard` (per controller) → handler →
`ResponseInterceptor` (envelope) + `RequestLoggingInterceptor`; `HttpExceptionFilter` global;
`ValidationPipe(whitelist, forbidNonWhitelisted)` global.

Transaction discipline: services own transactions (e.g., exam registration + EXAM_FEE invoice in
one transaction; webhook settlement flips invoice PAID inside one transaction). Controllers are
transaction-free.

## 9. Data Ownership Boundary

Each table has exactly **one owning module** (writer of record); cross-module access happens via
that module's exported service or a shared policy service.

| Domain | Tables (owner) | Delete policy | Integrity anchors |
|---|---|---|---|
| Auth/identity | `users`, `sessions`, `refresh_tokens`, `totp_credentials`, `recovery_codes`, `used_tokens`, `audit_logs` (auth) | `users` soft delete (`deleted_at`); tokens expire/purge | `users.email UQ`; `refresh_tokens.token_hash UQ`; `used_tokens.jti` single-use |
| Configuration | `app_settings` (config/seed; read by billing) | never | key PK, JSONB values (`tuition_rates`, `bank_account`) |
| Student | `student_profiles` (students) | soft delete; RESTRICT against financial chain | `user_id UQ NULL` (minors have none) |
| Parent link | `parent_student_links` (parents) | rows removed on unlink (unverified) or CASCADE from either side | `invite_code UQ`; `UQ(parent,student)` |
| Training | `classes`, `class_schedules`, `enrollments` (classes) | enrollments: append + soft-leave (`left_at`); schedules CASCADE with class | `UQ(class, session-related keys)`; capacity guarded in service |
| Attendance | `attendance_sessions`, `attendance_records` (attendance) | records upsert-overwrite by business key (historical by design) | `UQ(class_id, session_date)`; `UQ(session_id, student_id)` |
| Belt | `belt_ranks` (belts) | never (seeded reference data) | `code UQ`, `order_index UQ` |
| Exams | `belt_exams`, `exam_registrations` (exams) | RESTRICT; registrations final | `UQ(exam, student)` |
| Financial | `invoices`, `invoice_items`, `payment_transactions` (billing) | **never hard-deleted** (contract §6) | `invoice_no UQ`; `gateway_txn_id UQ` (webhook idempotency); `UQ(student,type,period_month,period_year)` (monthly idempotency); `order_ref UQ`; FK RESTRICT on the whole money chain |
| Communication | `notifications` (notifications) | user FK SET NULL | outbox status machine QUEUED→SENDING→SENT/FAILED/SKIPPED |
| Consent | `consent_logs` (consent) | never; revocation via `revoked_at` | RESTRICT user FKs |

Cross-module writes (complete list, all deliberate):

1. `exams` → `student_profiles.current_belt_rank_id` on RESULT_PASS (promotion), inside the
   result-entry transaction (AD-08; regression-gap defect G-2 belongs to TASK-02/04).
2. `exams` → creates `invoices`/`invoice_items` rows via BillingService (exported for reuse).
3. `billing` → outbox rows via NotificationsModule (invoice notification hook).
4. Read-side policy reuse: `StudentOwnershipService` (§6).

Database-level reconciliation (races G-3, rank-regression G-2, constraint inventory) is owned by
**TASK-02**; the architecture-level rule stands: *idempotent operations must be backed by unique
constraints, not only application checks* (contract §6).

## 10. Authorization Boundary

Four enforcement layers, all server-side:

1. **Authentication** — `JwtAuthGuard`: HS256 signature, jti denylist (logout), `pwd_version`
   staleness, account state, session state (`src/auth/guards/jwt-auth.guard.ts:27-61`).
2. **Role authorization** — `RolesGuard` + `@Roles(...)`. Invariant (verified per route by
   TASK-00 and re-affirmed): **every route without `@Roles` is either self-scoped or
   service-guarded** (ownership guard / webhook HMAC). New endpoints must carry explicit
   `@Roles` (contract §5).
3. **Object ownership** — `StudentOwnershipService` (guard 7.3): ADMIN full; STUDENT self;
   PARENT verified link; INSTRUCTOR currently-enrolled-in-own-class. Violation → **404, never
   403** (anti-probing). Applied on every student-scoped route.
4. **Field-level serialization** — plan §7.4 matrix (INSTRUCTOR loses address/phone/emergency
   contact and all invoice/payment visibility; medical notes visible to all four roles).

Plus route-level special postures: public webhook with HMAC-over-raw-body integrity; global
per-IP throttler with IPv6 /64 bucketing; metrics bearer-token-only.

Permission shape (condensed from audit §B inventory):

| Area | ADMIN | INSTRUCTOR | STUDENT | PARENT |
|---|---|---|---|---|
| Student CRUD | full | list/read own-class (no contact fields) | self read | via verified links (children) |
| Classes/schedules | write | read | read | read |
| Enrollment | write | — | — | — |
| Attendance sessions/records | write | write own class | read self (guard) | read child (guard) |
| Belts | write | read | read | read |
| Exams | CRUD + result entry | result entry | register (self/child via guard) | register for child |
| Invoices/payments | full | **none** (AD-06) | own (guard) | children's (guard) |
| Notifications/consent | admin flush | self-scoped | self-scoped | self-scoped + consent proxy |

Approved corrections to this boundary (target state, implemented in later tasks — no change in
TASK-01): INSTRUCTOR financial surface becomes **zero** (AD-06 → TASK-03); ADMIN MFA enforcement
(TASK-05); proxy-throttle key hardening (TASK-05/06).

## 11. External Integration Boundary

All external providers sit behind **ports** (interfaces) owned by the consuming module; adapters
are additive, never fabricated, and fail fast when unconfigured (contract §8):

| Port | Location | Current adapter | Production adapter | Owner task |
|---|---|---|---|---|
| `MAIL_PORT` | `src/auth/mail/mail.port.ts` | `LoggingMailSender` (pino; `MAIL_LOG_FILE` footgun P3-4) | SMTP (nodemailer) | TASK-04 |
| `PaymentGatewayPort` | `src/billing/payment-gateway.port.ts` | `SimulatedGateway` (HMAC, dev/e2e only) | payOS **or** SePay (one primary channel, plan §7.5) | TASK-04 (adapters) + TASK-05 (prod guards: forbid `simulated`, require webhook secret) |
| `ZNS_SENDER_PORT` / `SMS_SENDER_PORT` | `src/notifications/notification-senders.port.ts` | stubs throwing `UnconfiguredChannelError` (fallback chain degrades to EMAIL) | Zalo ZNS / eSMS | TASK-04, after the two above |
| `SharedStore` | `src/common/` | in-memory Map + TTL sweeper | unchanged (Redis only on measured scale-out — DD-03) | — |

Inbound-only integration: the payment webhook (`POST /payments/webhook/:provider`) — signature
verified over exact raw bytes; there is no user-controlled outbound fetch (SSR posture, plan
§4.4). Completion ordering per audit §F: **SMTP → real payment gateway → ZNS/SMS**.

## 12. Background Processing Architecture

Three in-process interval jobs (all unref'd timers, idempotent, graceful-shutdown-aware):

| Job | File | Cadence | Semantics |
|---|---|---|---|
| Notification outbox worker | `src/notifications/notification-outbox.service.ts` | 30 s poll | claim-first `QUEUED→SENDING`; stale-SENDING recovery after 10 min; bounded retry/backoff (5 attempts); fallback chain ZNS→SMS→EMAIL; INAPP delivered at insert |
| Used-token purge | `src/auth/used-token.purge.ts` | 6 h | deletes expired single-use tokens |
| Overdue-invoice aging | `src/billing/overdue-invoice.job.ts` | 24 h | UNPAID → OVERDUE past `due_date` (OVERDUE never regresses) |

Shared in-memory state (`SharedStore`): jti denylist, login lockout, per-account mail budgets —
TTL-swept, single-instance by design (plan §3: "Redis none, phase 1").

**Decision: keep in-process workers; no Redis, no external queue, no scheduler service**
(AD-11). Documented constraint: a second app instance would diverge `SharedStore` state and
double-run jobs (idempotent, but wasteful); horizontal scale-out is explicitly out of scope
until measured necessity exists (DD-03). For the thesis target (~300 users, one club, single
instance) this is not a defect.

## 13. Business Workflow Ownership

Canonical owner, entities, authorization, transaction boundary, audit, and historical-data
requirements for each major flow. (Audit requirement: audit events already exist for
auth/login/failed, password/MFA events, student link events, invoice issuance, payment
confirmations, belt/exam events — verified in sessions 5–15 logs.)

### 13.1 Student flow — registration → approval → profile → enrollment → schedule → attendance → tuition → payment

| Step | Owner | Entities | Authorization | Transaction / integrity | Audit & history |
|---|---|---|---|---|---|
| Account registration | `auth` | `users` | public; minors cannot self-register (S-06) | uniform anti-enumeration responses; verify token single-use (`used_tokens`) | auth events |
| Approval (adults) | `students` (ADMIN) | `student_profiles.status` PENDING→ACTIVE | ADMIN | PATCH status; admin-created profiles are ACTIVE on create (audit E — accepted; a PENDING-approval endpoint is optional polish, TASK-03) | student events |
| Profile | `students` | `student_profiles` | ADMIN; self via guard 7.3 | soft delete only | — |
| Enrollment | `classes` (enrollments) | `enrollments` | ADMIN | capacity + same-day guards; UQ key | — |
| Schedule | `classes` | `class_schedules` | read any-authenticated; write ADMIN | start<end, effective-range validation | — |
| Attendance | `attendance` | `attendance_sessions`, `attendance_records` | ADMIN + own-INSTRUCTOR | `UQ(class,date)`, `UQ(session,student)` upsert | historical record |
| Tuition | `billing` | `invoices`, `invoice_items` | ADMIN generate; role-scoped reads | `UQ(student,type,period)` idempotent monthly close | invoice.issued |
| Payment | `billing` (payments) | `payment_transactions` | STUDENT/PARENT (own/child) + ADMIN (AD-06) | claim-first webhook idempotency; settlement in one transaction | payment.* |

### 13.2 Parent flow — parent account → verified student relationship → allowed student access

Account: `auth` (PARENT self-registration, email verify). Relationship: `parents` — invite-code
link created at profile creation, single-use, rotated on demand; `verified=true` only via
`POST /parents/link` with the code; raw student ids never accepted. Access: all child-scoped
reads (profile, attendance, invoices, exam registration) flow through the PARENT clause of guard
7.3 + full-field serializer view. Unlink: self-service only while unverified; verified unlink is
a club action. Consent proxy: `consent` writes `consented_by_user_id` for minors.

### 13.3 Training flow — class → schedule → enrollment → attendance session → attendance record

Owner split: `classes` owns class/schedule/enrollment state; `attendance` owns session/record
state. `attendance` imports `ClassesModule` (class-state guard: no new sessions for
PAUSED/ARCHIVED classes) and `StudentsModule` (guard 7.3) — ownership of data stays
module-separated while the policy is shared. Integrity anchors: `UQ(class_id, session_date)`
(one session per class per day), bulk upsert keyed `UQ(session, student)`. Records are the
historical training record; corrections are overwrites by business key, never row deletion.

### 13.4 Belt flow — belt rank → exam → registration → payment → result → promotion

`belts` owns the rank catalog (15 seeded ranks, never deleted). `exams` owns exam lifecycle
(DRAFT→OPEN→CLOSED/COMPLETED/CANCELLED, deadline + capacity + rank-regression-at-registration
checks). Registration is **atomic**: exam slot check + `exam_registrations` row + EXAM_FEE
invoice in one transaction (imports BillingService). Payment follows the billing flow (§13.5);
result entry is allowed for PENDING_PAYMENT or PAID registrations (club collects cash offline —
session 13 decision). Result entry is final (409 on re-entry), examiner-attributed; RESULT_PASS
promotes `student_profiles.current_belt_rank_id` in the same transaction. Known defect: result-
time rank regression (G-2) — TASK-02/04, not an architecture change.

### 13.5 Billing flow — invoice → payment initiation → QR → webhook/confirmation → settlement → reporting

Owner: `billing` (one module, two services: `BillingService` invoices, `PaymentsService`
payment processing). Chain: invoice issuance (`invoice_no` sequential per year, P2002 retry) →
QR initiation (PENDING transaction, `order_ref` "VV"+8, 30-min expiry, bank-account
`owner_type=BUSINESS` guard) → gateway `createPayment` via port → webhook (public, HMAC over raw
body, claim-first `gateway_txn_id` idempotency, duplicate/parallel → processed once, always 200
post-signature) → settlement (SUCCESS-sum ≥ total ⇒ invoice PAID, single transaction; amount
mismatch ⇒ DISPUTED + flagged, never PAID) → alternative CASH confirmation (ADMIN, claim-first
on invoice flip) → revenue report (SUCCESS by month/channel). Refund/dispute re-derives invoice
to UNPAID; OVERDUE never regresses. Known defects (401-on-malformed-webhook contradicting
always-200; missing reconciliation aid) belong to TASK-03/05 — behavior fixes, not architecture.

### 13.6 Club activities flow — announcement → audience targeting → notification/feed

Owner: a **new `announcements` module** (AD-07), built to the already-specified design (plan
§6: `announcements` table with `audience ENUM(ALL,CLASS)`, `class_id FK`; plan §8: ADMIN
CRUD + role-scoped reads). Audience resolution derives from existing relationship data only —
ALL audience → every authenticated user; CLASS audience → users with a legitimate class
relationship (enrolled student via own profile, parent via verified child link, instructor via
`classes.instructor_id`); **no new relationship tables are needed**. Delivery: the announcement
read API is the primary thesis feed; optional per-user INAPP fan-out through the existing
notifications outbox (plan §7.6 "club announcements" template) is an extension decision for
TASK-04. The `notifications` module remains a delivery channel and must not absorb the
announcement domain (different lifecycle: curated content vs delivery records).

## 14. Thesis Core vs Production Hardening

Classification of every current/planned feature (nothing is removed; audit §C found nothing to
remove):

| Classification | Features |
|---|---|
| **THESIS CORE** (the defense demonstrates these) | Auth essentials (register/verify/login/refresh/logout) + 4-role RBAC + ownership guard + serializer; student management incl. minors + parent linking; classes/schedules/enrollment; attendance; belt ranks; belt exams + registration + results + promotion; invoices + monthly tuition close; QR payment flow (architecture complete; **real-gateway demo is required for full thesis credit** — see below); **club-activity announcements (missing — AD-07)**; INAPP notification feed; unit/e2e/security test tiers; deployment trial |
| **SUPPORTING DOMAIN** (keep; secondary to defense narrative) | TOTP MFA stack, session management/revocation, audit trail, consent module (Decree 13 posture), notification outbox + EMAIL/ZNS/SMS channels, revenue report, schedules DELETE lifecycle |
| **PRODUCTION HARDENING** (keep; not thesis-scoring) | SMTP adapter; real payOS/SePay integration; prod config guards (forbid `simulated` in prod, require webhook secret — I-3); ADMIN MFA enforcement (I-1); backup/DR + restore drills; deploy pipeline completion (release migrations, deploy hook, smoke); runbooks (OPERATIONS/SECURITY); reconciliation report; Sentry; k6/Bruno UAT; throttle-key/proxy hardening (I-4) |
| **OPTIONAL EXTENSION** | Per-student aggregated schedule endpoint (H-3, DD-02); CSV export; oasdiff breaking-change gate; README/schema-comment staleness cleanup (L-4, L-9) |
| **OUT OF SCOPE** | Plan §16 list (§2 above): multi-tenant, OAuth/passkeys, Zalo Mini App/mobile, payroll, inventory, tournaments, e-invoice gateway, Redis/horizontal scaling, attendance analytics |

Notes:

- The **simulated gateway suffices for architecture demonstration but not for the thesis QR
  requirement** (audit J-3): a real sandbox payment (QR → webhook → PAID) is P4's own acceptance
  criterion and needs payOS/SePay credentials — an owner/credential dependency, sequenced
  TASK-04.
- "Deployment trial" (thesis requirement 9) is undemonstrated (K-3): deploy job is a stub; this
  is a TASK-06 deliverable plus owner cloud setup — a scope gap, not an architecture gap.

## 15. Current Architecture Findings

Reconciled from TASK-00 and re-verified here; filtered to architecture-level statements.
Defect-level findings (G-2, G-3, H-5, P3-x) are **not** architecture problems and keep their
assigned task owners (§18).

- **AF-1 — Modular monolith is appropriate. KEEP.** ~300 users, one club; module map is clean and
  acyclic; layer rules hold; 271/271 unit + 68/68 e2e green on the audited tree. No structural
  rework warranted (AD-01).
- **AF-2 — Ports are consistently applied** across mail, payment gateway, ZNS/SMS, SharedStore —
  real adapters are additive swaps (AD-10).
- **AF-3 — Single-instance assumptions are documented and acceptable** (SharedStore state,
  per-instance interval jobs) but constrain scale-out (§12, AD-11, DD-03).
- **AF-4 — Contract discipline is a process gap, not an architecture gap**: committed
  `openapi.json` (71 ops) lacks the uncommitted P5 endpoints (verified: zero
  notification/consent paths); the regenerate-in-same-commit lesson (session 14) is currently
  violated by the working tree (AD-13).
- **AF-5 — The only domain-boundary gap vs the thesis is `announcements`** (primary value 3).
  Design already specified in plan §6/§8; adopted without modification (AD-07).
- **AF-6 — One authorization-policy inconsistency**: INSTRUCTOR can initiate QR payments
  (`billing.controller.ts:77-78` carries no `@Roles`) while being excluded from every
  invoice/payment read (404 posture, plan §7.4 "invoices: INSTRUCTOR = none"). Resolved by
  policy decision AD-06; implementation is TASK-03.
- **AF-7 — Layer rules hold with two documented exceptions**: `readyz` DB probe in the health
  controller (ops, deliberate) and type-only `AuthenticatedUser` imports in services (no runtime
  HTTP dependency). No violations requiring change.
- **AF-8 — The outbox worker is architecturally sound** (claim-first, bounded retry, fallback,
  stale recovery) — pattern approved for reuse by announcement fan-out if chosen (AD-07).
- **AF-9 — No module-boundary pathologies**: no overlapping/duplicated responsibilities, no
  circular dependencies, one shared policy service (`StudentOwnershipService`), cross-module
  writes are few and enumerated (§9, AD-08).
- **AF-10 — Deployment architecture is designed but undemonstrated** (image builds; no release
  migration wiring, no staging/prod, no backup/DR evidence) — TASK-06 + owner.
- **AF-11 — Plan §3's `users/` module never existed; `auth` absorbed it** (audit L-8) — accepted
  drift; the module map in §7 is authoritative over plan §3's layout sketch.

### 15.1 TASK-00 P1 issue classification (blocker triage)

| P1 | Classification | Rationale / owner |
|---|---|---|
| P1-1 (P5 uncommitted + stale `openapi.json`) | **Task-order issue — NOT a prerequisite blocker** | The architecture baseline can and does include the P5 modules: they are in the working tree, green (18 e2e), and structurally consistent with the approved architecture. Landing them (branch `phase/5-notifications-consent` → regenerate `openapi.json` → PR → merge) is a git/process step requiring **code changes, which TASK-01 forbids**. It must happen at the next code-touching session, before any commit that depends on a current contract. It does not gate TASK-02 (design task reading the working tree). |
| P1-2 (ADMIN MFA enforcement absent) | **Defect belonging to TASK-05** | Guard architecture already supports enforcement (JWT pipeline, TOTP stack complete); no architectural prerequisite. |
| P1-3 (SMTP adapter missing) | **Defect belonging to TASK-04** | Port/adapter boundary is exactly the approved pattern; additive adapter work. |
| P1-4 (no real gateway + prod guards) | **Defect belonging to TASK-04 + TASK-05** | Port design correct; adapters + env-guard rules are scoped implementation. |

None of the P1s blocks architecture reconciliation; none is solved inside TASK-01.

## 16. Approved Architecture Decisions

### AD-01 — Keep the modular monolith

- **DECISION**: Single NestJS 11 deployable (Express adapter), REST `/api/v1`, PostgreSQL 16 via
  Prisma, in-process workers. No microservices, no service mesh, no new runtime components.
- **RATIONALE**: Scale (~300 users, one club) never justifies distribution; module boundaries are
  clean and acyclic; the team's Handler-Service-Repository model maps 1:1; thesis demo and
  deployment-trial simplicity favor one artifact; zero structural defects found.
- **EVIDENCE**: `src/app.module.ts` (13 feature modules + shared infra, no cycles); audit §F
  verdict; contract §1/§14; test evidence 271/271 unit, 68/68 e2e (audit, verified 2026-09-15).
- **IMPACT**: None — no migration, no API change, no deployment change.
- **STATUS**: APPROVED.

### AD-02 — Actor/role model: keep 4 roles; Võ sư is a persona, not a role

- **DECISION**: `ADMIN / INSTRUCTOR / STUDENT / PARENT` remains the complete authorization role
  set. No `VÕ SƯ`/`MASTER` role is added. Võ sư operates through ADMIN (club + money) and is
  recorded as examiner via `exam_registrations.examiner_id` where the thesis narrative needs
  "the master grades". Võ sinh = STUDENT role (adults) + `StudentProfile` domain row (all,
  incl. minors without accounts).
- **RATIONALE**: ADMIN ⊇ INSTRUCTOR permissions on every route (verified), so an ADMIN account
  loses the Võ sư nothing. A fifth role would require enum + migration + permission/serializer
  matrix + guard + seed + test changes for zero authorization-expression gain — no thesis use
  case needs "more than instructor, less than admin". Single-role-per-user is already an
  accepted limitation (plan §2).
- **EVIDENCE**: `prisma/schema.prisma:17-23` (enum), `:486-487` (examiner FK); plan §2, §7.4;
  audit §D; route-by-route role inventory (audit §B, re-verified for this decision).
- **IMPACT**: None (documentation). Downstream TASK-03 keeps the serializer/guard behavior;
  TASK-02 keeps `UserRole` unchanged.
- **STATUS**: APPROVED (alias/display-name option deferred — DD-01).

### AD-03 — PARENT remains a supporting actor role

- **DECISION**: Keep PARENT as the fourth authorization role.
- **RATIONALE**: Minors cannot self-register (thesis requirement 10 + Children Law 2016 posture,
  plan §7.1); parents register exams, view children's data through verified links, and proxy
  consent (`consent_logs.consented_by_user_id`). Removing it would break the minor flow — the
  club's actual population includes minors.
- **EVIDENCE**: `parent_student_links` model + invite-code flow; PARENT clauses in
  `student-ownership.service.ts`; S-01/S-06 regression tests; consent proxy design (plan §10).
- **IMPACT**: None.
- **STATUS**: APPROVED.

### AD-04 — Layer model and rules reaffirmed

- **DECISION**: The four-layer model of §8 stands; controllers stay Prisma-free (with the
  `readyz` probe as the single documented ops exception); services stay HTTP-free; shared
  infrastructure stays in `common`/`config`/`prisma`/`logging`.
- **RATIONALE**: Verified compliance; the two exceptions are deliberate and harmless; rule
  changes would be churn without defect.
- **EVIDENCE**: Layer greps (§8); `src/health/health.controller.ts:18`; type-only
  `AuthenticatedUser` imports in all 9 consuming services.
- **IMPACT**: None.
- **STATUS**: APPROVED.

### AD-05 — Module boundaries adopted as authoritative

- **DECISION**: The §7 matrix is the authoritative module responsibility map; plan §3's repo
  layout sketch (incl. the never-existing `users/` module) is superseded by it.
- **RATIONALE**: Source of truth is the code; the matrix matches it and gives TASK-02…04 a
  stable placement rule ("one table, one owning module"; new domain → new module).
- **EVIDENCE**: §6/§7; dependency graph; audit L-8.
- **IMPACT**: Documentation only; TASK-02/TASK-03 must place the announcements module per AD-07.
- **STATUS**: APPROVED.

### AD-06 — INSTRUCTOR financial authorization policy: zero financial surface

- **DECISION**: The money domain is accessible to ADMIN (backoffice), STUDENT (self), and PARENT
  (verified children) only. INSTRUCTOR must be excluded from **payment initiation** as it already
  is from invoice/payment reads. Target route shape: `POST /payments/qr/:invoiceId` →
  `@Roles('ADMIN','STUDENT','PARENT')` (ownership guard unchanged). **No code change in
  TASK-01**; implementation + regression test + openapi regen owned by TASK-03.
- **RATIONALE**: Plan §7.4 defines invoices as invisible to INSTRUCTOR; the current QR-initiation
  route leaks invoice existence/amount to instructors and contradicts the thesis split
  (instructors run training, not money). The missing `@Roles` is an oversight (RolesGuard admits
  unannotated routes), not a designed exception — nothing in plan §7.5/§8 grants it.
- **EVIDENCE**: `src/billing/billing.controller.ts:77-78` (no `@Roles`) vs
  `billing.service.ts` 404 posture for instructors (audit H-2); plan §7.4 matrix; audit P2-2.
- **IMPACT**: One decorator + contract regeneration + e2e assertion in TASK-03; no schema, no
  workflow change.
- **STATUS**: APPROVED (policy); implementation deferred to TASK-03.

### AD-07 — Club activities: new `announcements` module, plan §6/§8 design adopted

- **DECISION**: Announcements is a distinct core-domain module, not a notifications feature.
  Schema per plan §6 (`title`, `body`, `audience ENUM(ALL,CLASS)`, nullable `class_id`,
  `published_at`, `created_by`); endpoints per plan §8 (ADMIN CRUD; `GET /announcements`
  role-scoped). Audience resolution from existing relationship data (§13.6); no new relationship
  tables. Primary delivery = announcement read API; optional INAPP outbox fan-out decided in
  TASK-04. **TASK-01 makes no schema change** — the schema decision is ratified for TASK-02,
  implementation for TASK-04.
- **RATIONALE**: Thesis primary value 3 is unimplemented (audit C-3/G-1 — the only domain gap);
  a complete, reviewed design already exists in the plan and should be reused, not reinvented;
  the notifications table is user-scoped delivery state with no audience concept — folding
  announcements into it would blur a curated-content domain into a delivery domain.
- **EVIDENCE**: PLAN.md §6 `announcements` table, §8 endpoints row, §7.6 template; audit C-3,
  G-1, F-2 (recommendation to decide design before building).
- **IMPACT**: TASK-02: one new table + migration (24→25 tables); TASK-03: 4 endpoints + openapi;
  TASK-04: implementation + tests. No existing table or endpoint changes.
- **STATUS**: APPROVED (design ratified; build sequenced TASK-02 → TASK-03 → TASK-04).

### AD-08 — Data ownership: one owning module per table; enumerated cross-module writes

- **DECISION**: §9's ownership map is binding. The only permitted cross-module **writes** are
  the four enumerated there (promotion write, exam→invoice creation, billing→outbox hook, plus
  audit emission via the shared audit service). Read-side policy is shared through
  `StudentOwnershipService`. New cross-module writes require a baseline amendment.
- **RATIONALE**: Prevents the monolith from decaying into an entangled ball; every existing
  cross-module write has a transactional justification (atomicity of exam registration and
  settlement).
- **EVIDENCE**: §9 table; module import graph; `exams.service.ts` result transaction (audit
  G-2 evidence site).
- **IMPACT**: TASK-02 reviews constraints per table; the promotion-write defect (G-2) is fixed
  in place, not re-owned.
- **STATUS**: APPROVED.

### AD-09 — Authorization boundary invariants

- **DECISION**: The four enforcement layers (§10) are binding invariants: (a) every route
  carries explicit `@Roles` **or** a documented self-scoped/service-guarded justification;
  (b) student-scoped access always passes guard 7.3 with the 404 posture; (c) field exposure
  follows the §7.4 matrix and may only change with that matrix + tests; (d) authorization is
  server-side only.
- **RATIONALE**: These invariants are what the security test suite (S-01/S-04/S-06/S-07/S-12)
  actually locks in; loosening any of them silently invalidates regression coverage.
- **EVIDENCE**: `jwt-auth.guard.ts`, `roles.guard.ts`, `student-ownership.service.ts`,
  `serialize-student.ts`; contract §4/§5/§7.
- **IMPACT**: TASK-03 must preserve invariants while applying AD-06; TASK-05 adds MFA
  enforcement **within** this boundary (no new mechanism).
- **STATUS**: APPROVED.

### AD-10 — External integrations stay behind ports; completion order fixed

- **DECISION**: Keep the port/adapter inventory of §11. Adapter completion order: SMTP adapter →
  real payment gateway (payOS or SePay — exactly one primary channel per plan §7.5) → ZNS/SMS.
  Production guard rules (forbid `simulated` in prod, require webhook secret) belong to
  TASK-05.
- **RATIONALE**: Ports verified consistently applied; additive adapter work is the lowest-risk
  path to the two blocking thesis needs (deliverable email, real QR demo); ordering follows the
  audit's dependency analysis (email verification is load-bearing for every account flow).
- **EVIDENCE**: `mail.port.ts`, `payment-gateway.port.ts`, `notification-senders.port.ts`;
  audit F-1, §N sequencing; I-2/I-3/J-3.
- **IMPACT**: No boundary change; TASK-04 implements adapters, TASK-05 the guards.
- **STATUS**: APPROVED.

### AD-11 — Background processing stays in-process

- **DECISION**: Keep the three in-process jobs and in-memory SharedStore (§12). No Redis, no
  BullMQ/external broker, no scheduler service for the thesis.
- **RATIONALE**: Contract §1 default; plan §3 explicit decision; idempotent jobs + single
  instance make external infrastructure pure overhead at club scale; scale-out need is
  hypothetical and must be measured first (DD-03).
- **EVIDENCE**: `notification-outbox.service.ts`, `used-token.purge.ts`,
  `overdue-invoice.job.ts`, `shared-store.ts`; plan §3; audit F-2/F-4, P3-3.
- **IMPACT**: None. Constraint recorded in §18 (R-1).
- **STATUS**: APPROVED.

### AD-12 — Thesis scope classification adopted

- **DECISION**: §14's five-way classification is binding for remaining tasks: THESIS CORE is
  what TASK-02…04 must complete (announcements + real-gateway QR demo + landing P5);
  PRODUCTION HARDENING is TASK-05/06; OPTIONAL EXTENSION requires explicit task justification;
  OUT OF SCOPE stays out. No removal of existing features.
- **RATIONALE**: Keeps the remaining schedule honest about what the defense needs versus what
  real deployment needs; prevents hardening from displacing the missing thesis core
  (announcements).
- **EVIDENCE**: §14 table built from audit §C/§D/§I/§J/§K + plan §16.
- **IMPACT**: Sequencing guidance for TASK-02…06.
- **STATUS**: APPROVED.

### AD-13 — TASK-00 P1-1 classified as task-order, not architecture blocker

- **DECISION**: P1-1 (uncommitted P5 + stale contract) is handled as a git/process step at the
  next code-touching session (branch → `npm run openapi:generate` → `contract:lint` → PR →
  merge). It is not solved in TASK-01 (documentation-only task) and does not block TASK-02.
- **RATIONALE**: See §15.1; the baseline covers the P5 architecture, so reconciliation proceeds;
  the fix requires code changes TASK-01 forbids.
- **EVIDENCE**: git status (untracked `src/notifications/`, `src/consent/`, migration, e2e spec);
  committed `openapi.json` contains zero notification/consent paths (verified by parse); audit
  P1-1, L-3, §N.
- **IMPACT**: Next code session must land P5 first; contract-gate would fail otherwise.
- **STATUS**: APPROVED (classification only).

## 17. Deferred Architecture Decisions

| ID | Decision | Trigger / owner | Why deferred |
|---|---|---|---|
| DD-01 | Literal `VÕ SƯ` representation (display title/alias on ADMIN, or a `MASTER` alias role) | Only if the thesis council requires literal actor fidelity | AD-02 covers all functional needs; alias is presentation-layer, zero security content |
| DD-02 | Per-student aggregated schedule endpoint (`GET /students/me/schedule`-style) | TASK-03, optional (P3) | Thesis value 1 is served by the catalog today; the aggregated read is a UX strengthening, not a boundary change (audit H-3) |
| DD-03 | SharedStore → Redis swap; out-of-process workers | Only on measured scale-out necessity (contract §10: baseline first) | Single instance is the approved target; in-memory state is documented (R-1) |
| DD-04 | Webhook malformed-payload 401 → 200 normalization (anti-retry) | TASK-03/05 | Behavior defect (H-5/J-2), inside the existing boundary; no architectural decision needed |
| DD-05 | Mechanism for result-time rank-regression prevention (DB constraint vs service re-validation) | TASK-02 (decides), TASK-04 (implements) | Architecture ratifies the ownership (§13.4); the mechanism is a database-reconciliation outcome |
| DD-06 | Sentry wiring; UptimeRobot; external alerting | TASK-05/06 + owner accounts | Optional observability; no boundary impact |
| DD-07 | Multi-instance deployment; oasdiff breaking-change gate; consolidated 12-case security suite/k6/Bruno artifacts | TASK-06 (as applicable) | Hardening/verification packaging, not architecture |

## 18. Architecture Risks

| ID | Risk | Severity | Mitigation / owner |
|---|---|---|---|
| R-1 | Single-instance state (SharedStore, per-instance jobs) blocks naive horizontal scale-out | Accepted (documented constraint) | DD-03 trigger only with measured need; deployment stays single-instance (AD-11) |
| R-2 | Result-time rank regression (stale PASS downgrades a belt) | Medium (data integrity, thesis-visible) | TASK-02 mechanism (DD-05), TASK-04 fix + regression test |
| R-3 | Check-then-act races (exam capacity, enrollment capacity, invite-code rotation) under READ COMMITTED | Medium (low probability at club scale, but overbooking is thesis-visible) | TASK-02: DB constraints/transactional fixes (audit P2-4) |
| R-4 | Contract discipline drift (openapi regenerated late) | Medium (process) | AD-13 landing step + existing contract-gate; lesson already recorded (session 14) |
| R-5 | Deployment trial undemonstrated (no staging/prod, no release migrations, no backup/DR evidence) | Medium (thesis activity + go-live risk) | TASK-06 + owner cloud/credentials (audit K-2…K-4, P2-6) |
| R-6 | Cross-module write pattern spreads (new services writing other modules' tables ad hoc) | Low (discipline risk) | AD-08: enumerated writes only; baseline amendment required for additions |
| R-7 | Announcements built ad hoc, diverging from plan §6 design or coupling to notifications | Low (design risk) | AD-07 fixes the design + module placement before TASK-02/04 build it |
| R-8 | Throttle bucket key spoofable behind a single appending proxy | Low–Medium (deployment-dependent) | TASK-05/06 (I-4); document proxy requirement or pin `request.ip` |
| R-9 | Real QR gateway blocked on owner credentials (payOS/SePay) | External dependency | TASK-04 adapters ready first; simulated gateway remains dev/e2e-only; prod guard in TASK-05 |

## 19. Traceability to Thesis Requirements

Every thesis requirement maps to architecture elements and decisions:

| # | Thesis requirement | Architecture element(s) | Decisions |
|---|---|---|---|
| 1 | Students view class schedules | classes module (catalog); optional aggregated read (DD-02); students module (profile→enrollment→class resolution) | AD-05, DD-02 |
| 2 | Students view tuition | billing module role-scoped invoice reads; serializer rules | AD-05, AD-09 |
| 3 | Students view club activities | **new announcements module**; notifications as optional delivery channel | **AD-07** |
| 4 | Admin manages club operations | ADMIN role as backoffice superset; students/classes/enrollments/belts/exams/billing admin ops; revenue report | AD-02, AD-05, AD-12 |
| 5 | Instructor manages training operations | INSTRUCTOR role + own-class ownership clause; attendance module; exam result entry | AD-02, AD-09 |
| 6 | QR payment | billing/payments + `PaymentGatewayPort`; webhook integrity chain; real adapter = thesis-demo requirement | AD-10, AD-12 |
| 7 | Role-based authorization | 4-role RBAC + guards + ownership + serializer (§10) | AD-02, AD-03, AD-06, AD-09 |
| 8 | Testing | three-tier suite (unit/e2e/security), coverage floors, contract-gate, migration-dry-run | AD-01, AD-04 |
| 9 | Deployment trial | Docker image, CI gates, deploy pipeline (completion TASK-06 + owner) | AD-01, AD-12 |
| 10 | Student management incl. minors | students + parents modules; invite-code verified links; PARENT role; consent proxy; soft delete | AD-03, AD-08 |

Stack traceability: Node.js/TypeScript ✓ (fixed stack, contract §1); React frontend ✓ (separate
project, §5); PostgreSQL ✓; RESTful API ✓ (`/api/v1`); QR △ (architecture complete, real-gateway
demo pending credentials — R-9); role-based authorization ✓.

Actor traceability: Admin→ADMIN; Võ sư→ADMIN persona + examiner attribution (AD-02);
Huấn luyện viên→INSTRUCTOR; Võ sinh→STUDENT/StudentProfile (AD-02); Parent→PARENT supporting
actor (AD-03).

---

## Suitability for TASK-02

TASK-02 (Database Reconciliation) receives from this baseline: the binding table-ownership map
(§9), the ratified-but-unbuilt `announcements` table design (AD-07 → 25-table target), the
constraint-integrity rule for idempotent operations (§9), the defect list it owns (G-2 rank
regression, G-3 races, invite-code rotation P3-5 — mechanisms deferred DD-05), and the
classification that P1-1 does not block it. TASK-02's verdict space (KEEP / KEEP WITH TARGETED
MIGRATIONS / MAJOR REDESIGN) is pre-informed by AF-1: the expected verdict is **KEEP WITH
TARGETED MIGRATIONS** (announcements table + race-constraint fixes), with no evidence for a
major redesign.
