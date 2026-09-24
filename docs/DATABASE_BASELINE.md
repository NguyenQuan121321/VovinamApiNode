# VovinamApiNode — Database Baseline (TASK-02)

Baseline date: 2026-09-15. Status: **APPROVED** — authoritative database baseline for the thesis.
Produced by TASK-02-DATABASE-RECONCILIATION.

**DATABASE VERDICT: B — KEEP CURRENT DATABASE + TARGETED MIGRATIONS.**

The existing PostgreSQL 16 / Prisma 6 schema satisfies the thesis requirements and the approved
architecture (`docs/SYSTEM_ARCHITECTURE_BASELINE.md`). Exactly **one schema change** was proven
necessary and implemented: the `announcements` table ratified by AD-07 (the only domain gap,
thesis primary value 3 "club activities"). No existing table was modified, merged, split, or
removed — no evidence justified a destructive change. Total tables: **25** (24 domain +
`_prisma_migrations`).

Method: full inspection of `prisma/schema.prisma`, all 7 migrations, `prisma/seed.ts`, and the
services that own every write path (students, parents, classes/enrollments, attendance, belts,
exams, billing/payments, notifications outbox, consent, audit); DTO validation constraints; the
ownership guard; and the committed OpenAPI contract. Concurrency claims below are traced to the
actual transaction/query code, not assumed. Migration replay was verified against an empty
disposable PostgreSQL 18 database this session (see §15).

Inputs: `docs/CURRENT_STATE_AUDIT.md` (TASK-00), `docs/SYSTEM_ARCHITECTURE_BASELINE.md`
(TASK-01, binding for TASK-02 per its §"Suitability for TASK-02"), `docs/PLAN.md` §5.2/§6/§7/§8,
`.agents/prompts/00-global-contract.md` §6.

---

## 1. Database Purpose

One PostgreSQL database stores **all operational data of one legally registered Vovinam club**:
accounts and sessions for four roles, student profiles (including minors without accounts),
verified parent-child links, classes with weekly schedules, enrollment, attendance history, belt
ranks, belt exams and their registrations, tuition/exam-fee invoices with line items, QR/cash
payment transactions, outbound notification delivery state, per-purpose consent records, club
activity announcements, and a key-value application configuration. It is accessed **only** by the
NestJS application through Prisma (single data path, architecture baseline §4); no other component
touches it.

Design pillars (verified in place):

1. **Financial records are immutable and never hard-deleted** (contract §6): FK RESTRICT across
   the money chain, soft delete for people, append-only audit.
2. **Idempotent operations are backed by database unique constraints**, not only application
   checks (contract §6): monthly tuition, webhook settlement, cash confirmation, exam
   registration, parent links.
3. **History survives lifecycle changes**: attendance and exam history outlive enrollment and
   promotion; invoices outlive account deactivation.
4. **VND amounts are integers** — no floating-point money anywhere.

## 2. Domain-to-Table Mapping

| Domain (arch. baseline §6/§7) | Owning module | Tables |
|---|---|---|
| Auth / identity / security | `auth` | `users`, `sessions`, `refresh_tokens`, `totp_credentials`, `recovery_codes`, `used_tokens`, `audit_logs` |
| Configuration | `common`/`config` (seeded, read by billing) | `app_settings` |
| Student | `students` | `student_profiles` |
| Parent link | `parents` | `parent_student_links` |
| Training (classes/schedules/enrollment) | `classes` | `classes`, `class_schedules`, `enrollments` |
| Attendance | `attendance` | `attendance_sessions`, `attendance_records` |
| Belt ranks | `belts` | `belt_ranks` |
| Belt exams | `exams` | `belt_exams`, `exam_registrations` |
| Financial | `billing` | `invoices`, `invoice_items`, `payment_transactions` |
| Communication | `notifications` | `notifications` |
| Consent | `consent` | `consent_logs` |
| Club activities | `announcements` (module: TASK-04) | `announcements` |

Every table has exactly one owning module (AD-08); the only cross-module writes are the four
enumerated in architecture baseline §9 (promotion write, exam→invoice creation, billing→outbox
hook, audit emission) — all verified still true after this reconciliation.

## 3. Canonical Tables

Classification per table. (KEEP = no change; the single ADD is `announcements`.)

### 3.1 Auth / identity

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `users` | **KEEP** | Account for each of the 4 roles; soft delete only | `id UUID` | `email UQ` (anti-enumeration flows rely on it); `role UserRole` enum; `deleted_at`/`is_active` soft delete; `pwd_version` kills old tokens. All child FKs RESTRICT — a user with sessions/audit/financial rows cannot be hard-deleted even by direct SQL mistakes. |
| `sessions` | **KEEP** | One login session (device, ip); list/revoke/logout-all | `id UUID` | FK `user_id` RESTRICT; `@@index(user_id)`; expiry-driven cleanup is a purge of *refresh tokens* — session rows retained for audit value. |
| `refresh_tokens` | **KEEP** | Opaque rotating refresh tokens (SHA-256 at rest) | `id UUID` | `token_hash UQ` (rotation + reuse detection S-08); FKs user/session RESTRICT; revoked flag; expired rows purged by job. |
| `totp_credentials` | **KEEP** | AES-256-GCM sealed TOTP secret per user | `user_id UUID` (PK = FK) | 1:0..1 with users; single row per account. |
| `recovery_codes` | **KEEP** | 10 hashed single-use MFA recovery codes | `id UUID` | `used_at` stamps single use; FK user RESTRICT. |
| `used_tokens` | **KEEP** | Single-use guard for verify/reset/change-email tokens (S-07/S-09) | `jti TEXT` | PK *is* the single-use key: a consumed jti can never be accepted twice; `@@index(expires_at)` drives the purge job (6 h). |
| `audit_logs` | **KEEP** | Append-only audit trail (login, payment, exam, consent, student events) | `id SERIAL` | `@@index(user_id, created_at)` serves `GET /auth/me/audit-log`; `user_id` nullable (system events) with RESTRICT. Never updated or deleted. |

### 3.2 Configuration

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `app_settings` | **KEEP** | Club configuration KV: `tuition_rates` (JSONB map classId→VND), `bank_account` (`owner_type:'BUSINESS'` + bin/number/name) | `key VARCHAR(50)` | JSONB values validated at read sites (`billing.service.ts`, `payments.service.ts`); seeded with safe empty shapes (seed.ts). No update endpoint yet — ADMIN edits before go-live; no migration needed. |

### 3.3 Student / parent

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `student_profiles` | **KEEP** | One row per student (adult WITH account via `user_id`, minor WITHOUT) | `id UUID` | `user_id UQ NULL` — the role-vs-domain split (AD-02); `invite_code UQ CHAR(8)` single-use parent link; `current_belt_rank_id FK SET NULL`; `status StudentStatus`; `deleted_at` soft delete; sensitive contact/medical columns serialized per plan §7.4. |
| `parent_student_links` | **KEEP** | Verified parent↔child relationship created via invite code | `id UUID` | `@@unique(parent_user_id, student_id)` — one link row per pair (both the linkChild duplicate guard AND the DB guard); `invite` flow rotates `student_profiles.invite_code`; both FKs CASCADE (unlink removes the row — the only hard-delete of business rows, deliberately: an unverified link is not history). |

### 3.4 Training

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `classes` | **KEEP** | Training class with instructor, location, capacity, lifecycle | `id UUID` | `instructor_id FK RESTRICT` + index; capacity guarded in service (enroll + shrink check, `classes.service.ts:90-100`); ARCHIVED instead of delete — history preserved. |
| `class_schedules` | **KEEP** | Recurring weekly TIME slots with effective date range | `id UUID` | FK `class_id` CASCADE (schedule is class-owned config, not history — attendance carries history); TIME columns round-trip via `src/classes/time.ts`. |
| `enrollments` | **KEEP** | Append-only enrollment periods; soft leave via `left_at` | `id UUID` | `@@unique(student, class, enrolled_at)` exact-timestamp key tolerates leave/rejoin; same-day rejoin guard is application-level (§8); both FKs RESTRICT — attendance/invoice history can never dangle. |

### 3.5 Attendance

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `attendance_sessions` | **KEEP** | One held lesson: (class, date) | `id UUID` | `@@unique(class_id, session_date)` — one session per class per day at DB level (P2002 → 409 in `attendance.service.ts:66-70`); `instructor_id` attribution RESTRICT+index; FK class RESTRICT. |
| `attendance_records` | **KEEP** | Per-student status for one session; corrections are upsert overwrites, never row deletion | `id UUID` | `@@unique(attendance_session_id, student_id)` — the bulk-upsert business key; FK session CASCADE (records die only if a session dies, which RESTRICTed class FK effectively prevents), FK student RESTRICT, recorder RESTRICT. |

### 3.6 Belts / exams

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `belt_ranks` | **KEEP** | Seeded 15-rank catalog (LAM/VANG 3+3, DO 6, HUYEN 3) | `id SERIAL` | `code UQ`, `order_index UQ` (rank ordering drives regression checks); `is_active` toggles instead of delete; referenced RESTRICT by exams/registrations, SET NULL by profiles. |
| `belt_exams` | **KEEP** | Grading event: target rank, fee, capacity, deadline, lifecycle | `id UUID` | `code UQ` (`EXAM-<year>-<NN>`, generated with bounded retry); `fee_amount INT` VND; `capacity INT NULL` = no cap; FK target rank RESTRICT. |
| `exam_registrations` | **KEEP** | One student per exam; status machine PENDING_PAYMENT→PAID→RESULT_PASS/FAIL; examiner attribution | `id UUID` | `@@unique(exam_id, student_id)` — duplicate registration blocked at DB level; `current_rank_id` is a *snapshot at registration time* (promotion history survives rank changes); FKs RESTRICT (exam, student, target rank), SET NULL (current rank, examiner). |

### 3.7 Financial

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `invoices` | **KEEP** | TUITION / EXAM_FEE / UNIFORM / OTHER charges; never hard-deleted | `id UUID` | `invoice_no UQ` sequential per year (P2002 retry, `billing.service.ts:44-94`); `@@unique(student, type, period_month, period_year)` — monthly-tuition idempotency (NULL periods never collide, so EXAM_FEE stays unlimited, verified semantics); `ref_exam_registration_id` SET NULL links EXAM_FEE to its registration; total/subtotal/discount Int VND; FK student RESTRICT, creator RESTRICT; `@@index(student_id)`, `@@index(status)`. |
| `invoice_items` | **KEEP** | Line items; `amount = quantity × unit_amount` computed by service | `id UUID` | FK `invoice_id` CASCADE — items have no meaning without their invoice and are never referenced elsewhere; deletion of the invoice is impossible anyway (payment FK RESTRICT). |
| `payment_transactions` | **KEEP** | One payment attempt per row: QR (PENDING→settle), CASH, outcomes (REFUNDED/DISPUTED) | `id UUID` | `order_ref UQ` "VV"+8 (transfer-content matching); `gateway_txn_id UQ NULL` — the DB-layer webhook idempotency guard (S-03); `amount INT` VND; FK invoice RESTRICT (an invoice with payments cannot be deleted — none ever is); recorded_by SET NULL (cash attribution); `@@index(invoice_id)`, `@@index(status)`. |

### 3.8 Communication / consent / announcements

| Table | Classification | Business purpose | PK | Key constraints & behavior |
|---|---|---|---|---|
| `notifications` | **KEEP** | Outbox rows: delivery state machine QUEUED→SENDING→SENT/FAILED/SKIPPED + INAPP feed | `id UUID` | `user_id NULL` with **SET NULL** — delivery history survives account removal without blocking it (deliberate difference from the RESTRICT posture of domain data); `@@index(user_id, created_at)` (feed), `@@index(status, next_attempt_at)` (worker claim); `retries`/`next_attempt_at` drive bounded backoff. |
| `consent_logs` | **KEEP** | Append-only purpose-scoped consent; revocation via `revoked_at` | `id UUID` | FKs RESTRICT (subject and acting parent) — consent records are legal-posture data that must never dangle or vanish; `@@index(user_id, purpose)` serves active-consent lookups. |
| `announcements` | **ADD (AD-07)** | Club-activity announcement: ALL-club or per-CLASS audience | `id UUID` | `audience AnnouncementAudience` enum (ALL/CLASS); `class_id` FK **CASCADE** — announcements for a deleted (archived) class have no audience and follow it; `created_by` FK **RESTRICT** (authorship is accountability data); `published_at` default now() = feed ordering stamp; `@@index(class_id)`, `@@index(published_at)`. Audience/`class_id` consistency (CLASS⇒class_id set, ALL⇒null) is enforced by the announcements service (TASK-04) — see §14. |

**Removed / merged / split tables: none.** No current model failed reconciliation; no pair of
tables overlaps enough to merge (notifications vs announcements was explicitly evaluated and
rejected in AD-07: curated content vs delivery records are different lifecycles).

## 4. Canonical Relationships

The eleven required reviews, each traced to the service that exercises it:

| # | Relationship | Cardinality / FK behavior | Justification (evidence) |
|---|---|---|---|
| 1 | User → StudentProfile | 1 : 0..1 (`user_id UQ NULL`) | The role/domain split (AD-02): minors have profiles without accounts; an adult's profile links their STUDENT account. SET NULL on user delete is unreachable in practice (users are soft-deleted; no code path hard-deletes users). `students.service.ts:88-133` (link by email), ownership guard `student-ownership.service.ts:39-41` (self via userId). |
| 2 | Parent → StudentProfile | M : N via `parent_student_links` (UQ pair, CASCADE rows) | Verified links gate every child-scoped read (guard 7.3 PARENT clause, `student-ownership.service.ts:42-47`); children list `parents.service.ts:67-76`; invoices scoping `billing.service.ts:132-137`. CASCADE on rows is correct: a removed link is not history; the *data access* it granted ends. |
| 3 | Student → Enrollment | 1 : N, RESTRICT both ends; append + `left_at` soft leave | Enrollment history and revenue scoping depend on rows never disappearing (`generateMonthly` scans `leftAt: null`, `billing.service.ts:273-284`); attendance is keyed independently so history survives leaving (§10). |
| 4 | Class → Schedule | 1 : N, CASCADE | Schedules are class-owned recurring config, not records of lessons actually taught; DELETE schedule endpoint (`classes.service.ts:129-139`) is the documented lifecycle (session 12). History of taught lessons lives in `attendance_sessions`, which RESTRICTs to the class. |
| 5 | Class → AttendanceSession | 1 : N, RESTRICT; `@@unique(class_id, session_date)` | One held lesson per class per day enforced at DB level; RESTRICT means archived classes keep their full attendance history. Sessions for PAUSED/ARCHIVED classes are blocked in service (`attendance.service.ts:50-52`). |
| 6 | AttendanceSession → AttendanceRecord | 1 : N, CASCADE from session, RESTRICT from student; `@@unique(session_id, student_id)` | The upsert business key (`attendance.service.ts:94-113`) — corrections overwrite by business key, never duplicate rows; student RESTRICT keeps per-student history intact through enrollment changes. |
| 7 | Student → ExamRegistration | 1 : N, RESTRICT; `@@index(student_id)` | Registrations are final (409 on re-entry, `exams.service.ts:246-251`) and must survive promotion (§10). |
| 8 | Exam → ExamRegistration | 1 : N, RESTRICT; `@@unique(exam_id, student_id)` | UQ is the DB guard behind the duplicate-registration 409 (`exams.service.ts:178-184`); RESTRICT keeps exam sheets immutable after COMPLETED. |
| 9 | Student → Invoice | 1 : N, RESTRICT; `@@index(student_id)` | Financial records outlive the student's active life: soft delete hides the profile, never the money chain (plan §7.2, S-02). |
| 10 | Invoice → InvoiceItem | 1 : N, CASCADE | Items are decomposition of the invoice document; no external references; the invoice itself is undeletable (payment RESTRICT + policy), so CASCADE never fires in practice. |
| 11 | Invoice → PaymentTransaction | 1 : N, RESTRICT; `@@index(invoice_id)` | Settlement aggregates SUCCESS sums per invoice inside one transaction (`payments.service.ts:282-301`); RESTRICT + never-delete policy keeps the ledger complete. |

Supporting relationships reviewed and kept as-is: examiner/current-rank/target-rank FKs on
`exam_registrations`, `classes.instructor_id`, `attendance_*` recorder/instructor attribution,
`notifications.user_id` SET NULL, `consent_logs` RESTRICT pair, `announcements.class_id` CASCADE +
`created_by` RESTRICT.

## 5. Primary Keys

| Pattern | Tables | Rationale |
|---|---|---|
| `UUID` (`uuid_v4` via Prisma default) | every domain/business table | Non-enumerable ids on public APIs (anti-IDOR posture; sequential ids would leak volume); safe for client-side reference before flush. |
| `SERIAL` (Int autoincrement) | `audit_logs`, `belt_ranks` | Internal-only tables: audit is never exposed by id beyond the user's own log ordering; belt ranks are a fixed seeded catalog where small int ordering is natural. Changing either would be churn without defect — KEEP. |
| Natural key as PK | `used_tokens.jti`, `totp_credentials.user_id`, `app_settings.key` | The natural key *is* the identity: jti single-use, 1:0..1 MFA credential, config key. |

## 6. Foreign Keys

Complete FK inventory with delete behavior (from migrations, verified against schema):

| Child → Parent | onDelete | Why correct |
|---|---|---|
| sessions/refresh_tokens/totp/recovery/used_tokens/audit_logs → users | RESTRICT | Soft delete only; hard delete must never orphan or cascade-wipe security history. |
| app_settings.updated_by → users | RESTRICT | Attribution integrity. |
| student_profiles.user_id → users | SET NULL | Only reachable if a user row were hard-deleted despite the soft-delete policy; harmless. |
| student_profiles.current_belt_rank_id → belt_ranks | SET NULL | Rank catalog rows are kept (`is_active=false`), so this is belt-and-suspenders. |
| parent_student_links → users / student_profiles | CASCADE | Link rows are relationship state, not history (see §4 #2). |
| class_schedules → classes | CASCADE | Class-owned config. |
| enrollments → student_profiles / classes | RESTRICT | History preservation. |
| attendance_sessions → classes / users(instructor) | RESTRICT | Held lessons are records. |
| attendance_records → sessions | CASCADE | Records only exist under their session; sessions are undeletable in practice. |
| attendance_records → student_profiles / users(recorder) | RESTRICT | History + attribution. |
| belt_exams.target_rank / exam_registrations(exam, student, target_rank) | RESTRICT | Exam sheets and money links immutable. |
| exam_registrations.current_rank / examiner | SET NULL | Attribution survives even in a hypothetical user purge. |
| invoices → student_profiles / users(creator) | RESTRICT | Money chain anchor. |
| invoices.ref_exam_registration → exam_registrations | SET NULL | Invoice survives even if registration bookkeeping were ever pruned (it isn't). |
| invoice_items → invoices | CASCADE | Document decomposition. |
| payment_transactions → invoices | RESTRICT | Ledger completeness; an invoiced payment can never dangle. |
| payment_transactions.recorded_by → users | SET NULL | Cash attribution is metadata, not chain integrity. |
| notifications.user_id → users | SET NULL | Delivery history outlives accounts by design (schema comment, plan §7.6). |
| consent_logs → users (subject + actor) | RESTRICT | Legal-posture records never dangle. |
| announcements.class_id → classes | CASCADE | Audience vanishes with the class; content for a non-class audience is meaningless. |
| announcements.created_by → users | RESTRICT | Authorship is accountability. |

## 7. Unique Constraints

| Constraint | Table(s) | Invariant it guarantees | Class (§14) |
|---|---|---|---|
| `users.email` | users | One account per email; anti-enumeration uniform flows | DATABASE |
| `refresh_tokens.token_hash` | refresh_tokens | Rotation + reuse detection (S-08) | DATABASE |
| `used_tokens.jti` (PK) | used_tokens | Single-use tokens | DATABASE |
| `student_profiles.user_id` | student_profiles | One profile per account | DATABASE |
| `student_profiles.invite_code` | student_profiles | A code links exactly one student | DATABASE |
| `parent_student_links(parent, student)` | parent_student_links | No duplicate parent-child link rows | BOTH (service guard + UQ) |
| `classes` natural keys — none beyond PK | classes | Class identity by UUID; duplicate names allowed (club reality) | — |
| `enrollments(student, class, enrolled_at)` | enrollments | One enrollment row per exact creation instant (rejoin tolerated on later rows) | DATABASE (same-*day* variant: APPLICATION — §8) |
| `attendance_sessions(class, session_date)` | attendance_sessions | One session per class per day | BOTH (P2002→409) |
| `attendance_records(session, student)` | attendance_records | Upsert business key for bulk records | BOTH |
| `belt_ranks.code`, `belt_ranks.order_index` | belt_ranks | Catalog integrity | DATABASE |
| `belt_exams.code` | belt_exams | Human-readable exam identity | BOTH (generated with retry) |
| `exam_registrations(exam, student)` | exam_registrations | One registration per student per exam | BOTH |
| `invoices.invoice_no` | invoices | Sequential per-year invoice numbers | BOTH (compute + P2002 retry) |
| `invoices(student, type, period_month, period_year)` | invoices | Monthly-tuition idempotency (plan §7.7); NULL periods distinct → EXAM_FEE unlimited | BOTH |
| `payment_transactions.order_ref` | payment_transactions | Webhook order matching hits exactly one payment | DATABASE |
| `payment_transactions.gateway_txn_id` | payment_transactions | Each gateway transaction processed exactly once (S-03) | BOTH (claim-first + UQ) |
| `announcements` — none beyond PK | announcements | Announcement identity by UUID; no natural key (re-posting the same title is legitimate) | — |

**Verdict: every idempotency-critical invariant the architecture baseline §9 requires is already
backed by a database unique constraint. No new unique constraint was needed.**

## 8. Check/Validation Constraints

Postgres CHECK constraints are **not expressible in `prisma/schema.prisma`**; hand-adding them in
migration SQL causes permanent `prisma migrate dev` drift-detection friction for every later
developer. The reconciliation therefore classifies each validation invariant:

| Invariant | Enforcement today | Class | Decision |
|---|---|---|---|
| Invoice `total = subtotal − discount`, `discount ≤ subtotal` | Service at every write path (`billing.service.ts:188-192, 204`, generateMonthly) | APPLICATION | KEEP as-is; DB CHECK documented as DEFERRED (§16). Single writer module; club scale. |
| InvoiceItem `amount = quantity × unit_amount` | Service (`billing.service.ts:211-219, 326-328`) | APPLICATION | Same as above. |
| VND amounts `≥ 0`, integers | DTO `@Min(0)`/`@IsInt` (`billing.dto.ts`, `exams.dto.ts` feeAmount/capacity) + `INT` column type | BOTH (type + validation) | KEEP. |
| TUITION ⇔ periodMonth/Year present | Service branch (`billing.service.ts:181-187`) | APPLICATION | KEEP — UQ key shape makes DB expression impractical. |
| Announcements `audience=CLASS ⇔ class_id NOT NULL` | To be enforced by announcements service (TASK-04) | APPLICATION (MISSING at DB level, deliberately — see §16) | Documented; TASK-04 must implement + regression-test it. |
| Schedule `start < end`, `effective_from ≤ effective_to`, weekday 0–6 | Service (`classes.service.ts:108-115`), DTO | APPLICATION | KEEP. |
| Rank ordering (`order_index`) as promotion validity | Service at registration (`exams.service.ts:155-169`); result-time re-validation decided below (§12, DD-05) | APPLICATION | KEEP (+TASK-04 fix). |
| Minor age cutoffs (self-registration, parent-consent scope) | Service/DTO (`consent.service.ts:124-128`) | APPLICATION | KEEP. |
| `enrollments` same-day rejoin guard | Service UTC-day window (`enrollments.service.ts:53-65`) | APPLICATION | KEEP; functional-unique-index variant DEFERRED (§16). |

## 9. Index Strategy

Every hot query path has a supporting index (verified service-by-service):

- **Ownership guard 7.3** (executed on nearly every student-scoped request): `student_profiles(id PK)`; `parent_student_links(parent_user_id)` + `(student_id)` indexes; instructor clause joins `enrollments(student_id)`/`(class_id)` → `classes.instructor_id` (indexed). No seq scans on guard paths.
- **Feed/list paths**: `invoices(student_id)`, `invoices(status)`, `payment_transactions(invoice_id)`, `payment_transactions(status)`, `audit_logs(user_id, created_at)`, `notifications(user_id, created_at)`, `enrollments(class_id)`/`(student_id)`, `exam_registrations(student_id)`, `attendance_sessions(instructor_id)`.
- **Worker paths**: `notifications(status, next_attempt_at)` (claim), `used_tokens(expires_at)` (purge).
- **Natural-key lookups**: all UQ constraints above are backed by unique indexes automatically.
- **New**: `announcements(class_id)`, `announcements(published_at)` — feed ordering and audience filter.

Known gap, deliberately deferred (plan §10: no performance change without a measured baseline):
`attendance_records` has **no index on `student_id` alone** — the per-student history/summary
queries (`attendance.service.ts:149-156, 177-183`) filter by `student_id` and use the composite
UQ only for session-prefixed lookups. At thesis scale (~45k records/year for 300 students) a seq
scan is milliseconds; the index is queued in §16 with its trigger condition.

## 10. Historical Data Policy

| Question (task item 7) | Answer | Evidence |
|---|---|---|
| Does attendance history survive enrollment changes? | **Yes.** Leaving sets `left_at`; rows are never deleted; `attendance_records` RESTRICTs the student FK and is keyed by session, not enrollment. | `enrollments.service.ts:113-131` (soft leave); schema FKs |
| Does exam history survive belt promotion? | **Yes.** `exam_registrations.current_rank_id` snapshots the rank at registration; promotion writes only `student_profiles.current_belt_rank_id`; belt ranks are never deleted. A registration row after promotion still shows what the student held when registering. | `exams.service.ts:185-196` vs `:260-265` |
| Do invoices survive the account lifecycle? | **Yes.** Student soft delete hides the profile from queries but the invoice chain is RESTRICT-referenced and never deleted; S-02 (delete student with invoices → invoices intact) is an existing passing e2e. | `students.service.ts:194-213`; S-02 suite |
| Do payments remain immutable? | **Yes.** Rows are never deleted; `gateway_txn_id` is claimable exactly once (conditional `updateMany` on `gatewayTxnId: null AND status PENDING`); terminal transitions only PENDING→SUCCESS/FAILED/DISPUTED and SUCCESS→REFUNDED/DISPUTED (admin, guarded `:230-232`); corrections are new status values, not row edits of amounts. | `payments.service.ts:124-131, 216-246` |
| Do audit records survive appropriately? | **Yes.** Append-only; no update/delete code path exists for `audit_logs`; user FK RESTRICT. | schema; `audit.service.ts` (write-batched inserts only) |
| Do notifications survive account removal? | **Yes** — `user_id` SET NULL keeps delivery records while releasing the account. | migration FK |
| Do consent records survive? | **Yes** — append-only with `revoked_at` stamps; RESTRICT FKs. | schema; `consent.service.ts` |

No archival/purge policy exists for business history (plan §7.2: archival only after a published
retention policy; never ad-hoc) — correct for the thesis and unchanged here. Expiry purges are
limited to security tokens (`used_tokens`, expired refresh tokens) and are not historical data.

## 11. Soft Delete Policy

| Entity | Mechanism | Notes |
|---|---|---|
| `users` | `deleted_at` + `is_active=false` | Via `DELETE /auth/me` and deactivation flows; JWT guard denies deleted/inactive accounts. |
| `student_profiles` | `deleted_at` | ADMIN student delete (`students.service.ts:194-213`) also deactivates the linked account; every read path filters `deletedAt: null` (verified: list, getById, ownership guard, enrollments, billing scoping, exam registration, consent subject resolution). |
| `parent_student_links` | Hard row delete — **deliberate exception** | An unverified link is granted access, not history; unlink-unverified (`parents.service.ts:79-96`) must revoke that access. Verified unlink is a club action (endpoint refuses, 409). |
| Classes | `status=ARCHIVED` (no delete) | History preserved. |
| Belt ranks | `is_active=false` (no delete) | RESTRICT-referenced. |
| Everything else | No delete path in code | Financial/audit/attendance/exam rows are never deleted; contract §6. |

## 12. Transaction Boundaries

All multi-write operations own a transaction in the service layer (controllers are
transaction-free — architecture baseline §8). Traced inventory:

| Operation | Boundary | Contents | Concurrency analysis (traced, not assumed) |
|---|---|---|---|
| Enrollment create | `$transaction` (`enrollments.service.ts:28-76`) | class/profile state checks → open-enrollment check → same-day check → capacity count → insert | **RACE (known, G-3/P2-4):** capacity and duplicate checks are check-then-act under READ COMMITTED; two concurrent creates can both pass `activeCount < capacity` and insert → overbooking. Same-day duplicate of the *same* (student,class) pair is theoretically possible in the same race window. **Decision (DD-05-adjacent, TASK-04 fix):** lock the class row with `SELECT … FOR UPDATE` as the first statement of the transaction — serializes all enrollment mutations per class; no schema change is possible/needed (capacity is a value in a sibling row). |
| Exam registration | `$transaction` (`exams.service.ts:135-204`) | exam OPEN/deadline → profile state → rank-regression check → capacity count → UQ duplicate check → registration + **EXAM_FEE invoice atomically** (billing exported service) | **RACE (G-3/P2-4):** capacity is check-then-act → overbooking possible. UQ(exam,student) does guard duplicate registration at DB level (P2002 surfaces 500-free? — the service pre-checks; a losing concurrent duplicate gets a raw P2002 → 500; acceptable rarity, same fix window). **Decision (TASK-04):** `SELECT … FOR UPDATE` on the exam row first. Atomicity registration+invoice is correct and proven by e2e. |
| Exam result entry | `$transaction` (`exams.service.ts:238-267`) | status guards (final/cancelled) → registration update → **promotion write** on PASS | **DEFECT (G-2/P2-5, mechanism decision DD-05 lands here):** PASS sets `currentBeltRankId` to the exam's target rank **without re-checking the student's current rank at result time** — a stale PASS recorded after an earlier promotion downgrades the student. **Decision: service re-validation, not a DB constraint** — a CHECK/FK cannot reference another row's `order_index`; the correct fix is re-reading the profile's current rank order inside this transaction and rejecting/regarding a lower target (TASK-04 + regression test). |
| Invoice create (manual) | `$transaction` (`billing.service.ts:194-237`) | invoice + items + **outbox rows in the SAME transaction** | Sequential `invoice_no` guarded by UQ with bounded P2002 retry (verified correct). Outbox atomicity verified (plan §7.6). |
| Monthly tuition generate | per-student `$transaction` (`billing.service.ts:309-329`) | invoice + items; P2002 on the period UQ → `skippedExisting` | Idempotency is DB-backed (UQ) — re-runs and concurrent runs converge; multi-class aggregation per student in one invoice (verified session 16 fix). |
| Exam-fee invoice issuance | inside caller's tx (`billing.service.ts:37-94`) | invoice + item + audit | P2002 retry loop on `invoice_no` UQ. |
| Webhook settlement | claim (`updateMany`, autocommit) then `$transaction` (`payments.service.ts:124-131, 282-301`) | claim `gateway_txn_id` once → txn SUCCESS → SUCCESS-sum ≥ total ⇒ invoice PAID | **Sound (verified):** the claim's conditional update is atomic — duplicate *and* parallel deliveries process exactly once (S-03 e2e); two different SUCCESS payments on one invoice both settle but produce the idempotent outcome (PAID) — overpayment is recorded, visible, and never hides money. Amount mismatch → DISPUTED, never PAID (S-11). |
| Cash confirmation | `$transaction` (`payments.service.ts:186-206`) | claim invoice flip UNPAID/OVERDUE→PAID (updateMany count=1 or 409) → create SUCCESS CASH txn | **Sound:** claim-first on the invoice flip; double confirm → 409 (e2e). |
| Refund / dispute | `$transaction` (`payments.service.ts:222-239`) | status guard (SUCCESS only) → outcome → recompute invoice from SUCCESS sums | OVERDUE never regresses to UNPAID (guard `:312`); re-derivation is idempotent. |
| Parent link | `$transaction` as array (`parents.service.ts:45-58`) | create verified link + rotate invite code | **RACE (G-3/P3-5, narrow):** two *different* parents submitting the same code concurrently both pass the duplicate pre-check and both create links before rotation. **Decision (TASK-04):** claim the code rotation first — `updateMany where inviteCode = <current>` inside the transaction; create the link only if `count === 1`. UQ(parent,student) already dedupes the same parent at DB level. Also fixes the P3-5 "return current code after 5 collision retries" footgun by making failure explicit. |
| Attendance bulk upsert | `$transaction` array (`attendance.service.ts:94-113`) | upserts keyed by UQ(session, student) | Enrolled-check happens pre-transaction (admin-only surface, staleness harmless); upserts are idempotent. |
| Outbox worker pass | claim `updateMany` QUEUED→SENDING (`notification-outbox.service.ts`) | stale-SENDING recovery → claim → deliver per row | Single-instance by design (AD-11); claim-first makes an accidental second instance wasteful, not harmful; stale recovery after 10 min. |
| Auth register/verify/reset | single-use `used_tokens` inserts/claims in auth service transactions | — | Verified in P1 (S-07/S-09/S-12). |

**Race-condition bottom line (task item 6):** three genuine check-then-act races exist
(enrollment capacity, exam capacity, invite-code claim); all three are *application-layer
transaction-discipline fixes* (`SELECT … FOR UPDATE` / claim-first `updateMany`), scheduled
TASK-04 with regression tests — they require no schema change, and inventing triggers or
exclusion constraints for a 300-user club would be unjustified complexity. All financial
idempotency (webhook, cash, monthly generate) is already race-safe via DB constraints + claims.

**Implementation status (TASK-04, 2026-09-24): all four §12 decisions are implemented with
regression coverage** — enrollment create and exam registration open with a
`SELECT … FOR UPDATE` on the class/exam row (`::uuid` cast required for Prisma raw params);
`linkChild` claims the invite code with a conditional `updateMany` before creating the link
(loser → uniform 404; P3-5 footgun replaced by an explicit 409 after bounded retries);
`recordResult` re-validates the student's current rank order inside the result transaction on
PASS (stale PASS → 409, no downgrade). Deterministic concurrency/regression e2e:
`test/e2e/db-integrity-races.e2e-spec.ts` (4 tests).

## 13. Idempotency Rules

| Operation | Rule | Enforcement |
|---|---|---|
| Monthly tuition generation | One TUITION invoice per (student, period) regardless of runs/concurrency | DB UQ + P2002→skip |
| Duplicate webhook delivery (sequential or parallel) | Processed exactly once, all answers 200 | Conditional claim + `gateway_txn_id` UQ (S-03) |
| Wrong-amount webhook | Never PAID; DISPUTED + flagged | Application rule over claimed txn (S-11) |
| Double cash confirmation | One SUCCESS CASH txn; second → 409 | Claim-first invoice status flip |
| Exam re-registration | One row per (exam, student); second → 409 | Service check + DB UQ |
| Exam re-result | Final; second → 409 | Status guard in result transaction |
| Invite-code reuse | A consumed code never links a second parent (after TASK-04: provably) | Code rotation + UQ; claim fix TASK-04 |
| Token verification (email/reset/change) | Single use | `used_tokens` PK + TTL purge |
| Invoice numbering | Sequential per year without gaps-inducing duplicates | UQ + bounded P2002 retry |
| Exam code generation | Unique `EXAM-<year>-<NN>` | UQ + bounded retry |
| Notification delivery | At-least-once with claim-first → effectively once | QUEUED→SENDING claim + bounded retries |
| Consent re-grant on active purpose | Idempotent 200 returning the active row | Application (`consent.service.ts:39-44`) |

## 14. Application vs Database Responsibility

Binding classification of the important invariants (APPL = enforced in services,
DB = enforced by constraints, BOTH, MISSING = no enforcement yet):

| Invariant | Class | Note |
|---|---|---|
| Email uniqueness / one account per email | DB | Service maps P2002 to uniform flows |
| One profile per account | DB | |
| Monthly tuition idempotency | BOTH | UQ + service skip accounting |
| Webhook exactly-once settlement | BOTH | `gateway_txn_id` UQ + conditional claim |
| Order-ref → single payment | DB | |
| Invoice number sequence | BOTH | UQ + retry loop |
| Exam registration uniqueness | BOTH | UQ + pre-check (losing racer gets raw P2002→500; accepted rarity, TASK-04 lock fix removes it) |
| Session-per-class-per-day | BOTH | UQ + P2002→409 |
| Attendance record upsert key | BOTH | UQ + Prisma upsert |
| Invite code uniqueness | DB | Collision retries in service |
| Parent link uniqueness | BOTH | UQ + pre-check |
| Class capacity ≥ active enrollments | APPL (MISSING at DB) | Check-then-act; TASK-04 row-lock fix; a DB trigger was evaluated and rejected (Prisma drift friction, club scale) |
| Exam capacity ≥ active registrations | APPL (MISSING at DB) | Same disposition as above |
| Same-day rejoin guard | APPL | Exact-timestamp UQ cannot express the day bucket; accepted |
| Result-time rank monotonicity | APPL (decided DD-05) | TASK-04: re-validate inside the result transaction |
| Invoice arithmetic (total/subtotal/discount) | APPL | DB CHECK deferred (§16) |
| Announcements audience/`class_id` consistency | APPL (decided here) | DB CHECK deferred (§16); TASK-04 implements + tests |
| Soft delete of people; never-delete of money/audit | APPL (policy) + DB (RESTRICT FKs make violations fail) | BOTH in effect |
| Token single-use | DB | |
| Field-level exposure (serializer §7.4) | APPL | Not a DB concern; verified in place |

## 15. Required Migrations

Applied history is **frozen** — none of the six existing migrations was modified (verified by
diff: only the new directory was added under `prisma/migrations/`):

1. `20260905000000_init` — auth 7 tables + settings + belt_ranks (unchanged)
2. `20260905164753_add_student_profiles_and_links` (unchanged)
3. `20260905211728_add_classes_enrollments_attendance` (unchanged)
4. `20260905230602_add_belt_exams_exam_registrations_invoices` (unchanged)
5. `20260906014813_add_payment_transactions_invoice_period_key` (unchanged)
6. `20260911025644_add_notifications_consent` (P5 working set, uncommitted at session start) (unchanged)
7. **`20260915233751_add_announcements` — NEW (this task).** Additive only:
   `CREATE TYPE "AnnouncementAudience"`; `CREATE TABLE "announcements"` (id UUID PK, title
   VARCHAR(150), body TEXT, audience enum, class_id UUID NULL, published_at, created_by,
   timestamps); indexes on (class_id), (published_at); FK class CASCADE, FK author RESTRICT.
   Safe against existing data: brand-new table, no backfill, no alteration, no destructive
   operation. Rationale: AD-07 ratifies this exact design (plan §6) as the only domain gap
   against thesis primary value 3 ("club activities").

Verification evidence (this session, disposable PostgreSQL 18 on :5433, initdb/pg_ctl):

- `prisma migrate deploy` on empty DB → all 7 migrations applied cleanly.
- `information_schema` count against the expected 25-table list → **25**.
- `prisma migrate reset --force` + `prisma migrate deploy` (full replay incl. seed) → **25
  tables**, announcements DDL verified (`\d announcements`: columns, both indexes, both FKs).
- CI `migration-dry-run` assertion updated to the 25-table list (`ci.yml:207-209`).
- `prisma db seed` runs clean on the new schema.

## 16. Deferred Database Changes

Documented, deliberately **not** implemented now — each with its trigger condition. None blocks
the thesis or the architecture.

| # | Deferred change | Why deferred | Trigger / owner |
|---|---|---|---|
| DDB-1 | DB CHECK: invoice arithmetic (`total = subtotal − discount`, `discount ≥ 0`, item `amount = quantity × unit_amount`) | Not expressible in `prisma/schema.prisma`; hand-SQL CHECKs cause permanent `migrate dev` drift friction; every write path already validates; single writer module | Only if a second write path ever touches invoices; then a standalone raw migration accepting the drift caveat |
| DDB-2 | DB CHECK: `announcements` audience/`class_id` consistency (`audience='CLASS' ⇔ class_id IS NOT NULL`) | Same Prisma drift friction; table is brand-new with zero writers until TASK-04 builds the module | TASK-04 must implement the application rule + regression test; DB CHECK only if DDB-1's trigger fires |
| DDB-3 | Index `attendance_records(student_id)` | No measured need (plan §10: baseline first); ~45k rows/year at thesis scale is milliseconds for a seq scan | When attendance history latency is measured as an issue or records exceed ~10⁵ |
| DDB-4 | Functional unique index for same-day enrollment (`enrollments(student, class, enrolled_at::date)`) | Prisma cannot model functional indexes without drift risk (recorded session 12); the service guard covers the real flow; race window is two admin clicks on the same student+class within the same day | Only if the club reports the flow being abused/raced; then raw migration + accept caveat |
| DDB-5 | `parent_student_links.verified_by_user_id` is currently never written (the service verifies via code and leaves attribution NULL) | Zero behavioral impact; attribution enrichment only | TASK-04+ if the club wants *who verified* recorded; no migration needed (column exists) |
| DDB-6 | Enrollment/exam capacity triggers or exclusion constraints | Rejected during reconciliation: triggers are outside Prisma's model (drift friction) and the row-lock fix is simpler, testable, and sufficient at club scale | Never for the thesis; revisit only on measured scale-out (DD-03) |

## 17. Database Risks

| ID | Risk | Severity | Mitigation / owner |
|---|---|---|---|
| R-DB-1 | Check-then-act races: enrollment capacity, exam capacity, invite-code claim (traced §12) | Medium (low probability at club scale, thesis-visible if hit) | TASK-04: row locks / claim-first + regression tests; decisions recorded §12 |
| R-DB-2 | Result-time rank regression (G-2) | Medium (data integrity, thesis-visible) | TASK-04: in-transaction re-validation (DD-05 decision §12) |
| R-DB-3 | PG enums require `ALTER TYPE … ADD VALUE` migrations for new statuses | Low | Additive and safe; documented here so future value additions go through migrations, never `db push` |
| R-DB-4 | `prisma migrate dev` drift friction if hand-written CHECKs are ever added (DDB-1/DDB-2) | Low | Deferred with explicit caveat; prefer application enforcement |
| R-DB-5 | Docker image does not apply migrations on release (K-2: no release-command wiring) | Medium (deploy-day) | TASK-06 (deploy trial); not a schema defect |
| R-DB-6 | Single-instance DB, no PITR/restore drill yet (K-4) | Medium (go-live) | TASK-06 + owner (provider PITR, `restore-drill.sh`) |
| R-DB-7 | `app_settings` JSONB is schemaless (typos in keys would silently misbehave, e.g. tuition rate lookup) | Low | Reads validate shapes and fail-safe (missing rate → class skipped and reported, `billing.service.ts:266-270`); go-live checklist requires owner-verified seed values |
| R-DB-8 | Concurrent different-txn SUCCESS payments on one invoice can overpay (recorded, visible, never hidden) | Informational | Accepted club behavior; visible in payment list; refund/dispute path exists |

## 18. Thesis Traceability

| # | Thesis requirement | Database support | Status after TASK-02 |
|---|---|---|---|
| 1 | Students view class schedules | `classes` + `class_schedules` (catalog form; aggregated per-student read is an endpoint concern, DD-02) | Complete |
| 2 | Students view tuition | `invoices` + `invoice_items` + `payment_transactions`, role-scoped via ownership data (`student_profiles.user_id`, `parent_student_links`) | Complete |
| 3 | Students view club activities | **`announcements` (new, this task)** — audience ALL/CLASS, feed ordering, class targeting | **Schema complete**; module/endpoints TASK-03/04 |
| 4 | Admin manages club operations | 15 admin-write tables across students/classes/enrollments/attendance/belts/exams/billing + `app_settings` | Complete |
| 5 | Instructor manages training ops | `attendance_sessions.instructor_id`, `classes.instructor_id` (ownership clauses), `exam_registrations.examiner_id` | Complete |
| 6 | QR payment | Payment chain: `invoices` → `payment_transactions` (`order_ref`, `gateway_txn_id` idempotency, 30-min `expires_at`); settlement invariants §13 | Complete (real-gateway adapter TASK-04; DB unaffected) |
| 7 | Role-based authorization | `users.role` enum + ownership-supporting indexes (§9) | Complete |
| 8 | Testing | Migration replay verified from empty DB; 271/271 unit + 68/68 e2e green on the new schema | Evidence below |
| 9 | Deployment trial | Versioned additive migrations, CI dry-run assertion 25 tables | Ready (deploy wiring TASK-06) |
| 10 | Student management incl. minors | `student_profiles` (account-optional), `parent_student_links` invite-code model, soft delete, `consent_logs` proxy column | Complete |

Stack traceability: PostgreSQL ✓ (fixed stack, contract §1); Prisma versioned SQL migrations ✓
(7 committed, replay-verified); financial integrity structures ✓ (RESTRICT chain, integer VND,
idempotency UQs); personal-data posture ✓ (soft delete, minimal-exposure serialization data
model, consent + announcement tables for the club-communication loop).

---

## Reconciliation summary

- **Every current model reviewed and classified** (§3): 23 KEEP, 1 ADD (`announcements`),
  0 MODIFY, 0 MERGE, 0 SPLIT, 0 REMOVE.
- **Relationships justified** (§4), invariants classified by enforcement layer (§7/§8/§14).
- **Historical data protected** (§10); **financial integrity reviewed** (§3.7, §13).
- **Concurrency traced to actual queries** — 3 real races, all application-fixable, decisions
  recorded for TASK-04 (§12, §16); financial paths proven race-safe.
- **Migrations**: existing 6 untouched; 1 new additive migration verified from empty DB (§15).
- **Test evidence**: format ✓ lint ✓ typecheck ✓ 271/271 unit ✓ build ✓ 68/68 e2e ✓
  (vs disposable PostgreSQL 18 hosting the new migration); spectral contract lint 0 errors
  (no API change — `openapi.json` remains 59 paths / 71 operations, as expected for a
  schema-only task).
