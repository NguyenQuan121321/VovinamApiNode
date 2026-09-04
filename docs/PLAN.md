# VovinamApiNode — Master Plan v3 (English, token-optimized)

Purpose: single execution spec for any AI/engineer building VovinamApiNode. Real production system for a legally registered Vovinam club: real students (including minors), parents, instructors; real tuition money; also a graduation thesis.

Reference sources: FinnApiGo codebase audited 2026-09-04 (49 routes, full enterprise auth P0-P2 implemented, 10 CI gates, >=90% coverage on core packages); `enterprise-auth-master-plan.md`; original spec `prompt_vovinam.md`; prior plan `VovinamApiNode_planv2.md` (v2 gap list in section 1). FinnApiGo is a pattern reference only: no shared secrets, no shared database.

Security posture (user requirement): NOT as strict as FinnApiGo, but must meet a complete baseline for real deployment with minors and payments. Calibration table in section 4.

---

## 1. Gaps in plan v2 that v3 fixes

1. v2 contained no domain model ("kept unchanged from v1" but content absent) — v3 includes full schema (section 6) and endpoint inventory (section 8).
2. No stack decision — v3 fixes: NestJS 11 + Prisma + PostgreSQL 16, no Redis initially.
3. Contradiction: v2 said "not overly strict" but decided to port FinnApiGo's heaviest auth wholesale. v3 replaces this with an explicit KEEP/SIMPLIFY/DROP table (section 4).
4. No DevOps (Docker, CI/CD, migration strategy, backup/DR, monitoring, secrets) — added in section 11.
5. Only 6 security test cases — expanded to 12 mandatory cases + test tiers (section 12).
6. No API conventions — added (section 9).
7. No observability — added (section 11.5).
8. No admin backoffice scope (cash confirmation, monthly billing, approvals) — added (sections 7, 8).
9. Zalo ZNS treated as an idea, not a plan (templates take 1-2 weeks to approve) — added to plan and risk register (section 15).
10. No acceptance criteria, go-live checklist, or estimates — added (sections 13, 14).
11. Minor-account flow only stated as a rule, not designed — designed in section 7.1.
12. Baokim as secondary channel adds integration cost without solving a problem cash handling doesn't — replaced by CASH recorded by admin; Baokim moved to backlog.

---

## 2. Scope and actors

In scope (backend API only; no frontend this phase): self-contained auth; student profiles + parent linking; classes, schedules, attendance; belt ranks and belt exams; invoices and payments (QR via one gateway + cash); notifications (email + ZNS/SMS); data-processing consent; admin backoffice API; CI/CD, Docker, backup, monitoring.

Actors and single role per user (known limitation, accepted; a person with two roles uses two accounts):
- ADMIN: club management, touches money.
- INSTRUCTOR: teaches classes, takes attendance, sees limited student data.
- STUDENT: own profile, attendance, invoices, exam registration.
- PARENT: linked to students via verified link, acts for minors.

---

## 3. Stack (decided)

| Component | Choice | One-line rationale |
|---|---|---|
| Language/runtime | Node.js 22 LTS + TypeScript | Team requirement (Node project) |
| Framework | NestJS 11 (Express adapter) | Module/Controller/Service/Guard/DTO maps 1:1 to the Handler-Service-Repository structure the team knows from FinnApiGo; class-validator DTOs; @nestjs/swagger auto OpenAPI |
| ORM | Prisma | Versioned SQL migrations in repo (`prisma migrate`), type-safe; never `db push` in prod |
| DB | PostgreSQL 16 | v2 SQL was already Postgres; cheapest managed option (Render/Aiven). If self-hosting on a VPS with the team's MySQL experience, Prisma driver swap; schema unchanged |
| Redis | None, phase 1 | Single instance. All shared state behind a `SharedStore` interface backed by in-memory Map + TTL sweeper; swap to Redis only when scaling out |
| Queue | In-process outbox worker (poll + retry/backoff) | Only notifications; BullMQ+Redis later if needed |
| Validation | class-validator, global whitelist + forbidNonWhitelisted | Anti mass-assignment |
| Auth libs | jsonwebtoken, bcrypt, otplib, qrcode, custom guards | Small, controllable |
| Logging | pino JSON + request-id interceptor; Sentry optional via env | |

Architecture rule (inherited from VovinamApiGo spec): Controllers never touch Prisma; Services never import HTTP-layer classes; every route with `:studentId` goes through the ownership guard (section 7.3).

Repo layout:
```
src/
  main.ts, app.module.ts
  common/      # envelope, exception filter, interceptors, decorators, SharedStore
  config/      # joi-validated env, fail-fast boot
  auth/ users/ students/ parents/ classes/ belts/ billing/ notifications/ consent/
  prisma/ health/
prisma/         # schema.prisma + migrations/ (SQL, committed)
test/e2e/ test/security/
bruno/ load/    # manual API collection; k6 scripts
Dockerfile docker-compose.yml .github/workflows/ci.yml
```

---

## 4. Security calibration vs FinnApiGo

Threat model: ~300 users, one club. Highest real risks: IDOR on children's data, payment integrity, credential stuffing. Not APT-grade. Decisions per item:

### 4.1 KEEP (cheap, high value)

| Item | Specification | Why kept |
|---|---|---|
| bcrypt | cost 10, 72-byte input cap | Standard |
| Password policy | min 8 chars, letters+digits, must not contain email/username | Enough; zxcvbn/HIBP is enterprise tier |
| JWT HS256 + kid rotation | JWT_SECRET + JWT_SECRET_PREVIOUS (2 keys) | Rotate without logging everyone out; ~50 LOC |
| Claims | uid, role, type, jti, sid, pwdver | Needed for denylist, session list, pwd_version |
| Refresh tokens | Opaque 256-bit, store SHA-256 hash only, rotate on every use, TTL 30 days | Anti-theft standard |
| Reuse detection | Replaying a rotated refresh token revokes ALL sessions of the user + email alert | FinnApiGo does per-session family isolation; collateral "logged out everywhere" is acceptable here |
| Access token TTL | 15 minutes | Zombie tokens die fast |
| pwd_version | Bumped on password change/reset, MFA disable, email change, logout-all; middleware rejects tokens with stale claim | One DB column kills all old access tokens instantly |
| jti denylist on logout | In-memory map, TTL = remaining access-token lifetime | No Redis needed, single instance |
| Lockout | 5 consecutive failures per account -> locked 15 minutes | Stops credential brute force |
| Rate limiting | @nestjs/throttler per-IP global + per-account counters on login/forgot-password/resend-verification; IPv6 normalized to /64 (lesson from FinnApiGo audit finding 2.5) | DoS/key-bloat protection |
| Anti-enumeration | Login returns uniform 401 "invalid email or password" for wrong password/locked/disabled/unverified (state notification goes out-of-band via email); register/forgot-password/resend-verification return identical responses regardless of account existence; timing equalization via dummy bcrypt compare for unknown users | Copied from FinnApiGo audit CRITICAL findings 2.1/2.2; cheap |
| Email verify / reset tokens | verify TTL 24h, reset TTL 15 min, single-use via `used_tokens` table with purge job; after reset: revoke all sessions + bump pwdver | |
| TOTP MFA | otplib; secret AES-256-GCM sealed with APP_ENCRYPTION_KEY; +/-1 step skew; replay guard 120s; ONE shared failure bucket across verify/validate/login-verify (5 fails / 5 min); 10 recovery codes stored hashed, single-use | Without shared bucket, 6-digit codes are brute-forceable (FinnApiGo audit) |
| MFA mandatory for ADMIN | ADMIN must enable TOTP before using admin endpoints | Admin touches money |
| Sessions table | UUID PK, ip, user_agent, device_name, last_active_at, revoked, expires_at; list/revoke/logout-all; revoke is IDOR-scoped | UX + security |
| Audit log | `audit_logs`, async batched writes (drop-with-counter on overflow), events: login/failed, logout, password_*, mfa_*, student.link_*, payment.confirm_*, invoice.issued; user-facing `GET /auth/me/audit-log` | Incident forensics + parent transparency |
| Security headers/CORS | helmet (nosniff, no-store, CSP for Swagger), CORS origin allowlist from env, 1 MB body cap, HSTS at reverse proxy | Free in Node |
| Health/metrics policy | /healthz liveness; /readyz pings DB; /metrics bearer-token-only; in release mode missing METRICS_TOKEN fails boot (lesson from FinnApiGo gap 2.8) | |
| Webhook verification | Gateway HMAC signature + idempotency + exact amount match (section 7.5) | Real money |
| Soft delete | users, student_profiles have deleted_at; financial tables use ON DELETE RESTRICT | Legal (section 10) |
| Field-level DTO serializer | Single `serializeStudent(profile, callerRole)` (section 7.4) | Children's data |

### 4.2 SIMPLIFY vs FinnApiGo

| FinnApiGo | VovinamApiNode | Reason |
|---|---|---|
| Redis for all shared state | In-memory behind SharedStore interface | Single instance |
| Session-family isolation on reuse | Revoke all user sessions | Few sessions per user |
| Exponential-backoff lockout + adaptive CAPTCHA | Flat 15-min lockout; CAPTCHA is an env toggle, default off (NoOp) | Real attack volume is low; toggle exists for spam |
| Sudo-mode token (X-Sudo-Token) | Inline password confirmation (+ TOTP code if MFA on) for sensitive actions | One less token type, simpler UX |
| RBAC engine (roles/permissions/role_permissions/user_roles tables) | Static 4-role guard + @Roles() decorator | Fixed small role set |
| Multi-tenancy (tenant_id everywhere) | Dropped entirely | One club |
| Audit hash-chaining + NDJSON export | No hash chain; simple CSV export for admin | SOC2-readiness not a goal |
| Trusted devices ("remember me") | Dropped | FinnApiGo implemented it but never wired it into login (dead code per audit) — do not replicate half-done features |
| zxcvbn score >=3 + HIBP breach check | Static policy | External dependency, fail-open design, negligible for 300 users |

### 4.3 DROP

WebAuthn/passkeys (parents use basic phones; TOTP is the sensible max). Google OAuth (minors lack own accounts; backlog if requested). JWT `perms` claim and per-tenant policies (FinnApiGo itself calls IssueAccessEnterprise with perms=nil, so the claim is never populated — audit finding; do not copy half-wired features). Fuzz testing, mandatory CodeQL, govulncheck (replaced by `npm audit --audit-level=high` + Dependabot; CodeQL is a one-click enable if desired). Pprof/multi-listener internals.

### 4.4 Baseline "sufficient security" evidence map (OWASP ASVS L1 full + selected L2 / API Top 10)

| Control | Where implemented | Proven by test |
|---|---|---|
| A1 Broken access control / IDOR | Ownership guard 7.3 + scoped queries on every id-bearing route | S-01, S-04 |
| A2 Cryptographic failures | bcrypt, AES-256-GCM TOTP secrets, hashed refresh/recovery tokens, HTTPS at proxy | review + config test |
| A3 Injection | Prisma parameterized queries, class-validator whitelist | E2E register/login |
| A4 Insecure design | Invite-code linking instead of raw IDs, no self-registration for minors | S-06 |
| A5 Misconfiguration | Fail-fast env, /metrics fail-boot, Swagger off in prod, CORS allowlist | boot test |
| A7 AuthN failures | Lockout + rate limits + shared TOTP bucket + uniform 401 | S-05, S-07 |
| A8 Data integrity | Webhook HMAC + idempotency + exact amount | S-03, S-11 |
| A10 SSRF | Webhooks are inbound-only; no user-controlled outbound fetch | review |

---

## 5. Auth design

### 5.1 Flows

- Register: POST /auth/register {email, password, role STUDENT|PARENT, contact info}. Minors (age < 18) may NOT self-register as STUDENT; a PARENT registers, then creates the student profile (7.1). STUDENTs >= 18 self-register but their profile starts status=PENDING until ADMIN approves. Response is uniform regardless of duplicate email (anti-enumeration); verification email TTL 24h, single-use via used_tokens.
- Login: rate limit -> lockout check -> bcrypt compare (timing-equalized dummy hash for unknown users) -> if TOTP enabled, return mfa_pending JWT (TTL 5 min) -> POST /auth/mfa/login-verify {totp code or recovery code} -> issue access + refresh tokens. All failures return uniform 401; locked/disabled/unverified states additionally trigger an out-of-band email.
- Refresh: rotate on use; reuse detection revokes all user sessions + email alert.
- Logout / logout-all / revoke session: per section 4.1.
- New-IP alert: if the successful-login IP is absent from audit_logs for this user in the last 30 days, send email. No extra table needed.

### 5.2 Auth tables

```
users:            id PK, email UQ, password_hash, role ENUM(ADMIN,INSTRUCTOR,STUDENT,PARENT),
                  email_verified_at, failed_login_attempts, locked_until, pwd_version,
                  is_active, deleted_at, created_at, updated_at
sessions:         id UUID PK, user_id FK->users, ip, user_agent, device_name, revoked,
                  last_active_at, expires_at, created_at
refresh_tokens:   id PK, user_id FK, session_id FK, token_hash UQ, revoked, expires_at, created_at
totp_credentials: user_id UQ FK, secret_encrypted BYTEA, enabled_at
recovery_codes:   id PK, user_id FK, code_hash, used_at, created_at
used_tokens:      jti PK, user_id, purpose ENUM(VERIFY_EMAIL,RESET_PASSWORD,CHANGE_EMAIL),
                  expires_at, created_at
audit_logs:       id PK, user_id, event, ip, success BOOL, detail VARCHAR(500), created_at
```

### 5.3 Auth endpoints (24)

register, login, mfa/login-verify, refresh-token, logout, logout-all, verify-email, resend-verification, forgot-password, reset-password, change-password, me, me/audit-log, change-email/request, change-email/confirm, deactivate (soft delete, section 7.2), sessions (GET), sessions/:id (DELETE), mfa/totp/enable, mfa/totp/verify, mfa/totp/validate, mfa/totp/recovery-codes, mfa/totp/disable, mfa/methods.

Explicitly excluded: passkey*, oauth*, trusted-device*, admin lock/force-logout (admin deactivation goes through the users module).

---

## 6. Domain schema (PostgreSQL, compact notation; FK behavior shown where it matters)

```
student_profiles:  id PK, user_id UQ NULL FK->users ON DELETE RESTRICT (null when parent creates
                   profile before student has an account), full_name, dob DATE, gender, phone,
                   address, emergency_contact_name, emergency_contact_phone,
                   medical_notes VARCHAR(1000) [sensitive], current_belt_rank_id FK NULL,
                   joined_at, status ENUM(PENDING,ACTIVE,PAUSED,LEFT), deleted_at, timestamps

parent_student_links: id PK, parent_user_id FK->users ON DELETE CASCADE,
                   student_id FK->student_profiles ON DELETE CASCADE,
                   relationship ENUM(PARENT,GUARDIAN) DEFAULT PARENT, verified BOOL DEFAULT false,
                   verified_by_user_id FK NULL, invite_code CHAR(8) UQ (single-use, generated at
                   profile creation), created_at, UQ(parent_user_id, student_id)
                   indexes: parent_user_id, student_id

belt_ranks:        id PK, code UQ (LAM_1..3, VANG_1..3, DO_1..6, HUYEN_1..), name,
                   rank_group ENUM(LAM,VANG,DO,HUYEN), order_index UQ, is_active
                   (seeded; instructor/admin editable)

classes:           id PK, name, instructor_id FK->users, location, capacity INT DEFAULT 30,
                   status ENUM(ACTIVE,...), timestamps
class_schedules:   id PK, class_id FK ON DELETE CASCADE, weekday SMALLINT 0-6,
                   start_time TIME, end_time TIME, effective_from DATE, effective_to DATE NULL
enrollments:       id PK, student_id FK ON DELETE RESTRICT, class_id FK ON DELETE RESTRICT,
                   enrolled_at, left_at NULL, UQ(student_id, class_id, enrolled_at::date)
attendance_sessions: id PK, class_id FK ON DELETE RESTRICT, session_date DATE,
                   instructor_id FK, topic VARCHAR(200), UQ(class_id, session_date)
attendance_records: id PK, attendance_session_id FK ON DELETE CASCADE,
                   student_id FK ON DELETE RESTRICT, status ENUM(PRESENT,LATE,ABSENT,EXCUSED),
                   note, recorded_by FK->users, UQ(attendance_session_id, student_id)

belt_exams:        id PK, code UQ (EXAM-2026-03), title, exam_date, location,
                   target_rank_id FK->belt_ranks, fee_amount INT (VND integer),
                   capacity INT NULL, registration_deadline DATE,
                   status ENUM(DRAFT,OPEN,CLOSED,COMPLETED,CANCELLED)
exam_registrations: id PK, exam_id FK ON DELETE RESTRICT, student_id FK ON DELETE RESTRICT,
                   current_rank_id FK NULL, target_rank_id FK,
                   status ENUM(PENDING_PAYMENT,PAID,RESULT_PASS,RESULT_FAIL,CANCELLED),
                   result_note, examiner_id FK, UQ(exam_id, student_id)

invoices:          id PK, invoice_no UQ (INV-2026-0001), student_id FK ON DELETE RESTRICT,
                   type ENUM(TUITION,EXAM_FEE,UNIFORM,OTHER), ref_exam_registration_id FK NULL,
                   period_month, period_year (TUITION), subtotal, discount, total (VND int),
                   status ENUM(UNPAID,PAID,OVERDUE,CANCELLED,REFUNDED), due_date, issued_at,
                   note, created_by FK->users, timestamps
invoice_items:     id PK, invoice_id FK ON DELETE CASCADE, description, quantity, unit_amount, amount
payment_transactions: id PK, invoice_id FK ON DELETE RESTRICT,
                   order_ref VARCHAR(20) UQ ("VV"+8 chars, embedded in transfer content),
                   gateway ENUM(PAYOS,SEPAY,CASH,BANK_TRANSFER),
                   gateway_txn_id VARCHAR(64) UQ NULL  [DB-layer idempotency guard],
                   amount INT, status ENUM(PENDING,SUCCESS,FAILED,REFUNDED,DISPUTED),
                   paid_at, expires_at (QR pending expires 30 min after creation),
                   recorded_by FK->users (who confirmed CASH), note, timestamps

consent_logs:      id PK, user_id FK ON DELETE RESTRICT, purpose ENUM(DATA_PROCESSING,
                   MEDIA_USAGE,MARKETING_NOTICE), consented_by_user_id FK (parent consents for child),
                   consented_at, revoked_at
notifications:     id PK, user_id FK NULL ON DELETE SET NULL, channel ENUM(EMAIL,ZNS,SMS,INAPP),
                   template_code, payload JSONB, status ENUM(QUEUED,SENT,FAILED,SKIPPED),
                   read_at NULL, retries, error VARCHAR(500), sent_at, created_at   [outbox]
announcements:     id PK, title, body TEXT, audience ENUM(ALL,CLASS), class_id FK NULL ON DELETE CASCADE,
                   published_at, created_by FK, created_at
app_settings:      key VARCHAR(50) PK, value JSONB, updated_by FK, updated_at
                   (bank_account{bin,number,name,owner_type:"BUSINESS"}, tuition_rates, gateway refs)
```

---

## 7. Domain business rules — binding decisions

### 7.1 Minor (<18) flow
1. Parent registers (PARENT role), verifies email.
2. ADMIN (or parent if `app_settings.allow_parent_create_student=true`) creates `student_profiles` row (no user account needed); system generates 8-char single-use `invite_code`.
3. ADMIN delivers the code via Zalo/in-person; parent calls POST /parents/link {inviteCode}; link becomes verified=true. Direct entry of student_id is never accepted.
4. Students >= 18 self-register; profile starts PENDING; ADMIN approves to ACTIVE.

### 7.2 Deletion
- DELETE /auth/me and POST /auth/deactivate set deleted_at / is_active=false, revoke all sessions/tokens, denylist current access token. Never hard-delete. Invoices and transactions remain (FK RESTRICT + soft delete).
- ADMIN "delete" of a student = same soft delete.
- Archival jobs only after a published retention policy; never ad-hoc deletion.

### 7.3 Ownership guard (anti-IDOR, most important control in the system)
Applies to EVERY route with :studentId or a student-owned :id. Violation returns 404 (not 403, to avoid id existence disclosure):
- STUDENT: student_profile.user_id == caller uid.
- PARENT: exists parent_student_links row with verified=true matching (caller uid, studentId).
- INSTRUCTOR: only for students enrolled in a class where classes.instructor_id == caller uid.
- ADMIN: full access.

### 7.4 Field-level serializer matrix

| Field | ADMIN | INSTRUCTOR (own class) | STUDENT (self) | PARENT (linked) |
|---|---|---|---|---|
| Name, belt, attendance history, classes | full | full | full | full |
| medical_notes | full | full | full | full |
| address, emergency contact, phone | full | none | full | full |
| Invoices / payment history | full | none | full | full |

### 7.5 Payments — one QR gateway + CASH
- Primary channel: exactly ONE auto-confirm QR gateway — payOS OR SePay (decide at implementation; module exposes a `PaymentGateway` interface so it can be swapped).
  1. POST /payments/qr/:invoiceId -> create payment_transactions row (PENDING, unique order_ref, expires_at=+30 min) -> call gateway create-payment API -> return QR/payment URL.
  2. POST /payments/webhook/:provider (public): verify HMAC signature -> only process incoming transfers -> extract order_ref by regex -> match pending transaction -> idempotency: gateway_txn_id UNIQUE + transactional processing (duplicate webhook = no-op, still 200) -> amount mismatch: DO NOT mark paid; log + flag for manual review -> always return 200 (except 401 on bad signature) so the gateway stops retrying.
- Secondary channel: CASH — POST /payments/:id/confirm-cash by ADMIN, same idempotency guard, audit event payment.confirm_cash.
- invoice status: automatically PAID when sum of SUCCESS transactions >= total; OVERDUE via daily job when past due_date. REFUNDED/DISPUTED supported for wrong transfers/refunds.
- Receiving bank account MUST be in the legal entity's name (app_settings.bank_account.owner_type='BUSINESS'); never a personal account of an admin (section 10).

### 7.6 Notifications (outbox pattern)
- Worker polls notifications QUEUED rows, sends via adapters: EmailSender (nodemailer SMTP), ZnsSender (Zalo OA — register OA and submit templates in week 1; approval takes 1-2 weeks), SmsSender (eSMS fallback). Fallback chain: ZNS -> SMS -> email.
- Templates: training schedule reminder, tuition due reminder, belt exam result, new-IP login alert, token-reuse alert, club announcements.
- INAPP: GET /notifications/me, PATCH /notifications/:id/read (read_at column).

### 7.7 Monthly tuition close (most-used backoffice operation)
POST /admin/billing/generate-monthly {month, year, classIds[]}: scan ACTIVE enrollments for that month -> create TUITION invoices from app_settings.tuition_rates (per class) -> idempotent via UQ(student_id, type, period_month, period_year) -> outbox sends ZNS/email with QR link. No per-invoice manual work.

---

## 8. Endpoint inventory (domain, ~30; plus 24 auth + 3 ops = ~57 total)

| Module | Method + Path | Roles | Notes |
|---|---|---|---|
| students | GET /students (filter class/status), POST /students, GET /students/:id, PATCH /students/:id, DELETE /students/:id | ADMIN (GET also INSTRUCTOR for own classes) | POST returns invite_code for the parent |
| students | POST /students/:id/invite-code | ADMIN | new code, revokes old |
| students | GET /students/me | STUDENT | |
| parents | POST /parents/link, GET /parents/me/children, DELETE /parents/links/:studentId | PARENT | delete requires ADMIN approval unless link unverified |
| classes | GET /classes, GET /classes/:id | any authenticated | |
| classes | POST /classes, PATCH /classes/:id, POST /classes/:id/schedules | ADMIN | |
| enrollments | POST /enrollments, DELETE /enrollments/:id, GET /enrollments?classId= | ADMIN | |
| attendance | POST /attendance-sessions, POST /attendance-sessions/:id/records (bulk upsert), GET /attendance-sessions/:id/records | INSTRUCTOR (own class) | |
| attendance | GET /students/:id/attendance?from=&to=, GET /attendance/summary?studentId=&month= | per guard 7.3 | summary = present/absent counts |
| belts | GET /belt-ranks | authenticated | |
| belts | POST /belt-ranks, PATCH /belt-ranks/:id | ADMIN | |
| exams | GET /belt-exams, POST /belt-exams, PATCH /belt-exams/:id | ADMIN | |
| exams | POST /belt-exams/:id/register | STUDENT/PARENT per guard 7.3 | auto-creates EXAM_FEE invoice |
| exams | POST /exam-registrations/:id/result | ADMIN/INSTRUCTOR | RESULT_PASS updates student current_belt_rank_id |
| billing | GET /invoices (role-scoped), GET /invoices/:id, POST /invoices, POST /admin/billing/generate-monthly | ADMIN | |
| billing | POST /payments/qr/:invoiceId, POST /payments/webhook/:provider (public+HMAC), POST /payments/:id/confirm-cash, GET /payments?invoiceId=, PATCH /payments/:id (refunded/disputed) | per section 7.5 | |
| billing | GET /admin/reports/revenue?from=&to= | ADMIN | revenue by month/channel |
| notifications | GET /notifications/me, PATCH /notifications/:id/read | authenticated | |
| consent | POST /consent, GET /consent/me | authenticated | |
| announcements | GET /announcements (ALL + own classes), POST/PATCH/DELETE /announcements | ADMIN | |
| ops | GET /healthz, GET /readyz | public | GET /metrics bearer-only |

---

## 9. API conventions

- Uniform envelope: `{"code":200,"message":"...","data":...}` (same as FinnApiGo/VovinamApiGo); global exception filter maps all errors into the envelope.
- Pagination: ?page=1&limit=20 (limit capped at 100); response `{items,total,page,limit}`.
- Errors: short messages, no internal-condition disclosure (auth especially — uniform 401); details only in logs.
- Idempotency: every payment/registration creation guarded by a unique constraint; webhooks by gateway_txn_id.
- Versioning: /api/v1 prefix; 1 MB body cap; timestamps ISO-8601 UTC.
- OpenAPI generated at build via @nestjs/swagger; swagger-ui only when SWAGGER_ENABLED=true (off in prod, or enabled with CSP).

---

## 10. Vietnam legal compliance (mandatory: legal entity, minors, real money)

| Regulation | System action |
|---|---|
| Decree 13/2023/ND-CP (personal data, sensitive data) | consent_logs per purpose (registration, notifications, media usage), revocable via API, separate from general ToS |
| Children Law 2016 | No self-registration for minors (7.1); parents consent on behalf; club photos/videos of minors published only with MEDIA_USAGE consent |
| Accounting Law — document retention | No CASCADE on financial chain; soft delete; never anonymize invoices. Retention minimum 5 years (invoices recommended 10) — confirm exact figures with an accountant |
| Circular 25/2025/TT-NHNN + Decree 68/2026/ND-CP | Fee-collecting bank account in the legal entity's name, declared to tax authorities; owner_type='BUSINESS' config guard |
| E-invoices (Decree 123/2020, Circular 78/2021) | Internal invoices sufficient initially; consult an accountant/tax advisor BEFORE scaling fee collection — outside pure engineering scope |

---

## 11. DevOps

### 11.1 Environments and secrets
- local: docker-compose runs only Postgres; app via `npm run start:dev`. staging: Render + managed Postgres, fake data. prod.
- Env vars validated fail-fast (joi) — missing required var blocks boot (mirrors FinnApiGo): DATABASE_URL, JWT_SECRET, JWT_SECRET_PREVIOUS (optional), JWT_ISSUER=vovinam-api, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, APP_ENCRYPTION_KEY (32-byte, required in release), MAX_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_DURATION, RATE_LIMIT_*, SMTP_*, PAYOS_* or SEPAY_*, ZALO_OA_*, METRICS_TOKEN, SWAGGER_ENABLED, CORS_ALLOWED_ORIGINS.
- Secrets only in platform env; .env.example complete; pino redaction for secret-shaped fields.

### 11.2 Docker and migrations
- Dockerfile multi-stage, non-root, `node --enable-source-maps dist/main.js`.
- Migrations: prisma migrate SQL committed to repo; no `db push` in prod; prod applies via `prisma migrate deploy` in release command.

### 11.3 CI/CD (GitHub Actions; mirrors FinnApiGo gates, right-sized)

| Job | Gate |
|---|---|
| lint | eslint + prettier --check |
| build-test | tsc --noEmit; jest --coverage with floor 75% on auth, billing, classes (ratchet upward over time) |
| migration-dry-run | Postgres service -> prisma migrate deploy on empty DB -> assert tables/version |
| integration | Postgres service -> run test/e2e + test/security (supertest) |
| audit | npm audit --audit-level=high; Dependabot weekly |
| docker | image build |
| deploy | all green + push to main -> Render deploy hook (RENDER_DEPLOY_HOOK secret) |

### 11.4 Backup / DR
- Managed Postgres daily PITR (provider).
- Additional weekly pg_dump to offsite object storage (Cloudflare R2) + monthly restore drill into staging (`scripts/restore-drill.sh`).
- Targets: RPO 24h, RTO 4h; documented in runbook.

### 11.5 Observability
- pino JSON logs + request-id middleware; optional Sentry (env DSN).
- UptimeRobot (free) hitting /healthz every 5 min -> alert to admin Telegram/Zalo.
- /metrics via prom-client: http duration/errors, login failures, payment successes — bearer-only.
- docs/OPERATIONS.md runbook (mirror FinnApiGo): log inspection, restart, restore, JWT secret rotation, webhook-mismatch handling.

---

## 12. Testing strategy

Tiers:
- Unit (jest, Prisma mocked): password policy, lockout, serializer 7.4, TOTP shared bucket, webhook order_ref parsing, ownership guard.
- E2E (supertest, real Postgres in CI): register->verify->login->refresh->logout lifecycle; parent link; attendance; invoice->QR->webhook->PAID; exam flow.
- Security suite (12 cases below) — all must pass before go-live.
- Load smoke (k6): login + payment-status polling, 50 VU / 2 min — N+1/query smell detection only.
- UAT: Bruno collection (folders Auth/Students/Classes/Billing/Admin) + per-module acceptance checklist (mirrors FinnApiGo's Bruno/ pattern).

Coverage floor: 75% on auth, billing, classes (FinnApiGo's 90% is not needed here; raise via ratchet if desired for thesis scoring).

### 12.1 Twelve mandatory security test cases

| # | Case | Expected |
|---|---|---|
| S-01 | Parent A requests students/:id of parent B's child | 404, no information leak |
| S-02 | Soft-delete a student who has invoices | invoices/transactions intact; profile hidden from default queries |
| S-03 | Duplicate webhook gateway_txn_id, twice incl. parallel calls | processed once; 200 both times |
| S-04 | INSTRUCTOR reads a student outside own class | 404; for own-class students response contains no address, phone, invoices |
| S-05 | 6 consecutive wrong TOTP on validate, then login-verify | blocked by the SAME shared bucket (5/5 min) |
| S-06 | User <18 self-registers role STUDENT | rejected; only via parent/ADMIN path (7.1) |
| S-07 | Login with nonexistent user / wrong password / locked / disabled / unverified | all uniform 401 with identical message; locked/disabled/unverified also send out-of-band email |
| S-08 | Replay an already-rotated refresh token | ALL user sessions revoked + email alert |
| S-09 | forgot-password for existing vs nonexistent email | identical response, timing delta < 50 ms (dummy bcrypt) |
| S-10 | 30 requests from different IPv6 addresses in same /64 | shared bucket -> 429 |
| S-11 | Webhook with bad signature / wrong amount | 401 no processing / not marked paid, flagged for review |
| S-12 | Reuse access token after logout | 401 (jti denylist) |

---

## 13. Roadmap (11 weeks, solo part-time + AI assistance)

| Phase | Week | Content | Acceptance criteria |
|---|---|---|---|
| P0 Bootstrap | 1 | Repo, CI skeleton, docker-compose Postgres, Prisma+migrate, envelope/filter/request-id, helmet/CORS, healthz/readyz, Swagger, seed script (first admin, belt_ranks) | CI green all jobs; migrate up/down in CI; Swagger reachable |
| P1 Auth | 2-3 | Full section 5 (login/refresh/MFA/sessions/audit/change-email/deactivate) | S-05, S-07, S-08, S-09, S-12 pass; auth coverage >= 75% |
| P2 Domain core | 4-5 | students/parents (invite-code)/classes/schedules/enrollments/attendance + guard 7.3 + serializer 7.4 + soft delete | S-01, S-02, S-04 pass; one full attendance-session E2E |
| P3 Belts and exams | 6 | belt_ranks seed, exams, exam registration (creates invoice), result entry, rank promotion | E2E: open exam -> register -> PASS -> current_belt_rank_id updated |
| P4 Billing | 7-8 | invoices + generate-monthly + QR gateway (payOS/SePay sandbox) + CASH + idempotent webhook + revenue report | S-03, S-11 pass; one real sandbox payment: QR -> webhook -> invoice PAID |
| P5 Notifications and consent | 9 | Outbox + email templates + ZNS (OA approved) / SMS fallback + new-IP alert + consent + announcements | consent E2E; one ZNS template delivered to a real number (staging) |
| P6 Hardening and QA | 10 | Full 12-case security suite, k6 smoke, OWASP checklist 4.4, staging deploy, restore drill, README/OPERATIONS.md/SECURITY.md (mirror FinnApiGo: vulnerability reporting policy + patch SLA) | 12/12 pass; restore drill successful; full Bruno UAT on staging |
| P7 Go-live | 11 | Prod seed (admin, ranks, classes, tuition rates), DNS/TLS, UptimeRobot, admin training, first student data entry, first real tuition collection | Section 14 checklist fully signed; thesis demo ready |

Operating rule (from FinnApiGo): maintain IMPLEMENTATION_PROGRESS.md (task table + handoff log, updated every session); never leave the build red.

---

## 14. Go-live checklist

- 12/12 security tests pass on staging (not just "passed locally once").
- PITR backup enabled + one successful restore drill with log/video evidence.
- /metrics not public; Swagger off in prod; prod JWT_SECRET is fresh 64-hex; APP_ENCRYPTION_KEY 32-byte.
- Fee-collecting bank account in the legal entity's name + tax declaration filed (photo evidence archived).
- Zalo OA + ZNS templates approved (or SMS fallback confirmed working).
- UptimeRobot (+ Sentry if enabled) alerts reachable by admin.
- Prod seed: exactly one ADMIN, TOTP enabled, password never reused.
- CORS restricted to the real app domain; HSTS on at proxy; TLS grade A (ssllabs).
- ADMIN trained: monthly close, cash confirmation, attendance entry, report export.
- Data/consent policy published to parents (club document).
- Documented plan B if gateway webhook fails: manual cash/transfer confirmation procedure within 5 minutes.

---

## 15. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| ZNS template approval delay (1-2 weeks) | High | Register OA + submit templates in week 1; SMS/email fallback ready |
| Parents without email | Medium | Phone-first design: ZNS primary, email backup; email still required for verification — admin can assist account creation |
| Gateway webhook outage | Medium | Invoice status polling; admin manual confirm; daily reconciliation report |
| Wrong tuition/schedule seed data | High | Seed via app_settings + admin UI, nothing hardcoded; UAT with the club master before go-live |
| Single developer (bus factor 1) | High | IMPLEMENTATION_PROGRESS.md + runbook + Bruno collection; decisions recorded in this plan |
| E-invoice obligation when scaling fees | Certain later | Section 10 — accountant consult before scaling; does not block initial go-live |
| Migrating paper/Excel records | Medium | Optional CSV import script (week 10): student list + current ranks |

---

## 16. Non-goals / post-go-live backlog

Google OAuth and Zalo login; Baokim/escrow; passkeys; e-invoice gateway integration; Zalo Mini App / mobile app; instructor payroll; uniform/inventory management; multi-club (multi-tenant); tournament management; Redis + horizontal scaling; attendance analytics.
