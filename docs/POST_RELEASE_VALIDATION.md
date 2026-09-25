# POST-RELEASE VALIDATION — TASK-07

Date: 2026-09-25
Scope: independent post-release validation of VovinamApiNode after the
matrix-completion increment (PR #27). Every count and claim below was
re-derived from the current repository state; prior QA reports were treated as
untrusted input.

---

## 1. Current Repository State

- Branch reviewed: `feat/matrix-completion` (merged to `main` as PR #27);
  TASK-07 work branched from `origin/main`.
- **API surface**: 88 paths / **111 operations** (GET 39, POST 47, PATCH 12,
  DELETE 11, PUT 2) across 19 controller classes (18 files), 27 services,
  20 modules.
- **Database**: 28 Prisma models, 8 migrations (+lock); CI asserts all 29
  tables (incl. `_prisma_migrations`) replay cleanly from scratch.
- **Tests**: 425 unit tests in 83 suites; 101 e2e+security tests in 17 suites;
  coverage floors (75 % global, enforced per auth/billing/classes) hold at
  92 %+ global.
- **CI**: green on `main` and `feat/matrix-completion` before this task
  (runs of 2026-09-25 07:38 / 07:55 UTC); dependabot minor/patch PRs merged.
- Prior baselines are stale in places (e.g. `docs/API_BASELINE.md` still says
  "67 paths / 81 operations" — the matrix-completion increment grew it to
  88/111). Current state is authoritative here and in
  `docs/API_FRONTEND_CONTRACT_AUDIT.md`.

## 2. Swagger/OpenAPI Audit

Full detail in `docs/API_FRONTEND_CONTRACT_AUDIT.md`. Summary:

- Controller routes ↔ OpenAPI operations reconcile **1:1 (111 = 111)** — no
  undocumented/stale routes, no duplicate operationIds.
- Before this task the contract was unusable: all 50 DTO schemas empty, zero
  response schemas, zero security metadata, zero operation summaries, no query
  parameters, no error catalog, no examples.
- Fixed by an explicit contract layer: all DTOs annotated (16 files), plus
  `src/openapi/` (per-operation contract table, schema kit, fail-loud
  enrichment) wired into **both** runtime Swagger and the generation script,
  with drift-guard unit tests.

## 3. Frontend Contract Readiness

**Verdict: A — FRONTEND CONTRACT READY** (see the audit doc for the residual
non-blocking notes: provider-specific webhook payload shape, role-dependent
field variation documented descriptively).

## 4. Bruno UAT Coverage

`bruno/` is a runnable collection — 19 domain folders, **245 requests, 363
test assertions**, chaining tokens/ids automatically. Executed against the real
API on a disposable PostgreSQL (initdb-based, no Docker):

**Final recorded run: 245/245 requests passed, 363/363 tests passed** (fresh
seed → migrate → build → run). Setup, environment, execution order, expected
results and known limitations: `docs/BRUNO_UAT.md`.

The UAT run itself found real defects the suites had missed (see §14): the
invoice/exam code generators wedged by alphanumeric demo codes (409s + 500s on
core flows) and the demo seed never configuring tuition rates/bank account.

## 5. Business Logic Findings

Review method: full read of every service/controller with the Prisma schema
constraints, cross-checked against the e2e suite, the new Bruno UAT run, and a
parallel independent security review. Verified-correct highlights:

- **Enrollment/exam concurrency**: capacity and duplicate checks are serialized
  per class/exam with `FOR UPDATE` row locks; proven by
  `db-integrity-races.e2e-spec.ts`.
- **Webhook money path**: signature-first (401 stops the gateway), claim-first
  idempotency (`gateway_txn_id` claimed exactly once), amount mismatch →
  DISPUTED and never PAID, invoice settled only when SUCCESS transactions cover
  the total, refund re-derives the invoice — all asserted by e2e **and** the
  UAT (duplicate webhook, wrong signature, wrong amount, refund).
- **Promotion proposals never move the belt** (advisory only; only exam
  RESULT_PASS promotes, re-validated at result time against rank regression) —
  asserted explicitly by the UAT.
- **Rank regression** blocked at registration and re-checked at result time.
- **Parent invite codes** are single-use via atomic rotation in the linking
  transaction; races leave the loser with the uniform 404.
- **Student soft delete** preserves invoices/attendance and deactivates the
  linked account (S-02 e2e regression).
- **Discount codes**: XOR (percent vs amount) enforced, expiry/active checks at
  invoice time, discount burned into the invoice so later code deletion cannot
  change history.
- **Monthly tuition close** idempotent per (student, period) via unique
  constraint; multi-class students aggregate into one invoice.

Findings that required fixes (all fixed in this task, with regression tests):

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-1 | **P1** | Sequential code generators (`nextInvoiceNo`, `generateExamCode`) `parseInt` alphanumeric suffixes (e.g. seeded `INV-2026-D002`, `EXAM-2026-D1`) → `NaN` wedges the sequence on `INV-2026-NaN`/`EXAM-2026-NaN`; subsequent exam creations 409 and invoice issuance crashes with unique-violation 500s (manual create had no retry). Found by the Bruno UAT on the demo dataset. | `src/billing/sequential-code.ts` — numeric-suffix-aware max; both generators use it; manual invoice create gained bounded P2002 retry; 6 unit tests. |
| F-2 | P2 | Demo seed's `tuition_rates` and usable `bank_account` upserts were no-ops on a fresh database (base bootstrap creates the keys first, demo `update: {}` never writes) → monthly tuition close reports "no tuition rate configured" and QR payments 409 on the dataset meant to demonstrate every flow. Found by UAT. | `prisma/seed.ts` writes both values on update as well. |
| F-3 | P2 | Bootstrap admin seeded from `ADMIN_EMAIL/ADMIN_PASSWORD` was born unverified → could never log in (login requires verification; no mail is sent for seeded accounts). | `prisma/seed.ts` sets `emailVerifiedAt` for the seeded admin. |
| F-4 | P3 | `POST /evaluations` with a well-formed but unknown `classId` surfaced a raw FK violation as **500**. | Uniform 404 via existence check; e2e + UAT regressions. |

## 6. Security Findings

An independent security review (full read of guards, services, gateways, env
validation, mail/metrics/token surfaces, cross-checked with the security suite)
verified the core controls with evidence: uniform 401 login failures with
dummy-bcrypt timing equalization; per-account lockout; anti-enumeration on
register/resend/forgot; refresh rotation with replay → family revocation; JWT
kid/version checks and per-request session/pwdVersion revalidation; TOTP with
sealed secrets, shared failure bucket, single-use hashed recovery codes; ADMIN
MFA gate; guard-7.3 ownership 404 posture across every student-scoped surface;
instructor class scoping on writes; global whitelist validation; no credential
material in any serializer; MAIL_LOG_FILE forbidden in production; metrics
token constant-time compare; production gateway restrictions.

**Fixed in this task:**

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| S-1 | **P1** | `POST /exam-registrations/{id}/result` accepted any registration id from any INSTRUCTOR — a foreign instructor could record RESULT_PASS and **promote an arbitrary student's belt** (horizontal authorization bypass with business impact). Found by the independent review; e2e only used the student's own instructor. | Scope check inside the transaction: non-ADMIN callers must pass the guard-7.3 ownership check on the registration's student (uniform 404). Regression e2e test with a second, non-teaching instructor; UAT request. |
| S-2 | P3 | `ChangeEmailRequestDto.newEmail` accepted any string → a user could self-DoS into a non-email address. | `@IsEmail()`. |
| S-3 | P3 | `UpdateTuitionRatesDto.rates` lacked an array cap (every other array DTO has one). | `@ArrayMaxSize(500)`. |

**Documented, not fixed (accepted for now):**

- P3: audit trail is async-batched (50 entries or shutdown) — a crash drops
  queued entries; also causes spurious duplicate new-IP alerts. Needs an
  interval flush + durable fallback before being relied on forensically.
- P3: no recovery-code rotation endpoint (workaround exists via
  disable → re-enroll).
- P3: unbounded PENDING QR initiations per invoice (global throttle is the only
  cap).
- P3: `SWAGGER_ENABLED` not forbidden in production env validation (documented
  contract; default off).
- P3: register duplicate race under concurrency answers 500 (anti-enumeration
  flows are uniform in the sequential case; e2e-proven).
- P3: email case not normalized at register (case-variant duplicates possible).
- P3: in-process SharedStore throttles/lockouts are per-instance — document the
  single-instance constraint (Render runs one instance) before scaling out.

## 7. Technical Debt Findings

- **Stale docs** (P3): `docs/API_BASELINE.md` still states 67 paths / 81
  operations (now 88/111) and other pre-matrix counts. Baseline docs should be
  refreshed or superseded by the two new docs from this task.
- **Bruno CLI quirk** (documented): `params:query` blocks are ignored when the
  CLI builds requests — the collection embeds query strings in the URL.
- **`@usebruno/cli` added as devDependency** to make the UAT collection
  runnable (`npx bru run`); licence-check and audit gates unaffected.
- Minor: `dist/`, `coverage/`, `tmp/` are build artifacts on the working tree
  but gitignored (verified); no dead routes; TODO/FIXME accumulation is zero
  in `src/`.

## 8. Endpoint Coverage Matrix

Mechanically derived (script matching `openapi.json` operations against
e2e/security test files; every operation is exercised by at least one suite —
no operation is untested). Classification: all 111 operations are
DIRECTLY TESTED at e2e level (happy path plus the negative classes shown in
§9); the four "—" rows in an earlier draft were a matcher artifact and resolve
against `matrix-completion`/`s13-admin-mfa`.

| Operation | e2e/security suites |
| --- | --- |
| `GET /api/v1/admin/audit-log` | matrix-completion |
| `POST /api/v1/admin/billing/generate-monthly` | billing, matrix-completion |
| `GET /api/v1/admin/billing/settings` | billing, matrix-completion |
| `PUT /api/v1/admin/billing/settings/bank-account` | billing, matrix-completion |
| `PUT /api/v1/admin/billing/settings/tuition-rates` | billing, matrix-completion |
| `POST /api/v1/admin/notifications/flush` | notifications-consent |
| `GET /api/v1/admin/reports/attendance` | billing, matrix-workflows |
| `GET /api/v1/admin/reports/belts` | billing, matrix-workflows |
| `GET /api/v1/admin/reports/revenue` | billing, matrix-workflows |
| `GET /api/v1/admin/reports/tuition` | billing, matrix-workflows |
| `GET/POST /api/v1/announcements`, `PATCH/DELETE /{id}` | announcements, matrix-completion |
| `POST /api/v1/attendance-sessions` | classes-attendance, matrix-workflows |
| `GET/POST /api/v1/attendance-sessions/{id}/records` | classes-attendance, matrix-workflows |
| `GET /api/v1/attendance/summary` | classes-attendance, matrix-workflows |
| auth surface (register, login, MFA×7, sessions×2, me, audit-log, lifecycle×7) | auth-coverage, auth-lifecycle, s05, s07-s09, s08-s12, s13 |
| belt-exams (list/detail/create/patch/register), exam-registrations (list/result) | belts-exams, db-integrity-races, matrix-completion |
| belt-ranks (list/create/patch) | belts-exams, db-integrity-races, s13-admin-mfa |
| classes (list/detail/create/patch/schedules×2) | billing, classes-attendance, db-integrity-races, s13-admin-mfa, students-roles |
| consent (grant/revoke/me) | notifications-consent |
| discounts (CRUD) | matrix-workflows |
| enrollments (create/list/remove) | billing, classes-attendance, db-integrity-races |
| evaluations (create/list/patch/delete) | matrix-workflows |
| invoices (list/detail/create) | billing, matrix-workflows, notifications-consent, s13-admin-mfa, students-roles |
| leave-requests (create/list/review/cancel/delete) | matrix-workflows |
| notifications (me/read, flush) | notifications-consent |
| parents (link/children/unlink) | belts-exams, billing, classes-attendance, db-integrity-races, students-roles |
| payments (qr/webhook/confirm-cash/patch/list) | billing |
| promotion-proposals (create/list/patch/review) | matrix-workflows |
| students (all 8 routes) | belts-exams, billing, classes-attendance, db-integrity-races, health, matrix-completion, s13-admin-mfa, students-roles |
| users (list/create/patch/delete) | matrix-completion, s13-admin-mfa |
| healthz / readyz / metrics | health, swagger |

## 9. Test Evidence (actual runs, this task)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` (eslint, 0 warnings) + `format:check` | pass |
| `npm test -- --coverage` (unit) | **425/425**, suites 83/83; global coverage ≈ 92 % (floor 75 %) |
| `npm run test:e2e` (e2e + security, fresh disposable DB) | **101/101**, suites 17/17 |
| `npm run openapi:generate` | deterministic; `openapi.json written (88 paths)` |
| `npm run contract:lint` (spectral) | 0 errors |
| Bruno UAT (`npx bru run --env Local`, fresh seed, real server) | **245/245 requests, 363/363 tests** |
| CI (GitHub Actions, branch pre-TASK-07) | green (all jobs incl. semgrep, gitleaks, trivy, migration replay) |

New regression tests introduced by the fixes: 6 unit tests for
`nextSequentialCode`; e2e foreign-instructor result-scoping test; e2e
evaluation-classId 404 test; 12 contract drift-guard tests; 245 UAT requests
incl. dedicated regression requests for the scope guard and the FK fix.

## 10. P0 Findings

None. No critical data/financial/security blocker remains.

## 11. P1 Findings

Both found and **fixed in this task** (with regression tests):

1. **Sequential code generator NaN wedge** — invoice/exam numbering broke on
   alphanumeric codes, turning exam creation into 409s and invoice creation
   into 500s on the demo dataset (F-1).
2. **Exam-result recording lacked instructor scoping** — horizontal
   authorization bypass allowing belt promotion of arbitrary students (S-1).

## 12. P2 Findings

Fixed in this task:

1. Demo seed never wrote tuition rates / usable bank account on a fresh
   database (F-2).
2. Bootstrap admin seeded unverified — could never log in (F-3).

## 13. P3 Findings

Fixed in this task:

1. Evaluation `classId` FK violation surfaced as 500 → uniform 404 (F-4).
2. `newEmail` missing `@IsEmail` (S-2).
3. Tuition-rates array missing size cap (S-3).

Documented, accepted for now (see §6 for the security-adjacent ones):

4. Audit trail async batching is lossy on crash (needs interval flush + durable
   fallback).
5. No recovery-code rotation endpoint.
6. Unbounded PENDING QR initiations per invoice.
7. `SWAGGER_ENABLED` not forbidden (only defaulted off) in production env
   validation.
8. Email case not normalized at register; register duplicate race answers 500.
9. In-process SharedStore limits are per-instance (document single-instance
   deployment constraint before scaling).
10. Stale baseline docs (`docs/API_BASELINE.md` counts pre-date the matrix
    increment).

## 14. Fixes Applied

| Fix | Files | Tests |
| --- | --- | --- |
| Numeric-aware sequential codes (F-1) | `src/billing/sequential-code.ts` (new), `billing.service.ts`, `exams.service.ts` | `sequential-code.spec.ts` (6 tests); existing invoice/exam specs updated to the new query shape |
| Manual invoice create: bounded P2002 retry | `billing.service.ts` | covered by the existing retry-pattern tests |
| Exam-result instructor scoping (S-1) | `exams.service.ts` | e2e `belts-exams.e2e-spec.ts` foreign-instructor 404 test; Bruno `09_exams/21` |
| Seed: demo rates + bank account written (F-2) | `prisma/seed.ts` | Bruno `10_billing/08-09`, `11_payments` QR flow |
| Seed: bootstrap admin verified (F-3) | `prisma/seed.ts` | manual verification (login now succeeds) |
| Evaluation classId → 404 (F-4) | `evaluations.service.ts` | e2e `matrix-workflows.e2e-spec.ts`; Bruno `15_evaluations` |
| Contract layer (G1–G7) | `src/openapi/*` (new), all 16 DTO files, `bootstrap.ts`, `scripts/generate-openapi.ts` | `openapi.contract.spec.ts` (12 tests); spectral 0 errors |
| DTO hardening (S-2, S-3) | `auth/dto/account.dto.ts`, `billing/dto/settings.dto.ts` | regenerated contract; suites green |
| Bruno UAT collection | `bruno/` (new: 19 folders, 245 requests, env, README) | executed 245/245 / 363/363 |
| Docs | `docs/API_FRONTEND_CONTRACT_AUDIT.md`, `docs/BRUNO_UAT.md`, `docs/POST_RELEASE_VALIDATION.md` (this file) | — |

## 15. Known Limitations

- Email-bound flows (verify email, reset password, email change) cannot be
  completed end-to-end by a black-box UAT client; the e2e suite covers them via
  the mail log port, the UAT asserts their anti-enumeration envelopes.
- Production auth throttles must be raised for automated UAT runs.
- The webhook request body is provider-specific; the contract documents the
  simulated gateway's payload and the HMAC contract.
- Audit-log batching, recovery-code rotation, per-invoice QR caps and the other
  accepted P3s above remain open, documented in §6/§13.
- Real PayOS/SePay gateway integration remains exercised only through the port
  + production env gating; no real provider credentials exist in the repo.

## 16. Final Verdict

**B. VALIDATED WITH DOCUMENTED GAPS.**

Every current operation is accounted for (contract 1:1 with controllers; all
111 operations directly tested at e2e level; the frontend contract is ready
(verdict A)); the Bruno UAT exists and has actually been executed (245/245);
business-logic, security and technical-debt reviews are complete; the contract
gate (deterministic regeneration + spectral) and all test gates pass locally
and CI is green on the base branch. The two P1s found by this validation were
fixed with regression tests. It falls short of an unqualified "VALIDATED" only
because of the documented, accepted P3 items in §13 (lossy audit batching above
all) and the stale baseline documents — none of which block the release, and
all of which are tracked in this report.

---

*Prepared by TASK-07 post-release validation. Companion documents:
`docs/API_FRONTEND_CONTRACT_AUDIT.md`, `docs/BRUNO_UAT.md`.*
