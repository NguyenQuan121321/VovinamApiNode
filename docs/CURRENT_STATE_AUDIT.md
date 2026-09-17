# VovinamApiNode — Current State Audit (TASK-00)

Audit date: 2026-09-15. Audit method: repository-wide evidence inspection per
`.agents/prompts/tasks/00-current-state-audit.md`. No source code, schema, migration,
API contract, test, or architecture change was made by this audit. Verification runs
performed by the audit itself are marked **[verified 2026-09-15]**.

Source-of-truth priority used: source code > Prisma schema > migrations > git history >
tests/CI > OpenAPI > IMPLEMENTATION_PROGRESS.md > docs/PLAN.md.

---

## A. Executive summary

VovinamApiNode today is a **NestJS 11 + Prisma + PostgreSQL 16 backend for a real
Vovinam club**, implementing phases P0–P4 of `docs/PLAN.md` (auth, domain core,
belts/exams, billing/payments) **merged to `main`, plus a functionally complete but
UNCOMMITTED P5 increment (notifications outbox + in-app feed + consent)** sitting in
the working tree.

All quality gates pass on the current tree **[verified 2026-09-15]**: 271/271 unit
tests, 68/68 e2e + security tests against a disposable PostgreSQL 18, migrations
replay cleanly from empty DB to 24 tables (23 domain + `_prisma_migrations`).

Against the **thesis** (Vovinam student management system), the backend covers most
primary value: schedules, tuition, admin/instructor operations, role-based
authorization, testing. Two thesis-value gaps exist: **club activities
(announcements) are not implemented at all**, and **QR payment runs only on a
simulated gateway** (real payOS/SePay adapters fail-fast until credentials exist).
The deployment trial has not been executed (deploy gate is a stub; no staging/prod,
no backup/DR).

No P0 (build/security/financial-integrity blocker) was found. The most urgent items
are process and completion gaps: land the uncommitted P5 work on a branch with a
regenerated OpenAPI contract, enforce ADMIN MFA (planned but never implemented),
complete the delivery adapters (SMTP/ZNS/SMS, real payment gateway), and implement
announcements for the thesis "club activities" requirement.

---

## B. Actual repository state

### Git

| Item | Evidence |
|---|---|
| Branch | `main` |
| Latest commit | `9e371ac` — Merge PR #17 (`phase/4-billing`) |
| Merged phases | P0 (PR #1), P1 (PR #7), P2 (PRs #12, #14), P3 (PR #16), P4 (PR #17) — all squash/merge commits on `main` |
| Local branches | `main`, `phase/1-auth` (stale), `phase/5-notifications-consent`, `chore/agents-workflow` |
| Uncommitted work | 9 modified files + 4 untracked paths: **P5 (notifications + consent)** — `src/notifications/`, `src/consent/`, `prisma/migrations/20260911025644_add_notifications_consent/`, `test/e2e/notifications-consent.e2e-spec.ts`, plus module wiring, billing outbox hook, env additions, CI table assertion 22→24 |
| Stash | `stash@{0}` "pre-P5 artifacts: billing QR-initiation WIP + .agents draft-revert (snapshot artifact)" |
| Tags | none |

### Verified test results [2026-09-15]

| Gate | Result | How verified |
|---|---|---|
| Unit tests | **271/271 pass** (60 suites) | `npm test` (Node via repo toolchain) |
| E2E + security | **68/68 pass** (12 suites) | `npm run test:e2e` vs disposable PostgreSQL 18 (TCP :5433, initdb/pg_ctl) |
| Migration replay | Clean on empty DB; **24 tables** incl. uncommitted P5 migration | `npx prisma migrate deploy` + `information_schema` count |
| Lint/format/typecheck/build | Not re-run in this audit; last recorded green in Session 16 handoff; enforced by CI | CI config inspected |
| OpenAPI contract | **STALE vs working tree**: committed `openapi.json` has 59 paths / 71 operations and **zero** notification/consent paths; the working tree adds 6 endpoints (notifications 3, consent 3) → contract-gate will fail on commit | `node` parse of `openapi.json` + controller decorator scan |

### Runtime architecture (as implemented)

NestJS 11 modular monolith (Express adapter), `/api/v1` prefix, response envelope
`{code,message,data}` via global interceptor + exception filter. Controllers never
touch Prisma; services own transactions; boundary ports: `MAIL_PORT`
(LoggingMailSender), `PaymentGatewayPort` (SimulatedGateway; payos/sepay fail-fast),
`ZNS/SMS_SENDER_PORT` (stubs that throw `UnconfiguredChannelError`), `SharedStore`
(in-memory Map + TTL sweeper). Background work: in-process notification outbox worker
(30 s poll, claim-first, retry/backoff, ZNS→SMS→EMAIL fallback), used-token purge
(6 h), overdue-invoice aging (24 h). Observability: pino JSON + request-id + request
logs, prom-client metrics at bearer-token-protected `/metrics`. Global
`ValidationPipe(whitelist, forbidNonWhitelisted)`, helmet, CORS allowlist, global
per-IP throttler (IPv6 /64 buckets). Swagger gated by `SWAGGER_ENABLED`.

### Database (23 domain tables)

- **Auth/identity (7):** `users`, `sessions`, `refresh_tokens`, `totp_credentials`,
  `recovery_codes`, `used_tokens`, `audit_logs`
- **Configuration (1):** `app_settings` (seeded `tuition_rates`, `bank_account`
  owner_type=BUSINESS)
- **Domain (15):** `student_profiles`, `parent_student_links`, `belt_ranks` (15 seeded
  ranks: LAM/VANG 3+3, DO 6, HUYEN 3), `classes`, `class_schedules`, `enrollments`,
  `attendance_sessions`, `attendance_records`, `belt_exams`, `exam_registrations`,
  `invoices`, `invoice_items`, `payment_transactions`, `notifications` (uncommitted),
  `consent_logs` (uncommitted)
- Soft delete on `users`/`student_profiles`; financial chain `ON DELETE RESTRICT`;
  idempotency keys: `gateway_txn_id UQ`, `invoices UQ(student,type,period_month,period_year)`,
  `@@unique(exam,student)`, `@@unique(class,session_date)`.

### API inventory (working tree, 77 operations; committed OpenAPI 71)

| Module | Operations | Roles (summary) |
|---|---|---|
| auth | 25 (24 paths; +DELETE /auth/me) | public register/verify/reset/login; JWT for the rest; MFA TOTP sub-flow |
| students | 7 | ADMIN CRUD; GET list ADMIN+INSTRUCTOR (instructor scoped); GET :id via ownership guard; GET me STUDENT |
| parents | 3 | PARENT (invite-code link, children list, unlink unverified only) |
| classes | 6 | reads any-authenticated; writes ADMIN (schedules incl. DELETE beyond plan) |
| enrollments | 3 | ADMIN (enroll/list/soft-leave) |
| attendance | 5 | sessions/records ADMIN+own-INSTRUCTOR; history+summary any role via ownership guard |
| belts | 3 | GET any-authenticated; POST/PATCH ADMIN |
| exams | 6 | reads any-authenticated; CRUD ADMIN; register STUDENT/PARENT (guard 7.3); result ADMIN/INSTRUCTOR |
| billing | 5 | GET invoices ADMIN/STUDENT/PARENT (INSTRUCTOR blocked by guard); POST/generate-monthly/revenue ADMIN; GET :id no @Roles, service-guarded 404 for INSTRUCTOR |
| payments | 5 | QR initiation **any authenticated role + ownership guard**; webhook public+HMAC; confirm-cash/PATCH ADMIN; GET payments ADMIN/STUDENT/PARENT |
| notifications (uncommitted) | 3 | feed/read any-authenticated self-scoped; flush ADMIN |
| consent (uncommitted) | 3 | any authenticated; parent-proxy for minors via ownership guard |
| health/metrics | 3 | public healthz/readyz; metrics bearer-only |

---

## C. Thesis requirements vs current system

Thesis objective: a Vovinam student management system where students quickly view
schedules, tuition, and club activities; admins manage club operations; instructors
manage training operations; QR payment; role-based authorization; testable;
deployable as a thesis prototype. (Stack: Node.js ✓, React — separate frontend, out
of this repo's scope ✓ documented, PostgreSQL ✓, REST API ✓, QR △, RBAC ✓.)

| # | Thesis requirement | Capability | Module | DB entity | API | Test | Status |
|---|---|---|---|---|---|---|---|
| 1 | Students view class schedules | class + schedule catalog | classes | classes, class_schedules | GET /classes, GET /classes/:id | classes-attendance e2e | **Implemented** (catalog form; no per-student aggregated "my schedule" — see F-H3) |
| 2 | Students view tuition | invoices role-scoped | billing | invoices, invoice_items | GET /invoices, GET /invoices/:id | billing e2e | **Implemented** |
| 3 | Students view club activities | announcements to club/classes | — | **none** | **none** | — | **MISSING** (plan §6/§8 defines `announcements` + endpoints; never built; INAPP notification feed is a partial substitute only) |
| 4 | Admin manages club operations | full backoffice | students, classes, enrollments, belts, exams, billing | — | 30+ admin ops | e2e suites | **Implemented** |
| 5 | Instructor manages training ops | attendance, results, own-class data | attendance, exams, students | attendance_* | attendance 5 ops, result entry | e2e + S-04 | **Implemented** (INSTRUCTOR clause of guard 7.3 active) |
| 6 | QR payment | gateway QR + settlement | billing | payment_transactions | POST /payments/qr, webhook, confirm-cash | billing e2e (S-03, S-11) | **PARTIAL** — architecture complete on a `PaymentGatewayPort`; only `simulated` adapter exists; payOS/SePay fail-fast until credentials; QR endpoint returns a payment URL (image rendering is a frontend/real-gateway concern) |
| 7 | Role-based authorization | 4-role RBAC + ownership guard + field serializer | auth guards, students | users.role | all routes | S-01/S-04/S-07 e2e | **Implemented** |
| 8 | Testing | unit + e2e + security tiers, coverage floors | — | — | — | 271 unit / 68 e2e | **Implemented** (floors 75% auth/billing/classes enforced in CI config) |
| 9 | Deployment trial | CI → deploy → smoke | — | — | — | — | **PARTIAL** — 13 CI jobs incl. docker build + trivy; deploy job is a **stub** (no `RENDER_DEPLOY_HOOK`/`SMOKE_TEST_URL` secrets, no staging/prod instance, no migration-on-release wiring) |
| 10 | Student management incl. minors | profiles, invite-code parent links, soft delete | students, parents | student_profiles, parent_student_links | students 7 + parents 3 ops | students-roles e2e, S-01/S-02 | **Implemented** |

### Extra features found (classification — none removed)

| Feature | Classification | Rationale |
|---|---|---|
| PARENT actor + invite-code linking | **Required** (supporting actor) | Minors cannot self-register (thesis-consistent; plan §7.1, Children Law 2016); parents act for minors including consent proxy |
| TOTP MFA full stack (enable/verify/validate/recovery) | **Justified extension** | Admin touches real money (plan §4.1); cheap; but see P1-2: ADMIN enforcement never wired |
| Sessions list/revoke, refresh rotation + reuse detection, jti denylist, pwd_version | **Justified extension** | Security baseline for real deployment; all tested (S-08/S-12) |
| Consent module (Decree 13/2023) | **Justified extension** | Legally required for minors' data; uncommitted P5 |
| Notification outbox + INAPP feed | **Supporting functionality** | Plan §7.6; also the only existing stand-in for club activities |
| ZNS/SMS channels | **Supporting functionality** (stubs) | Fail-safe: stubs throw, fall back to EMAIL; module fail-fasts if credentials set without adapters |
| Simulated payment gateway | **Supporting functionality** | Dev/e2e only; needs a production guard (see J-3) |
| Revenue report | **Supporting functionality** | Plan §8 admin backoffice |
| Schedules DELETE endpoint | **Justified extension** | Schedule lifecycle beyond plan §8; documented in session log |
| Nothing found in scope to REMOVE | — | No feature contradicts thesis requirements |

---

## D. Actor/role reconciliation

Thesis actors: **Admin, Võ sư (grand master), Huấn luyện viên (instructor/coach),
Võ sinh (student)**. Current roles (`users.role`, `UserRole` enum): **ADMIN,
INSTRUCTOR, STUDENT, PARENT**.

| Thesis actor | Current role | Verdict |
|---|---|---|
| Admin | ADMIN | Direct match. Club management + money. |
| Võ sư | **no dedicated role** | In club reality the Võ sư is the club master/chief instructor. Their two function sets map cleanly onto the two existing roles: club/money management → ADMIN; teaching/grading → INSTRUCTOR. Recommendation: **document the mapping (Võ sư uses ADMIN, and is typically also the examiner via `examiner_id`) rather than adding a 5th role** for a single-person club. If the thesis council requires literal actor fidelity, an alias/display-name on ADMIN or a future `MASTER` role is a low-cost extension — decision belongs to TASK-01, not this audit. Note `ExamRegistration.examinerId` already models "the master grades" without a role. |
| Huấn luyện viên | INSTRUCTOR | Direct match. Attendance, exam results, own-class student visibility (serializer drops contact fields per plan §7.4). |
| Võ sinh | STUDENT + `StudentProfile` | Direct match, with a correct **role-vs-domain-concept split**: minors are `StudentProfile` rows *without* a `users` row (invite-code linked via PARENT); adults get a STUDENT account (PENDING→ACTIVE). |
| — (not in thesis) | PARENT | **Justified supporting actor — keep.** Required by the minor flow and by consent proxying (`consented_by_user_id`); verified-link ownership guard; INSTRUCTOR-like 404 posture. |

Role model compatibility: **compatible with the thesis.** Single-role-per-user is a
documented, accepted limitation (plan §2). Authorization rules verified: JWT guard
checks jti denylist + pwd_version + account state + session state
(`src/auth/guards/jwt-auth.guard.ts:27-61`); RolesGuard allows routes without
`@Roles` (all such routes are self-scoped or service-guarded — verified per route).
One genuine inconsistency found: **INSTRUCTOR is excluded from all invoice/payment
reads (404 per plan §7.4) yet CAN initiate QR payment for own-class students**
(`POST /payments/qr/:invoiceId` has no `@Roles`; ownership guard only) — see H-2.

---

## E. Use-case reconciliation

| Thesis use case | Implementation | Status |
|---|---|---|
| Student registration / management | POST /students (ADMIN, returns invite code once), status ACTIVE on create | Implemented (note: no PENDING→ACTIVE approval flow for admin-created profiles — `students.service.ts` hardcodes ACTIVE; plan §7.1's PENDING path exists only for adult self-registration) |
| Profile management | GET/PATCH /students/:id (guard 7.3), GET /students/me | Implemented |
| Class management | classes CRUD + capacity shrink guard | Implemented |
| Schedule management | schedules POST/DELETE + validation (start<end, effective range) | Implemented |
| Enrollment | enroll/soft-leave/list + same-day guard + capacity guard | Implemented |
| Attendance | sessions + bulk upsert records + history + monthly summary | Implemented |
| Tuition | invoices CRUD-scoped + generate-monthly (idempotent, multi-class aggregation) + overdue aging | Implemented |
| Online/QR payment | gateway port + simulated adapter; URL returned; 30-min expiry; webhook settlement | Partial (no real gateway) |
| Payment confirmation | auto (webhook) + CASH (ADMIN) + refund/dispute re-derivation | Implemented |
| Belt management | ranks CRUD + 15-rank seed, P2002→409 mapping | Implemented |
| Belt exam | CRUD, OPEN/deadline/capacity/rank-regression checks, active-rank target | Implemented |
| Exam registration | atomic registration + EXAM_FEE invoice in one transaction | Implemented |
| Exam result | final results (409 on re-entry), examiner attribution, PASS promotes rank | Implemented (rank re-validation gap at result time — see G-2) |
| Belt promotion | RESULT_PASS → `current_belt_rank_id` | Implemented (e2e-verified) |
| Reports | revenue by month/channel only | Partial (no attendance/rank reports, no CSV export) |
| Club activities | **announcements: none** | **Missing** |
| Notifications | outbox + feed + read + admin flush (uncommitted) | Implemented-partial (EMAIL channel = console/file logger; ZNS/SMS stubs) |

Missing use cases: club-activity announcements; personalized schedule view; SMTP
email delivery; real QR gateway. Duplicated use cases: none found. Unnecessary
features: none found. Incorrectly scoped: none found.

---

## F. Architecture findings

**Verdict: appropriate with targeted changes.** The modular monolith matches the
scale (~300 users, one club), mirrors the team's Handler-Service-Repository
experience, and keeps the thesis demo simple. No structural rework is warranted.

F-1. **Ports are consistently applied** (mail, payment gateway, ZNS/SMS senders,
SharedStore) — swapping adapters for real ones is additive. Evidence:
`src/billing/payment-gateway.port.ts`, `src/auth/mail/mail.port.ts`,
`src/notifications/notification-senders.port.ts`.

F-2. **Single-instance assumptions are documented and currently acceptable**:
in-memory jti denylist/lockout/mail budgets (`shared-store.ts`), per-instance
interval jobs (idempotent). Constrains future horizontal scaling; noted, not a
defect for the thesis.

F-3. **Contract discipline gap (process, not code):** `openapi.json` must be
regenerated in the same commit as any route change — already a recorded lesson
(Session 14) and currently violated by the uncommitted P5 set (contract-gate will
fail). Owner: P5 completion.

F-4. **Outbox worker is sound**: claim-first `QUEUED→SENDING`, stale-SENDING
recovery after 10 min, bounded retry/backoff (5 attempts), fallback chain, INAPP
delivered at insert (`notification-outbox.service.ts:99-218`).

**Reconsider before further development (answers for audit question G):**
1. Nothing architectural needs reversal; the two-port completion orders are:
   SMTP adapter and real payment gateway (blocking thesis QR demo), then ZNS/SMS.
2. Decide the announcements design *before* building it (table + audience scoping
   already specified in plan §6/§8 — reuse it rather than inventing).
3. Keep single-instance deployment target; do not introduce Redis/BullMQ for the
   thesis prototype.

---

## G. Database findings

Detailed design review deferred to TASK-02 (per task scope). High-level:

G-1. **Missing entity vs plan §6: `announcements`** (thesis "club activities").
Every other planned entity exists with the planned shape.

G-2. **`exam_registrations` result-time rank regression**: PASS sets
`currentBeltRankId` to the exam's target rank without re-checking the student's
current rank at result time; a student promoted by a second exam in the meantime
can be moved *down*. Evidence: `exams.service.ts:260-265`. Fix belongs to TASK-02/04.

G-3. **Race conditions (check-then-act under READ COMMITTED, no locks)**: exam
capacity (`exams.service.ts:170-177`), enrollment capacity
(`enrollments.service.ts:66-71`), concurrent parent-link code rotation
(`parents.service.ts:38-57`). Consequences: overbooking / duplicate links at low
probability. DB-constraint or transactional fixes belong to TASK-02.

G-4. **Financial integrity structures are correct**: RESTRICT FKs on the money
chain, `gateway_txn_id UQ` idempotency guard, `UQ(student,type,period_month,period_year)`
monthly idempotency, sequential `invoice_no` with P2002 retry, VND integers.

G-5. Historical-data risks: none found — enrollments are append/soft-leave,
attendance upserts overwrite by business key, invoices never hard-deleted.

---

## H. API findings

H-1. **Committed OpenAPI (59 paths/71 ops) excludes the uncommitted P5 endpoints**
(notifications 3, consent 3). Regenerate before committing P5 (contract-gate).

H-2. **Role inconsistency (recommend TASK-03):** INSTRUCTOR can `POST
/payments/qr/:invoiceId` for own-class students (no `@Roles`; ownership guard only,
`billing.controller.ts:77-84`) but gets 404 on every invoice/payment read
(`billing.service.ts:411-412`; `GET /payments` excludes INSTRUCTOR). Either QR
initiation should be STUDENT/PARENT/ADMIN-only, or the exclusion rationale should be
documented as deliberate.

H-3. **No aggregated student schedule endpoint** ("my next sessions"): students see
schedules via the class catalog (`GET /classes` is any-authenticated). For the thesis
demo value "quickly view class schedules", a `GET /students/me/schedule`-style read
is worth adding in TASK-03 (optional, P3).

H-4. Route hygiene is good: uniform 404 posture on ownership violations, 404 for
malformed UUIDs (ParseUuidPipe at all 18 id params), whitelist+forbidNonWhitelisted
globally, consistent 200-on-action vs 201-on-create (post-Session-14).

H-5. Minor contract contradiction: `POST /payments/webhook/:provider` returns 401 on
malformed payload (`payments.service.ts:112-114`) while the doc comment promises
"everything else answers 200 so the gateway never retries" (`:96-99`). Malformed
events will be retried by the provider. TASK-03/05.

---

## I. Security findings

**Verified controls** (implemented AND exercised by passing tests this session):
uniform-401 anti-enumeration with dummy-bcrypt timing (S-07/S-09); TOTP shared
failure bucket 5/5min + 120 s replay guard (S-05); refresh rotation with
reuse-detection revoking all sessions (S-08); jti denylist on logout (S-12);
ownership guard 404 posture incl. INSTRUCTOR scoping (S-01/S-04); minor
self-registration rejection (S-06); per-IP throttler with IPv6 /64 buckets (S-10
unit-tested in `ip-tracker.spec.ts`); webhook HMAC over raw body + claim-first
idempotency + exact-amount rule (S-03/S-11); AES-256-GCM TOTP sealing; SHA-256-only
storage of refresh/recovery tokens; fail-fast env validation; /metrics bearer-only
(404 when unconfigured, required in production); global rate limiting; helmet/CORS;
bcrypt cost 10; password policy; used_tokens single-use; soft delete.

**Missing or partial controls:**

I-1 (P1). **ADMIN MFA enforcement absent.** Plan §4.1: "ADMIN must enable TOTP
before using admin endpoints". No guard references MFA state; ADMIN can operate with
password only. Session 5 recorded it as a known follow-up that never landed. Owner:
TASK-05 (guard change + e2e).

I-2 (P1). **No SMTP adapter.** `MAIL_PORT` = LoggingMailSender (pino log;
`MAIL_LOG_FILE` writes full messages incl. tokens to a file — e2e-scoped by comment
but unguarded by NODE_ENV). Verification/reset/notification emails are not actually
deliverable today. Owner: TASK-04/05.

I-3 (P2). **Production misconfiguration not guarded:** `PAYMENTS_GATEWAY=simulated`
is legal in production (no cross-field joi rule); `PAYMENTS_WEBHOOK_SECRET` is
optional in prod (`allow('')`) — with the simulated gateway and no secret, webhooks
can never verify (payments silently never settle). Owner: TASK-05.

I-4 (P2). **Throttler key spoofable behind exactly one appending proxy:** `trust
proxy = 1` + `request.ips[0]` as bucket key means a client-supplied XFF prefix
rotates the bucket if the edge proxy appends rather than overwrites
(`ip-throttler.guard.ts:11-14`, `bootstrap.ts:45`). Deployment-dependent; document
proxy requirement or pin to `request.ip`. Owner: TASK-05/06.

I-5 (P3). Single-instance shared state (I-2-adjacent, documented); `ips`-based
buckets noted above; nothing else.

I-6 (informational). Audit log is write-batched with drop-on-overflow and requires
`AuditService.flush()` in tests — intentional, documented.

No claim of "secure" or "production-ready" is made; the above is the control
inventory only.

---

## J. Financial integrity findings

J-1. **Verified:** webhook signature-first (constant-time HMAC over exact raw
bytes), claim-first idempotency via `gateway_txn_id` (duplicate AND parallel
deliveries process exactly once, all 200 — S-03 e2e), amount mismatch → DISPUTED +
`payment_flagged` audit, never marked paid (S-11 e2e), invoice PAID only when
SUCCESS-sum ≥ total inside one transaction, CASH confirm claim-first on the invoice
status flip (double confirm → 409), refunds/disputes re-derive the invoice to UNPAID
(OVERDUE never regresses), bank-account `owner_type=BUSINESS` guard before QR
issuance, expired-QR webhooks still settle intentionally (documented).

J-2. **P2 — malformed webhook payload → 401** contradicts the "always 200"
anti-retry design (H-5).

J-3. **P1 — no real gateway + no prod guard on `simulated`** (I-3). The thesis QR
requirement cannot be demonstrated end-to-end with real money rails until payOS/SePay
credentials exist; the port design makes this additive.

J-4. **P2 — no reconciliation aid:** plan §15's daily reconciliation report /
webhook-mismatch runbook (OPERATIONS.md) does not exist; disputes are visible only
via audit log rows.

---

## K. Production readiness findings

K-1. **Image/build:** multi-stage non-root Dockerfile, prod-deps-only layer,
`node --enable-source-maps` — good.

K-2. **Migrations:** committed SQL, CI dry-run asserting 24 tables + replay-from-
scratch — verified this session. **Gap:** the Docker image does not apply
migrations and no release-command wiring exists (plan §11.2 says Render release
command; no Render service configured).

K-3. **Deploy gate is a stub:** `RENDER_DEPLOY_HOOK`/`SMOKE_TEST_URL` absent → the
deploy job echoes and exits 0. No staging/prod environment exists. The "deployment
trial" thesis activity is **not yet demonstrated**.

K-4. **Backup/DR absent:** no PITR verification, no `scripts/restore-drill.sh`, no
R2 dump job (plan §11.4). RPO/RTO targets unmet/undemonstrated.

K-5. **Runbooks absent:** `docs/OPERATIONS.md`, `docs/SECURITY.md` (plan §13 P6)
not created; `bruno/` UAT collection and `load/` k6 scripts (plan §3/§12) not
created.

K-6. **Observability:** pino + request-id + prom metrics implemented; Sentry
planned-optional but not wired (no env var); UptimeRobot external and unconfigured.

K-7. **Graceful shutdown:** `enableShutdownHooks` + unref'd timers + outbox
`onModuleDestroy` — present. Jest worker force-exit warning observed in unit runs
(harmless; timers are unref'd but ts-jest workers linger) — informational.

---

## L. Documentation drift

| # | Drift | Evidence |
|---|---|---|
| 1 | IMPLEMENTATION_PROGRESS.md status line says P4 "ready for owner to open the PR" | **False** — PR #17 merged (`9e371ac`); `phase/4-billing` gone from remote. Fixed in this audit's progress update. |
| 2 | Progress table row "P5–P7 NOT STARTED" | Working tree contains a functionally complete P5 (uncommitted) with 18 passing e2e tests. Corrected in this audit's progress update. |
| 3 | `openapi.json` stale vs working tree (59 vs 65 paths; 71 vs 77 ops) | `node` parse + controller scan; contract-gate will fail on commit. |
| 4 | `schema.prisma` header comment: "Remaining tables land with their phases: billing payments (P4), notifications (P5)" | Payments already landed (P4); comment is stale but harmless. |
| 5 | docs/PLAN.md §6/§8 define `announcements` (table + 3 endpoints) | Not implemented anywhere (module, table, endpoints absent). This is both drift and the thesis "club activities" gap (C-3). |
| 6 | docs/PLAN.md §4.1 "MFA mandatory for ADMIN" | No enforcement code exists (I-1). |
| 7 | docs/PLAN.md §11.5 Sentry optional | Not wired; no SENTRY env var in env validation or `.env.example`. |
| 8 | docs/PLAN.md §3 repo layout lists `users/` module, `bruno/`, `load/` | `users/` functionality lives in auth; `bruno/` and `load/` do not exist. |
| 9 | README.md "Status: P0 bootstrap — auth, domain, billing, notifications arrive in phases P1–P7" | Stale: P0–P4 merged, P5 written. |
| 10 | Plan §12: k6 load smoke, Bruno UAT, 12-case security suite as a P6 package | The 12 security cases are realized **distributed** across e2e/security suites and pass, but the consolidated suite, k6, and Bruno collection do not exist. |
| 11 | Plan §5.3 "24 auth endpoints" | 24 auth paths / 25 operations incl. `DELETE /auth/me` (plan §7.2 names both deactivate and DELETE me) — consistent; noted to preempt a false-drift reading. |

---

## M. P0–P3 remediation table

No **P0** findings. (Build green, migrations replay, no security-critical or
financial-integrity blocker found in the tree.)

| ID | Sev | Finding | Evidence | Impact | Owner |
|---|---|---|---|---|---|
| P1-1 | P1 | P5 work uncommitted on `main` working tree with stale `openapi.json`; committing as-is fails contract-gate | `git status`; openapi parse (L-3) | Blocks the next PR; risks a messy mixed commit | TASK-01 kickoff: branch `phase/5-notifications-consent`, regenerate openapi, PR |
| P1-2 | P1 | ADMIN MFA enforcement missing (plan §4.1) | roles/jwt guards have no MFA check (I-1) | Admin endpoints usable without TOTP; contradicts documented security posture | TASK-05 |
| P1-3 | P1 | Email not deliverable (LoggingMailSender only; SMTP adapter missing) | `src/auth/mail/logging-mail.sender.ts` (I-2) | Verification/reset/notification flows don't reach users; blocks real deployment | TASK-04 (P5 completion) |
| P1-4 | P1 | Real QR gateway absent; `simulated` not forbidden in production; webhook secret optional in prod | env.validation.ts (I-3, J-3) | Thesis QR requirement unfulfillable with real rails; misconfiguration risk | TASK-04 (adapters) + TASK-05 (guards) |
| P2-1 | P2 | Announcements ("club activities") not implemented despite plan + thesis requirement | No module/table/endpoints (C-3, L-5) | Primary thesis value missing | TASK-04 |
| P2-2 | P2 | INSTRUCTOR QR-initiation vs invoice-read inconsistency | `billing.controller.ts:77-84` vs `billing.service.ts:411-412` (H-2) | Unclear/leaky role policy | TASK-03 |
| P2-3 | P2 | Webhook malformed-payload 401 vs always-200 design | `payments.service.ts:96-114` (H-5, J-2) | Provider retry storms on garbage events | TASK-03/05 |
| P2-4 | P2 | Race conditions: exam capacity, enrollment capacity, invite-code link | `exams.service.ts:170-177`, `enrollments.service.ts:66-71`, `parents.service.ts:38-57` (G-3) | Overbooking/duplicate links under concurrency | TASK-02 (constraints) |
| P2-5 | P2 | Rank regression possible at result entry | `exams.service.ts:260-265` (G-2) | Student's belt can be downgraded by a stale PASS | TASK-02/04 |
| P2-6 | P2 | Deployment trial not executed: no staging/prod, no release migrations, no backup/DR, no runbooks | ci.yml deploy job stub (K-3/K-4/K-5) | Thesis deployment activity undemonstrated; go-live risk | TASK-06 + owner (Render setup) |
| P2-7 | P2 | Throttle bucket key spoofable behind one appending proxy | `ip-throttler.guard.ts:11-14`, `bootstrap.ts:45` (I-4) | Rate-limit bypass under a specific proxy setup | TASK-05/06 |
| P3-1 | P3 | No per-student aggregated schedule endpoint | GET /classes catalog only (H-3) | Thesis "quickly view schedules" demo weaker than it could be | TASK-03 |
| P3-2 | P3 | `simulated` gateway checkoutUrl points to a non-existent route | `simulated.gateway.ts:28` | Dead link in local/e2e only; cosmetic | TASK-03 |
| P3-3 | P3 | Revenue report aggregates in memory; single-instance shared store; per-instance jobs | `billing.service.ts:355-385`, `shared-store.ts` | Fine at club scale; constraint on scale-out | INFORMATIONAL unless scaling |
| P3-4 | P3 | `MAIL_LOG_FILE` writes full messages (incl. tokens) to disk, unguarded by NODE_ENV | `logging-mail.sender.ts:24-27` | Footgun if enabled in prod | TASK-05 |
| P3-5 | P3 | Parent `rotateCode` returns the *current* code after 5 collision retries; concurrent link race | `parents.service.ts:99-111` | Astronomically unlikely code reuse | TASK-02 |
| P3-6 | P3 | Jest worker force-exit warning; docs status lines stale (README, schema header) | B-K7, L-4, L-9 | Cosmetic/noise | TASK-01 docs pass |

---

## N. Recommended next task

**TASK-01 (Architecture Reconciliation)** is eligible now, with this pre-condition
handled inside it:

1. Commit the P5 working set on `phase/5-notifications-consent` (branch already
   exists locally), regenerate `openapi.json`, and PR it — this clears P1-1 and
   converts P5 from PARTIAL-uncommitted to merged.
2. In TASK-01 itself, resolve the role-model questions this audit surfaced (Võ sư
   mapping decision, INSTRUCTOR payment-policy decision P2-2), and adopt the
   announcements design from plan §6/§8 for TASK-04.

TASK-04 (implementation) should sequence: SMTP adapter → announcements → real
payment gateway adapters; TASK-05 owns MFA enforcement and prod-config guards;
TASK-06 owns the deployment trial, backup/DR, and runbooks.

---

## Verification log (audit-provenance)

- `git branch -a`, `git log --oneline -25`, `git status --short`, `git stash list`.
- Full read: `prisma/schema.prisma`, `prisma/seed.ts`, `src/bootstrap.ts`,
  `Dockerfile`, `docker-compose.yml`, `docs/PLAN.md`, `IMPLEMENTATION_PROGRESS.md`,
  `README.md`, `.agents/prompts/tasks/00-current-state-audit.md`, P5 modules
  (notifications outbox/module, consent service), `.agents/state/README.md`.
- Decorator scan of all 13 controllers (routes + roles); `node` parse of
  `openapi.json`; `jest.config.ts`, `test/e2e/e2e-env.ts`, `test/jest-e2e.json`,
  `.github/workflows/ci.yml` (14 jobs incl. deploy stub), `.env.example` keys.
- Service-level review (evidence-cited) of billing/payments/exams/auth
  (register/login/refresh/deactivate), students serializer, parents, classes/
  enrollments/attendance, guards, throttler, metrics, env validation, jobs,
  notifications feed, consent controller.
- **Runs:** `npm test` → 271/271 (60 suites); disposable PostgreSQL 18
  (`initdb -D /tmp/pg-audit`, `pg_ctl -o "-p 5433 -k /tmp"`) → `prisma migrate
  deploy` clean → 24 tables; `npm run test:e2e` → 68/68 (12 suites).
