# VovinamApiNode — Final QA Report (TASK-06)

QA date: 2026-09-24. Scope: **final release and thesis QA gate**. No feature work, no
redesign. Every claim below is backed by a command run in the QA session against the
release tree (`origin/main` @ `61c711b`, QA branch `docs/final-qa`), a passing test, or a
named document produced by an earlier approved task. Verification runs performed by this
QA session are marked **[verified 2026-09-24]**; everything else cites its producing task
document.

Inputs: `docs/CURRENT_STATE_AUDIT.md` (TASK-00), `docs/SYSTEM_ARCHITECTURE_BASELINE.md`
(TASK-01), `docs/DATABASE_BASELINE.md` (TASK-02), `docs/API_BASELINE.md` (TASK-03),
TASK-04/TASK-05 handoffs (`IMPLEMENTATION_PROGRESS.md`), `docs/SECURITY.md`,
`docs/PLAN.md`, `.agents/AGENTS.md` + global contract, and the repository itself.

One minimal fix was made by this QA (allowed: missing mandatory security case, test-only):

- **S-02 regression test added** — `test/e2e/students-roles.e2e-spec.ts`: "S-02:
  soft-deleting a student with invoices leaves the financial chain intact" (asserts the
  invoice + items survive a student soft delete with `deleted_at` set and the profile
  hidden). The TASK-00 audit had credited an "S-02 suite" that did not actually exist in
  the tree; the case is now directly tested. Regression: suite re-run green **[verified
  2026-09-24]**.
- README status line corrected (was still "P0 bootstrap", audit drift L-9); one line, docs
  only.

---

## 1. Executive Summary

The system implements all ten thesis requirements. Nine are **PASS** with direct test
evidence; the tenth (deployment trial, requirement 9) is **PARTIAL** — the application
side (image, health/readiness/metrics, migrations, configuration fail-fast, graceful
shutdown) is built and verified, but the *executed* deployment trial (staging/prod
instance, release-command migrations, backup/DR drill, smoke against a live URL) requires
owner-provided hosting and secrets and has not been run. The real payOS sandbox
demonstration (QR → webhook → PAID with real rails) is likewise code-complete and
unit-verified but blocked on owner credentials.

All quality gates pass on the release tree **[verified 2026-09-24]**: format ✓, lint ✓,
typecheck ✓, build ✓, **325/325 unit (66 suites)** with coverage floors met (global
91.09% statements), **86/86 e2e + security (15 suites)** vs disposable PostgreSQL 18,
migrations replay from empty DB → **25 tables**, schema↔migrations drift check clean,
seed idempotent, OpenAPI regenerate idempotent (67 paths / 81 operations), spectral
**0 errors**, `npm audit --audit-level=high` → **0 vulnerabilities**, CI on the release
commit **13/13 applicable jobs green**.

No P0 or P1 security, data-integrity, or financial finding remains open. The release
decision is **RELEASE READY WITH DOCUMENTED LIMITATIONS** (§12): the prototype is ready
for demonstration and for the thesis; the deployment trial, backup/DR drill, and real
payment-sandbox demo are named owner actions, not code defects.

## 2. Thesis Traceability Matrix

Legend: PASS = implemented + test evidence; PARTIAL = implemented with a named gap;
NOT IMPLEMENTED = absent; OUT OF SCOPE = plan §16 boundary. No requirement is marked PASS
without test or run evidence.

| # | Thesis requirement | Use case | Module | Database | API | Test evidence | Result |
|---|---|---|---|---|---|---|---|
| 1 | Students view class schedules | Browse schedule catalog | `classes` | `classes`, `class_schedules` | `GET /classes`, `GET /classes/:id` | classes-attendance e2e (schedule round-trip, any-authenticated read) | **PASS** (catalog form; per-student aggregated read is an approved optional deferral, API baseline D-1/DD-02) |
| 2 | Students view tuition | Role-scoped invoice reads | `billing` | `invoices`, `invoice_items` | `GET /invoices`, `GET /invoices/:id` | billing e2e "scopes invoice reads per role" | **PASS** |
| 3 | Students view club activities | Audience-scoped announcements | `announcements` | `announcements` | `GET/POST/PATCH/DELETE /announcements` | announcements e2e 6/6 (ALL/CLASS audience scoping, admin-only writes) | **PASS** |
| 4 | Admin manages club operations | Backoffice across all domains | students, classes, enrollments, belts, exams, billing | 15 admin-write tables + `app_settings` | 30+ ADMIN ops | domain e2e suites + students-roles 403/200 matrix | **PASS** |
| 5 | Instructor manages training operations | Attendance, results, own-class data | attendance, exams, students | `attendance_*`, `exam_registrations.examiner_id` | attendance 5 ops, result entry | classes-attendance e2e (S-04), belts-exams e2e (result entry) | **PASS** |
| 6 | QR payment | Gateway QR + settlement | `billing` (payments) | `payment_transactions` | `POST /payments/qr/:invoiceId`, webhook, confirm-cash | billing e2e (QR→webhook→PAID, S-03, S-11, DD-04, CASH); payOS adapter unit-verified against SDK-derived vectors | **PARTIAL** — architecture and code complete on `PaymentGatewayPort` (simulated + payOS adapters); real-sandbox demo pending owner credentials (R-9) |
| 7 | Role-based authorization | 4-role RBAC + ownership + serializer | auth guards, students | `users.role` | all routes | S-01/S-04/S-13 e2e, roles.guard + serialize-student unit specs | **PASS** |
| 8 | Testing | Three-tier suite, coverage floors, contract gate | — | — | — | **[verified 2026-09-24]** 325/325 unit, 86/86 e2e+security, spectral 0 errors, CI build-test + integration green | **PASS** |
| 9 | Deployment trial | CI → deploy → smoke | — | — | — | CI docker + container-scan green; health/readiness/metrics e2e green; prod boot guards demonstrated | **PARTIAL** — deploy CI job is a documented stub (no `RENDER_DEPLOY_HOOK`/`SMOKE_TEST_URL`); no staging/prod instance; no backup/DR drill. Owner action (§9) |
| 10 | Student management incl. minors | Profiles, invite-code parent links, soft delete, consent proxy | students, parents, consent | `student_profiles`, `parent_student_links`, `consent_logs` | students 7 + parents 3 + consent 3 ops | students-roles e2e (invite code, link rules, soft delete + S-02), notifications-consent e2e (consent proxy/revocation) | **PASS** |

Stack traceability: Node.js/TypeScript ✓; React frontend = separate project (documented
boundary, architecture baseline §5) ✓; PostgreSQL ✓; REST `/api/v1` ✓; QR △ (see #6);
role-based authorization ✓.

Actor traceability (AD-02/AD-03): Admin→ADMIN; Võ sư→ADMIN persona + examiner
attribution field (no fifth role — approved); Huấn luyện viên→INSTRUCTOR; Võ sinh→STUDENT
role + `StudentProfile` domain row (minors without accounts); Parent→PARENT supporting
actor.

## 3. Functional Verification

All ten mandatory TASK-06 business lifecycles verified against the real (staging-like)
disposable PostgreSQL 18 database **[verified 2026-09-24]**:

| # | Mandatory lifecycle | Covering suites (all green in the 86/86 run) |
|---|---|---|
| 1 | Register → verify email → login → refresh → logout | `auth-lifecycle.e2e-spec.ts` (register/verify/login/me; refresh rotation + consumed-token rejection); `auth-coverage.e2e-spec.ts` (resend, reset via mailed token, deactivate, DELETE /auth/me) |
| 2 | MFA: enroll → login with TOTP → recovery-code use → disable | `auth-coverage.e2e-spec.ts` (mfa/methods, recovery-codes, totp/disable with next-step code); `s05-totp-shared-bucket` (login-verify path); `s13-admin-mfa.e2e-spec.ts` (enrollment through the real API via shared helper) |
| 3 | Parent: register → link via invite code → access child data | `students-roles.e2e-spec.ts` (invite code, verified link, full-field child read, rotated code fails for a second parent, unlink rules) |
| 4 | Class → enrollment → attendance session → bulk records → history/summary | `classes-attendance.e2e-spec.ts` (full session: create → bulk upsert → overwrite → read back → history + monthly summary) |
| 5 | Belt rank → exam → registration (invoice created) → result → promotion | `belts-exams.e2e-spec.ts` (rank catalog, OPEN gating, self/parent registration with EXAM_FEE invoice, capacity, PASS promotes `current_belt_rank_id`, FAIL leaves rank) |
| 6 | Invoice → QR → signed webhook → exactly-once settlement → PAID | `billing.e2e-spec.ts` (QR + verified webhook → PAID; duplicate `gateway_txn_id` incl. parallel deliveries S-03; signed-but-malformed → 200 no-op DD-04; bad signature / wrong amount never pay S-11) |
| 7 | Monthly tuition generation → payment → revenue report | `billing.e2e-spec.ts` (generate-monthly idempotent per (student, period), skips unrated classes; refund re-derives invoice; revenue by month/channel) |
| 8 | Notification: queue → deliver → retry/fallback | `notifications-consent.e2e-spec.ts` (atomic enqueue on invoice issue, worker flush delivers EMAIL, foreign-id 404s, admin-only flush); unit specs: ZNS→SMS→EMAIL fallback, transient failure + backoff, retry cap → FAILED, stale-SENDING recovery (`notification-outbox.service.spec.ts`) |
| 9 | Consent: grant → use → revoke → revocation honored | `notifications-consent.e2e-spec.ts` (grant + audit, idempotent re-grant, parent proxy for linked minor, adult-child rejection, unlinked-parent 404, revoke keeps history) |
| 10 | Admin operation → corresponding audit record | `auth-coverage.e2e-spec.ts` (`GET /auth/me/audit-log` with `AuditService.flush()`); audit assertions inside consent, belt/exam, invoice, and payment tests |

Flow-by-flow status against the QA task list: **AUTH** (register, verify, login, session
list/revoke, refresh, logout, password lifecycle incl. change/reset/change-email,
deactivate, MFA with ADMIN enforcement) — PASS. **STUDENT** (create, view, update,
ownership, soft delete) — PASS. **TRAINING** (class, schedule, enrollment, leave/rejoin,
attendance) — PASS. **BELTS/EXAMS** (rank, exam, registration, result, promotion) — PASS.
**TUITION/PAYMENT** (invoice, monthly generation, QR, webhook, duplicate webhook,
payment confirmation auto+cash, refund/dispute, reporting) — PASS at code level; the QR
column is PARTIAL only for the real-rails demo (§2 #6). **PARENT** (verified linking,
allowed access, denied access) — PASS. **CLUB ACTIVITIES** (announcements, audience
rules, student access) — PASS. **NOTIFICATIONS/CONSENT** — PASS within approved scope
(outbox + INAPP feed + EMAIL channel; ZNS/SMS are fail-safe stubs by approved design,
SECURITY.md §11.4).

## 4. Authorization Verification

The approved permission matrix (architecture baseline §10, API baseline §3) was compared
with actual behavior; every cell below has a passing test **[verified 2026-09-24]**:

| Rule | Expected | Evidence |
|---|---|---|
| Roles | Exactly ADMIN/INSTRUCTOR/STUDENT/PARENT; one role per user | `UserRole` enum; roles.guard unit specs (match/403/401) |
| ADMIN MFA enforcement (plan §4.1) | 403 "MFA enrollment required" on admin-admitting routes until TOTP exists; self-scoped bootstrap stays reachable; non-ADMIN unaffected | `roles.guard.spec.ts` (3 dedicated cases) + `s13-admin-mfa.e2e-spec.ts` (5 tests) |
| INSTRUCTOR financial surface | **Zero**: 404 on invoice/payment reads (plan §7.4), 403 on QR initiation (AD-06) | billing e2e "scopes invoice reads per role" + "excludes instructors from QR payment initiation (AD-06)" |
| Ownership guard 7.3, 404 posture | STUDENT self, PARENT verified link, INSTRUCTOR own-class, ADMIN full; violation → uniform 404 (never 403, anti-probing) | students-roles, classes-attendance, belts-exams, notifications-consent e2e (S-01/S-04 paths) |
| Object access beyond students | Notifications foreign id → 404; foreign session revoke → uniform 401; announcements audience-scoped | notifications-consent e2e, auth-coverage e2e, announcements e2e |
| Data exposure (plan §7.4) | INSTRUCTOR loses address/phone/emergency contact; no password hashes, TOTP secrets, or token hashes in any response | serialize-student.spec.ts; API baseline §8 inspection (all serializers) |
| Privilege escalation | STUDENT on admin routes → 403; non-admin on MFA gate unaffected; malformed ids → 400 not 500; every unannotated route is self-scoped or service-guarded (AD-09 invariant) | students-roles e2e, roles.guard.spec, ParseUuidPipe convention (API baseline §9), TASK-03 re-verification |
| Webhook (public route) | HMAC over raw body or 401; no JWT | billing e2e (S-11 bad-signature case) |

No escalation or exposure gap was found. One intentional, documented boundary: routes
without `@Roles` metadata remain reachable by a password-only ADMIN (bootstrap path for
MFA enrollment itself) — a password-only ADMIN cannot write anything, list students, or
read financial data (SECURITY.md §1).

## 5. Database Verification

**[verified 2026-09-24]** against disposable PostgreSQL 18.6 (`initdb`/`pg_ctl`, :5433):

| Check | Result |
|---|---|
| Migrations replay from empty DB | `prisma migrate deploy` on a fresh database: all 7 migrations applied cleanly |
| Table assertion | **25 tables** — exactly the CI-asserted list (24 domain + `_prisma_migrations`, incl. `announcements`) |
| Migration status | `prisma migrate status`: "Database schema is up to date!" (7 migrations) |
| Schema matches migration history | `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code`: **"No difference detected"** (no drift) |
| Applied history frozen | All 7 migration directories match the TASK-02 record; none modified after application (baseline §15) |
| Constraints / FKs / uniqueness | Inventory re-verified in DATABASE_BASELINE §4–§7: financial chain RESTRICT (`invoices`→`payment_transactions`→…), `gateway_txn_id UQ`, `UQ(student,type,period_month,period_year)`, `UQ(exam,student)`, `UQ(class,session_date)`, `UQ(session,student)`, `token_hash UQ`, `used_tokens.jti` PK single-use — each exercised by a named e2e (S-03, monthly idempotency, duplicate registration 409, session-per-day 409, S-08) |
| Historical-data preservation | Enrollment soft-leave, attendance upsert-by-key, invoices never deleted; S-02 now directly tested (this QA's regression test) |
| Financial-data preservation | S-02 e2e: soft delete keeps invoice + items with `deleted_at` set; refund/dispute re-derivation e2e; OVERDUE never regresses (unit) |
| Idempotency | Webhook exactly-once (S-03 incl. parallel), CASH double-confirm → 409, monthly generate idempotent, registration UQ — all e2e-verified |
| Seed safety | `prisma db seed` run **twice** — idempotent; without `ADMIN_EMAIL`/`ADMIN_PASSWORD` it seeds settings only and skips the admin (uniform, non-fabricating) |

Race-condition fixes (TASK-04, DB baseline §12) re-verified by their deterministic e2e
suite `db-integrity-races.e2e-spec.ts` (4 tests, green in the 86/86 run): capacity row
locks (enrollment, exam), invite-code claim-first, stale-PASS rank-regression 409.

## 6. API/OpenAPI Verification

**[verified 2026-09-24]**:

- `npm run openapi:generate` → "openapi.json written (67 paths)"; the regenerated file is
  **byte-identical** to the committed contract (idempotent — no route drift since TASK-03).
- Parse: **67 paths / 81 operations**, matching `docs/API_BASELINE.md` §4 exactly.
- `npm run contract:lint` (spectral, `--fail-severity=error`): **0 errors** (81
  pre-existing description-only warnings — unchanged, non-blocking).
- Swagger UI + JSON served and asserted by `swagger.e2e-spec.ts` when `SWAGGER_ENABLED=true`.
- Routes/methods/DTOs/status codes/validation: enforced by the CI contract-gate
  (staleness + spectral) on the release commit — **success** — plus the 86-test e2e suite
  exercising every path family (endpoint-coverage discipline since session 14; TASK-03
  re-verified 1:1 controller↔contract correspondence).
- Ownership and authorization on the contract level: §4 above.

## 7. Security Verification (release gate)

Review of all remaining findings from the TASK-00 audit (§M) and later baselines:

| ID | Finding | Disposition at QA |
|---|---|---|
| P0 | (none ever raised) | — |
| P1-1 | P5 uncommitted + stale openapi | **RESOLVED** — PR #22 merged; contract 67/81 regenerated, gate green |
| P1-2 | ADMIN MFA enforcement missing | **RESOLVED** (TASK-05) — RolesGuard enforcement, unit + S-13 e2e |
| P1-3 | Email not deliverable (no SMTP) | **RESOLVED code-wise** (TASK-04) — `MAIL_DRIVER=smtp` adapter + factory + joi; real delivery needs deployment-time SMTP credentials (config, not code) |
| P1-4 | No real gateway; prod guards missing | **RESOLVED code-wise** (TASK-04/05) — payOS adapter unit-verified against SDK-derived vectors; prod guards **demonstrated live at boot** this QA (below); real-sandbox demo pending owner credentials (R-9) |
| P2-1 | Announcements missing | **RESOLVED** (TASK-02/03) — table + module + 6 e2e |
| P2-2 | INSTRUCTOR QR/read inconsistency | **RESOLVED** (AD-06) — e2e |
| P2-3 | Webhook malformed → 401 vs always-200 | **RESOLVED** (DD-04) — e2e |
| P2-4 | Capacity/invite races | **RESOLVED** (TASK-04) — deterministic e2e |
| P2-5 | Result-time rank regression | **RESOLVED** (TASK-04) — e2e (G-2) |
| P2-6 | Deployment trial not executed | **OPEN — owner dependency** (§9); classified P2, not a P0/P1 blocker |
| P2-7 | Throttle key spoofable behind appending proxy | **RESOLVED** (TASK-05) — key pinned to `request.ip`; deployment requirement documented (SECURITY.md §3) |
| P3-1 | Per-student aggregated schedule | **DEFERRED (approved)** — DD-02, optional extension |
| P3-2 | Simulated-gateway dead checkout link | **Accepted/cosmetic** — simulated is dev/e2e-only and now production-forbidden |
| P3-3 | In-memory report aggregation; single-instance state | **Accepted constraint** — AD-11/DD-03, club scale |
| P3-4 | `MAIL_LOG_FILE` token-bearing file unguarded | **RESOLVED** (TASK-05) — production-forbidden (env.validation.spec) |
| P3-5 | Invite-code rotation footgun | **RESOLVED** (TASK-04) — claim-first + explicit 409, e2e |
| P3-6 | Stale docs (README status) | **RESOLVED this QA** (one line); jest force-exit warning remains informational/harmless |

Production boot guards demonstrated end-to-end this session **[verified 2026-09-24]** —
the built app refuses to start (`Invalid environment configuration`, exit 1) with:

- A: `NODE_ENV=production` + `PAYMENTS_GATEWAY=simulated` → refused (simulated can never
  settle real money — audit I-3);
- B: same without `PAYMENTS_WEBHOOK_SECRET` → refused (webhooks could never verify);
- C: same without `METRICS_TOKEN` → refused (metrics would be unprotected).

Mandatory security cases: **S-01, S-04** (ownership 404) e2e; **S-02** e2e (added this
QA); **S-03** duplicate/parallel webhook e2e; **S-05** shared TOTP bucket e2e; **S-06**
minor self-registration rejection (unit `auth.service.spec.ts`: `/under 18/`); **S-07**
uniform 401 + lockout e2e; **S-08** refresh replay → all sessions revoked e2e; **S-09**
forgot-password uniformity + timing e2e; **S-10** IPv6 /64 bucketing + proxy-pinned key
unit (`ip-tracker.spec.ts`, 8 cases); **S-11** signature/amount e2e; **S-12** logout jti
denylist e2e; **S-13** ADMIN MFA e2e (TASK-03/05 additions). CI security packaging:
gitleaks **success**, Semgrep SAST **success**, Trivy container scan **success**, license
check **success**, `npm audit` **0 vulnerabilities** on the release commit.

Financial integrity: verified in place and regression-covered — server-derived amounts,
HMAC-first webhook, claim-first `gateway_txn_id` idempotency, exact-amount rule (mismatch
→ DISPUTED + flagged, never PAID), settlement transaction, CASH claim-first, refund
re-derivation, integer VND, RESTRICT money chain, no hard delete (S-02). No open P0/P1
security, data-integrity, or financial finding.

## 8. Test Evidence

All commands run by this QA session on the release tree; real output **[verified
2026-09-24]**:

| Gate | Command | Result |
|---|---|---|
| Format | `npm run format:check` | PASS ("All matched files use Prettier code style!") |
| Lint | `npm run lint` (`--max-warnings 0`) | PASS (0 problems) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | PASS |
| Unit + coverage | `npm test` | **325/325 tests, 66/66 suites**; coverage floors met (global 91.09% stmts / 82.29% branches / 85.19% funcs / 91.55% lines ≥ 75% floors incl. auth/billing/classes groups) |
| Build | `npm run build` | PASS (`dist/` emitted) |
| Migration replay | `npx prisma migrate deploy` on empty PG 18 → `migrate status` → `migrate diff` | PASS: 7 migrations, 25 tables, "up to date", "No difference detected" |
| Seed | `npx prisma db seed` ×2 | PASS, idempotent |
| E2E + security | `npm run test:e2e` vs migrated disposable PG 18 (after `migrate reset`) | **86/86 tests, 15/15 suites** (85 baseline + 1 new S-02) |
| OpenAPI | `npm run openapi:generate` + byte-diff | PASS, idempotent, 67 paths / 81 ops |
| Contract lint | `npm run contract:lint` | PASS — 0 errors (81 description warnings, pre-existing) |
| Dependency audit | `npm audit --audit-level=high` | PASS — **0 vulnerabilities** |
| Prod boot guards | `node dist/main.js` with production env (A/B/C above) | PASS — fail-fast refusals observed live |
| CI (release commit `61c711b`) | GitHub check-runs API | 13/13 applicable jobs **success** (secrets-scan, lint, sast, audit, license, tech-debt, build-test+coverage, migration-dry-run, integration, contract-gate, docker, container-scan, deploy+smoke); commitlint `skipped` (PR-only job, expected on push). Note: the deploy job's "success" is its documented stub behavior (echoes and exits 0 without secrets) — see §9 |

Load baseline: the TASK-05 measured baseline (SECURITY.md §8: ≈340–400 rps on the
heaviest admin read at 20 VU, p50 ≤ 58 ms, p99 ≤ 97 ms, event-loop lag ≤ 4 ms; MFA-guard
cost at/below host noise) remains current — this QA made no production-code change
(one test file, one README line), so per the measurement rule (no change → no remeasure
required) the baseline stands.

Regression verification for this QA's fix: `npx jest -t "S-02"` → 1/1 pass; full e2e
re-run → 86/86 (above). No test was skipped, weakened, or deleted.

## 9. Deployment Readiness

Application guarantees (built and verified):

- **Build artifact**: `npm run build` green; CI `docker` + `container-scan` (Trivy
  HIGH/CRITICAL) **success** on the release commit; multi-stage non-root Dockerfile,
  prod-deps-only layer, `node --enable-source-maps`.
- **Database migration deployment**: versioned SQL committed; replay-from-empty verified
  (§5); CI `migration-dry-run` (deploy + 25-table assertion + reset replay) **success**.
  The image intentionally does not self-migrate — `prisma migrate deploy` is the
  release-command/deploy-pipeline step.
- **Health / readiness / metrics**: `/healthz` (liveness), `/readyz` (DB ping),
  `/metrics` (bearer-only, 404 unconfigured, 401 wrong token) — e2e-verified; missing
  `METRICS_TOKEN` blocks production boot (demonstrated, §7-C).
- **Startup/shutdown**: fail-fast joi env validation (demonstrated live); graceful
  shutdown (`enableShutdownHooks`, unref'd timers, outbox `onModuleDestroy`).
- **Logging**: pino JSON + request-id on every route; secrets/tokens/mail bodies
  redacted; `MAIL_LOG_FILE` production-forbidden.
- **Configuration**: `.env.example` complete (42 keys incl. MAIL_DRIVER/SMTP_*/PAYOS_*/PAYMENTS_*).

Infrastructure / owner guarantees (NOT demonstrated — separated per contract §12/§13):

1. **Deployment trial**: no staging/prod instance exists; CI deploy job is a documented
   stub (`RENDER_DEPLOY_HOOK` / `SMOKE_TEST_URL` secrets absent → echoes, exits 0). The
   thesis "deployment trial" activity remains **undemonstrated** — owner must create the
   Render (or equivalent) service, wire the release command (`prisma migrate deploy`),
   and set the secrets.
2. **Backup/DR**: none implemented or demonstrated (SECURITY.md §9: no backup job,
   restore script, or drill; no RPO/RTO claims). Owner: managed-Postgres PITR + offsite
   dumps + first restore drill.
3. **Edge protections**: TLS termination, HSTS, WAF/CDN, volumetric DDoS mitigation are
   provider responsibilities; the app throttler mitigates per-IP abuse only
   (SECURITY.md §3). The edge proxy must overwrite/strip client-supplied `X-Forwarded-For`
   (or set `trust proxy` 0) for the hardened throttle key.
4. **External credentials**: payOS sandbox credentials (real QR demo), SMTP account
   (real email delivery), Zalo OA/ZNS template approval (owner actions).

## 10. Known Limitations

- **Deployment**: single instance by design (in-process workers, in-memory `SharedStore`
  — jti denylist, lockout, mail budgets); horizontal scale-out explicitly out of scope
  until measured (AD-11/DD-03). No release-command migration wiring until the hosting
  service exists (R-DB-5). No backup/restore path demonstrated (R-DB-6).
- **Provider dependencies**: EMAIL channel is deliverable only with `MAIL_DRIVER=smtp`
  + a real SMTP account; ZNS/SMS adapters are fail-safe stubs that fall back to EMAIL
  (module fail-fasts if credentials are set without adapters); payOS adapter verified
  against SDK-derived test vectors only — no live sandbox call has been made; SePay
  deliberately not implemented (one primary channel, plan §7.5).
- **Unverified legal/accounting matters** (code existence ≠ compliance; SECURITY.md §10):
  Decree 13/2023 personal-data posture, Children Law 2016 consent workflow, medical-notes
  handling as sensitive data, e-invoice obligations (Decree 123/2020) at current scale,
  bank-account/tax declaration status (Circular 25/2025 / Decree 68/2026), audit-log
  retention period — each requires named, dated human/legal/accounting verification.
- **Deferred (approved) features**: per-student aggregated schedule endpoint (DD-02);
  announcement INAPP fan-out (D-2, decided deferred); DB CHECKs for invoice arithmetic /
  announcement audience consistency (DDB-1/DDB-2, application-enforced); CSV export;
  oasdiff breaking-change gate; `bruno/` UAT collection; OPERATIONS.md runbook.
- **Scalability**: revenue report aggregates in memory; `attendance_records(student_id)`
  index deferred with trigger condition (DDB-3); both documented with club-scale rationale.
- **Cosmetic**: simulated-gateway checkoutUrl targets a non-existent local route (dev/e2e
  only; production forbids the simulated gateway); jest worker force-exit warning
  (harmless); 81 spectral description-only warnings.

## 11. Remaining Risks

| ID | Risk | Severity | Owner / mitigation |
|---|---|---|---|
| R-1 | Deployment trial undemonstrated (no hosting, no release migrations, no smoke URL) | Medium (thesis activity 9 + go-live) | Owner: create service, set secrets, run first deploy + smoke (the application side is verified) |
| R-2 | Real payOS sandbox demo pending credentials | Medium (thesis QR full credit) | Owner credentials → run QR → webhook → PAID once on sandbox (adapter ready) |
| R-3 | No backup/restore drill | Medium (data loss exposure at go-live) | Owner: provider PITR + first restore drill before real data entry |
| R-4 | Legal/accounting items unverified | Medium before real-money go-live, Low for prototype demo | Named human verification before fee collection (plan §10) |
| R-5 | Contract discipline (openapi must regenerate in the same commit as route changes) | Low (process) | CI contract-gate enforces |
| R-6 | Edge-proxy XFF requirement misconfigured → throttle-key weakening | Low–Medium (deployment-dependent) | SECURITY.md §3 deployment requirement |
| R-7 | Single-instance constraint | Accepted | Revisit only on measured need (DD-03) |

## 12. Final Release Decision

**RELEASE READY WITH DOCUMENTED LIMITATIONS.**

Justification: every thesis-critical flow and every mandatory security case passes with
real test evidence; the permission matrix, database, and OpenAPI contract are verified;
no P0/P1 security, data-integrity, or financial finding remains open. The two PARTIAL
rows (real-gateway sandbox demo, executed deployment trial + backup/DR) are owner-provided
infrastructure/credential dependencies with the application side code-complete and
verified — they are documented above and do not block prototype demonstration or the
thesis; they DO block real-money go-live until completed (§11 R-1…R-4).
