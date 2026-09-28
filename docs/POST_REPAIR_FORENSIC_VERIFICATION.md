# Post-Repair Forensic Verification Report

**Target Live Environment**: `https://vovinamapinode.onrender.com`  
**Current HEAD Commit**: `e493808` (`fix(security): repair confirmed live UAT, security, and business-logic findings`)  
**Repository**: `NguyenQuan121321/VovinamApiNode`  
**Date**: 2026-09-28  
**Verification Nature**: Independent post-repair forensic verification. Evidence gathering only. Zero code, database, CI, or Render mutations executed.

---

## 1. Executive Summary & Verification Posture

Following the previous forensic verification (`docs/LIVE_UAT_FORENSIC_VERIFICATION.md`), commit `e493808` applied a series of repairs to address reported findings across credential handling, UAT runner harness architecture, reporting templates, and the evaluation class scoping logic.

This document independently verifies the actual implementation state at `main` HEAD (`e493808`) across 18 forensic phases without relying on commit messages, green CI badges, or documentation claims.

### Summary of Independent Determinations
- **No P0 or P1 code-level vulnerabilities** exist in application business logic, authorization, or authentication core.
- **Evaluation Class Scoping (N3 Repair)**: Independently **VERIFIED**. `POST /evaluations` now strictly enforces that an `INSTRUCTOR` caller can only attach evaluations to classes they teach (`class.instructorId === caller.id`), returning uniform 404 for foreign or non-existent classes.
- **Harness Coverage Integrity (F6/F7/F8 Repairs)**: Independently **VERIFIED** in `live-runner-base.mjs` and `uat-runner.spec.mjs`. Fallback artificial coverage assignments have been eliminated; an operation is only marked `covered: true` when a real request was executed AND the assertion passed (`executed === true && result === 'PASS'`). Fail-closed logic on `/docs` and safe non-flooding rate limit sampling are confirmed.
- **Credential Hygiene in Current Tree (F1/F2)**: Hardcoded password literals were completely removed from `test/uat/live-render-runner.mjs` and `docs/BRUNO_UAT.md`. Runtime execution requires `LIVE_UAT_ADMIN_PASSWORD` from the environment.
- **Contract Parity**: 100% byte-level alignment between committed `openapi.json` (88 paths, 111 operations) and runtime `https://vovinamapinode.onrender.com/docs-json`.
- **Remaining Confirmed Concerns**:
  1. **UAT Report Generator Static Overclaim (R1, P2)**: `test/uat/generate-uat-md.mjs` contains a hardcoded static markdown table in Section 4 that marks findings F1–F10 and N1–N3 as `**VERIFIED**` even when the live UAT run aborted at the credential check with only 3 of 111 operations executed.
  2. **Webhook Claim-Before-Settle Recovery Gap (R5, P2)**: If an unhandled exception occurs inside `settleInvoice` after the payment transaction's `gatewayTxnId` has been set, subsequent retries by the payment gateway match `claimed.count === 0` and are treated as 200 no-ops, permanently stranding the transaction in `PENDING` and the invoice in `UNPAID`.
  3. **Multiple Pending QR Transactions (R6, P3)**: Unbounded concurrent `PENDING` QRs can be created per invoice; multiple successful bank transfers settle both transactions as `SUCCESS` without automatic overpayment flagging.
  4. **CI Deployment Gate Stub (R9, P2)**: `.github/workflows/ci.yml` deploy and post-deploy smoke steps echo notices and `exit 0` when `RENDER_DEPLOY_HOOK` or `SMOKE_TEST_URL` are unset, passing green without proving deployment.

---

## 2. Phase 1 — Live Deployment Read-Only Probes

Target: `https://vovinamapinode.onrender.com`  
Execution Method: Anonymous HTTP GET probes (zero mutations, zero authenticated calls).

| Endpoint | HTTP Status | Latency | Content-Type | Response Envelope Shape | Leaks / Stack Traces |
|---|---|---|---|---|---|
| `GET /healthz` | `200 OK` | 450 ms | `application/json` | `{"code":200,"message":"OK","data":{"status":"ok"}}` | None |
| `GET /readyz` | `200 OK` | 99 ms | `application/json` | `{"code":200,"message":"OK","data":{"status":"ok","database":"up"}}` | None |
| `GET /docs` | `200 OK` | 83 ms | `text/html` | Swagger UI HTML (Staging posture) | None |
| `GET /docs-json` | `200 OK` | 94 ms | `application/json` | OpenAPI 3.0.0 JSON (88 paths) | None |
| `GET /metrics` | `401 Unauthorized` | 96 ms | `text/plain` | `{"code":401,"message":"Unauthorized","data":null}` | None |
| `GET /non-existent-probe-404` | `404 Not Found` | 96 ms | `application/json` | `{"code":404,"message":"Cannot GET /non-existent-probe-404","data":null}` | None |
| `GET http://.../healthz` | `301 Moved` | 85 ms | `text/html` | Redirect to `https://vovinamapinode.onrender.com/healthz` | None |

### Security Headers Verified Live
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-Robots-Tag: noindex, nofollow`
- `Content-Security-Policy`: Hardened CSP with permitted Swagger assets on staging.

---

## 3. Phase 2 — Live UAT Report & Generator Honesty

### Examination of `test/uat/generate-uat-md.mjs` & `docs/LIVE_RENDER_UAT.md`
- **Dynamic Header Derivation**: Lines 11–48 of `generate-uat-md.mjs` dynamically interpolate `totalTests`, `passCount`, `failCount`, `blockedCount`, and `coveredCount` from `live-uat-results.json`.
- **Static Section 4 Finding Table**: Lines 116–131 hardcode an immutable table in markdown:
  ```markdown
  | **F1/F2 Credential Repair** | Static + Runtime Env Check | **VERIFIED** | ...
  | **F3 Resource Isolation** | Synthetic Graph + Dynamic Registry | **VERIFIED** | ...
  | **F4 Global Settings Preservation** | Route Execution Filter | **VERIFIED** | ...
  | **N3 Evaluation Class Scoping** | Anti-probing 404 Assertion | **VERIFIED** | ...
  ```
- **Live Discrepancy Evidence**:
  In `docs/LIVE_RENDER_UAT.md` (Run `uat-mukgjip5-568eb4`):
  - Run Status: `RUN ABORTED`
  - Tests Executed: 6 recorded (5 Pass, 1 Blocked at credential check)
  - Operations Covered: 3 / 111
  - Authenticated operations executed: **0**
  Yet Section 4 of that same document asserts **VERIFIED** for F3 (Resource Isolation), F4 (Global Settings Preservation), F5 (Financial Mutation Safety), and N3 (Evaluation Class Scoping).
- **Verdict**: **PARTIALLY CONFIRMED (P2)**. While the header and raw execution log are honest, Section 4 contains static prose that unconditionally marks unexecuted domain invariants as `**VERIFIED**` on aborted runs.

---

## 4. Phase 3 — UAT Harness & Coverage Integrity

### Call-Site Audit of `recordTest()`
- Total `recordTest()` invocations in `test/uat/live-render-runner.mjs`: 101.
- Invocations with literal `'PASS'`: Exactly 1 (Line 80, inside an explicit `if (loginRes.ok && loginRes.status === 200 && !loginRes.json?.data?.mfaRequired)` guard block).
- All other 100 invocations derive the result parameter dynamically (e.g. `res.status === 200 ? 'PASS' : 'FAIL'`).
- `live-runner-base.mjs` line 261 guarantees:
  ```javascript
  op.covered = executed === true && result === 'PASS';
  ```
- `calculateCoverageSummary()` calculates `coveredCount = pass` strictly from operations where `op.result === 'PASS'` and `op.executed === true`.
- **Adversarial Test Matrix (Offline Simulation)**:
  - Prerequisite fails (`result: 'BLOCKED'`, `executed: false`): `covered: false` ✓
  - Request throws (`result: 'FAIL'`, `status: 0`): `covered: false` ✓
  - Request returns 400, 401, 403, 404, 409, 429, 500, 503: `covered: false` ✓
  - Protected setting skipped (`NOT_SAFE_TO_AUTOMATE`): `covered: false` ✓
  - Unit test suite (`npm run test:uat`): 9/9 passed in 98ms.
- **Verdict**: **NOT CONFIRMED (CLEAN)**. The coverage false-positive vulnerability previously identified in F6/F7 has been completely repaired.

---

## 5. Phase 4 — Credential & Demo Account Exposure

- **Hardcoded Password Elimination**:
  - `test/uat/live-render-runner.mjs`: No password literals. Uses `process.env.LIVE_UAT_ADMIN_PASSWORD` and fails fast (`BLOCKED`) if absent.
  - `docs/BRUNO_UAT.md`: Hardcoded live credential removed. Replaced with documented configuration guidance.
- **Seed Fixture vs Live Credential**:
  - `Demo#2026`: Defined in `prisma/seed.ts:134` behind `process.env.SEED_DEMO_DATA === 'true'`. It is a local/staging seed fixture.
  - `ChangeMe123`: Default placeholder in `.env.example:88` and fallback in `load/smoke.mjs:41`.
  - `uat-admin@example.com`: Account email identifier.
- **Render Staging Environment State**:
  - Direct inspection of Render private environment variables is not possible without provider dashboard credentials.
  - No authenticated login was attempted per the zero-mutation, read-only safety rules.
- **Verdict**: **UNVERIFIABLE** regarding whether live accounts currently retain previous test passwords; **NOT CONFIRMED** as a source code leak in the current working tree.

---

## 6. Phase 5 — Auth, Session & SharedStore Architecture

### Investigation of In-Memory `SharedStore`
- **Component Purpose**: Single-process key-value store with TTL used for:
  - Fixed-window IP rate limiting (`auth-ip:*`, `rate-limit:*`)
  - Login failure lockout counter (`login:lockout:*`)
  - Outbound mail budgets (`mail:budget:*`)
  - Fast-path access token JTI denylist (`jti:denylist:*`)
  - TOTP 120s step replay cache (`totp:replay:*`)
- **A. Access-token revocation upon restart**:
  **Enforced in Database**. When a user logs out (`logout()` in `auth.service.ts`), both `session.revoked = true` and `refreshToken.revoked = true` are committed to PostgreSQL.
  `JwtAuthGuard` checks:
  ```typescript
  const session = await this.prisma.session.findUnique({ where: { id: sid } });
  if (session === null || session.revoked || session.expiresAt <= new Date()) {
    throw new UnauthorizedException('Unauthorized');
  }
  ```
  Even if `SharedStore` is completely cleared on restart, revoked sessions remain permanently rejected with uniform 401 via PostgreSQL.
- **B. Session revocation independence**:
  Confirmed. DB session state independently invalidates the token regardless of JTI denylist presence.
- **C. State lost upon restart**:
  Rate-limiting counters, temporary IP lockout counts, and outbound email hourly budgets reset to zero.
- **D. Multi-instance considerations**:
  In a multi-instance deployment without Redis, IP throttle counters and mail budgets are isolated per-node. Session revocation and `pwdVersion` invalidation remain cluster-wide because they query PostgreSQL.
- **E. Render Configuration**:
  Single container instance on Render Web Service.
- **Verdict**: **NOT CONFIRMED as a security vulnerability**; **PARTIALLY CONFIRMED (P3)** as a documented single-instance architectural boundary per plan §3.

---

## 7. Phase 6 — Rate Limiting & Abuse Protection

- **Dual-Tier Protection**:
  1. Global Throttler (`IpThrottlerGuard`): 100 requests / 60 seconds across all endpoints.
  2. Strict Auth Surface Limiter (`AuthIpThrottleGuard`): 30 requests / 60 seconds per IP across `/auth/*` routes.
- **IP Tracker Hardening (`src/common/ip-tracker.ts`)**:
  - Evaluates `request.ip` (first untrusted proxy hop) to prevent client-spoofed `X-Forwarded-For` header rotation.
  - Collapses IPv6 addresses into `/64` subnet prefixes (`S-10`) to prevent IPv6 rotation bypass.
- **DDoS Boundary**:
  Application-layer throttling mitigates brute-force attacks and abuse. It does not provide volumetric or network-layer DDoS protection, which resides with the infrastructure provider (Cloudflare/Render edge).
- **Verdict**: **NOT CONFIRMED as a defect**; behavior matches documented architecture.

---

## 8. Phases 7 & 8 — Authorization, IDOR & Evaluations Scoping

### Verification of Evaluation Class Scoping (Finding N3)
Code inspection of `src/evaluations/evaluations.service.ts`:
```typescript
if (dto.classId !== undefined) {
  const cls = await this.prisma.class.findFirst({
    where: { id: dto.classId },
    select: { id: true, instructorId: true },
  });
  if (cls === null) {
    throw new NotFoundException('Not found');
  }
  if (caller.role === 'INSTRUCTOR' && cls.instructorId !== caller.id) {
    throw new NotFoundException('Not found');
  }
}
```
- **Scenario 1 (Instructor A -> Student A -> Class A [owned by Instructor A])**: PASS.
- **Scenario 2 (Instructor A -> Student A -> Class B [owned by Instructor B])**: Throws uniform 404 `NotFoundException` (Anti-probing IDOR posture).
- **Scenario 3 (Instructor B -> Student A -> Class A [owned by Instructor A])**: Throws uniform 404 `NotFoundException`.
- **Scenario 4 (ADMIN -> Class B)**: PASS (`caller.role === 'ADMIN'` bypasses instructor ownership check).
- **Scenario 5 (Unknown classId)**: Throws uniform 404 `NotFoundException`.
- **Unit & E2E Regressions**:
  - `src/evaluations/evaluations.service.spec.ts`: 11/11 tests pass.
  - `test/e2e/matrix-workflows.e2e-spec.ts`: Asserts 404 on foreign instructor evaluation attempt.

### Evaluation Read Scope Analysis
- `GET /evaluations?studentId=StudentA`:
  Guarded by Guard 7.3 (`StudentOwnershipService.assertCanAccess`). If an instructor actively teaches Student A, the instructor can view all evaluations for that student.
  - Matrix Row 12 & 25 ("Đánh giá võ sinh" & "Báo cáo võ sinh") require instructors to see pedagogical evaluation history for their active students.
  - Modifying or deleting evaluations remains strictly locked to the author (`authorUserId === caller.id`) or ADMIN.
- **Verdict**: **NOT CONFIRMED as a defect**; working as designed.

---

## 9. Phase 9 — Payment Settlement & Webhook Recovery

### Webhook Claim-Then-Settle Edge Case Analysis
In `src/billing/payments.service.ts` (`handleWebhook`):
```typescript
// 1. Claim gatewayTxnId
const claimed = await this.prisma.paymentTransaction.updateMany({
  where: { id: txn.id, gatewayTxnId: null, status: 'PENDING' },
  data: { gatewayTxnId: event.gatewayTxnId },
});
if (claimed.count === 0) {
  return { processed: false };
}
try {
  // ...
  // 2. Settle Invoice
  await this.settleInvoice(txn.invoiceId, txn.id);
  return { processed: true, outcome: 'SUCCESS' };
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return { processed: false };
  }
  throw error;
}
```
- **Failure Sequence**:
  1. `updateMany` claims the transaction by writing `gatewayTxnId = event.gatewayTxnId`.
  2. `settleInvoice` executes in a separate Prisma transaction.
  3. If `settleInvoice` throws (e.g. database timeout, serialization deadlock, or unexpected foreign key error):
     - `settleInvoice` transaction rolls back.
     - `txn.status` remains `'PENDING'`.
     - `txn.gatewayTxnId` has **already been committed** as non-null.
     - `handleWebhook` re-throws the error -> returns HTTP 500 to the payment gateway.
  4. The gateway retries the webhook delivery.
  5. On retry, `updateMany` queries `where: { id: txn.id, gatewayTxnId: null, status: 'PENDING' }`.
  6. Because `gatewayTxnId` is no longer null, `claimed.count` is 0.
  7. Line 130 returns `{ processed: false }` with HTTP 200.
  8. **Result**: The retry is ignored as a duplicate; the payment transaction remains stuck in `PENDING`, and the invoice remains `UNPAID`.
- **Verdict**: **CONFIRMED (P2)**. Claim and settlement are not atomically bound, leading to an unrecoverable pending state upon settlement failure.

### Multiple Pending QR Risk
- In `createQrPayment`, every invocation creates a new `orderRef` and new `paymentTransaction` row with `status: 'PENDING'`.
- If a user opens multiple QRs and pays more than one, each webhook delivery matches its own `orderRef` and marks its transaction as `SUCCESS`.
- `settleInvoice` sums `SUCCESS` transactions: if the sum exceeds `invoice.total`, overpayment is accepted without being flagged or disputed.
- **Verdict**: **PARTIALLY CONFIRMED (P3)**. Expected for open bank transfers without single-flight QR mutual exclusion, requiring manual admin refund.

---

## 10. Phases 10 & 11 — Financial Integrity & Business Logic Invariants

| Domain Workflow / Invariant | Enforcement Level | Verification Evidence |
|---|---|---|
| Student Lifecycle & Soft-Delete | **ENFORCED** | User account deactivated, financial records preserved via FK `Restrict`. |
| Parent Link & Invite Rotation | **ENFORCED** | Single-use invite code claimed race-safely via atomic conditional update; 404 anti-probing on unlinked child. |
| Class Capacity Concurrency | **ENFORCED** | Enforced via `SELECT ... FOR UPDATE` row locks; capacity shrink guard prevents shrinking below active count. |
| Enrollment Duplicate Guard | **ENFORCED** | Backed by composite DB unique constraint `(studentId, classId, enrolledAt)`. |
| Attendance Session Uniqueness | **ENFORCED** | Database unique constraint `(classId, sessionDate)`. Bulk record upsert is idempotent. |
| Belt Rank Progression | **ENFORCED** | Order index verified before promotion; re-validated in-transaction on exam PASS to prevent stale regression. |
| Exam Capacity & Finality | **ENFORCED** | `SELECT ... FOR UPDATE` locks; exam registration and invoice creation atomic in single transaction; results final. |
| Promotion Proposals | **ENFORCED** | Proposals are strictly advisory; belt changes require exam PASS. |
| Monthly Tuition Idempotency | **ENFORCED** | Database unique constraint `@@unique([studentId, type, periodMonth, periodYear])`; duplicate generation safely skips. |
| Payment Exact Amount | **ENFORCED** | Mismatched payment amount marks transaction `DISPUTED` and audit logs `payment_flagged`; never marks invoice `PAID`. |
| Announcement Audience | **ENFORCED** | `ALL` restricted to ADMIN; `CLASS` restricted to class instructor or ADMIN. |
| Leave Request Review Scope | **ENFORCED** | Foreign instructor review attempts answer uniform 404; state transitions final. |
| Evaluation Class Scope | **ENFORCED** | Instructor restricted to classes they teach (`cls.instructorId === caller.id`). |

---

## 11. Phases 12 & 13 — Data Leakage, Logging & Observability

- **Field-Level Serializers**:
  - `serializeStudent`: Hides phone, address, and emergency contacts from `INSTRUCTOR`. Exposes medical notes only.
  - `serializeEvaluation`: Returns public author and student identifiers only.
  - `passwordHash`, `totpSecret`, and `recoveryCodes` are never exposed in any DTO or serializer.
- **Pino Logger Redaction**:
  - `src/logging/pino-logger.factory.ts` redacts passwords, authorization headers, cookies, tokens, and secrets with `[REDACTED]`.
  - `RequestLoggingInterceptor` omits request bodies and client IPs.
- **Production Mail Log Protection**:
  - `MAIL_LOG_FILE` is validated at boot via Joi: forbidden when `NODE_ENV === 'production'` (`env.validation.ts:105-115`).
- **Verdict**: **NOT CONFIRMED (CLEAN)**.

---

## 12. Phase 14 — Technical Debt Audit

- **Code Comments**: Zero `TODO`, `FIXME`, or `HACK` comments in `src/`, `prisma/`, `test/`, `scripts/`, or `.github/`.
- **Dependency Hygiene**:
  - `npm prune --dry-run`: 0 extraneous packages.
  - `npm audit --audit-level=high`: 0 high/critical vulnerabilities.
  - Transitive moderate advisories (4) confined to `@usebruno/cli` devDependencies.
- **Tooling Weak Defaults**:
  - `load/smoke.mjs:41`: Contains `ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123'`. Should fail fast if missing.
- **Verdict**: **CONFIRMED (P3 Technical Debt)**.

---

## 13. Phase 15 — CI/CD Pipeline Forensics

Inspection of `.github/workflows/ci.yml`:
- **Active Parallel Gates**: Lint, format, secrets scan (gitleaks full history), SAST (Semgrep OWASP top 10), npm audit high, license check, commitlint, tech debt gate, build-test (coverage floors), migration dry run (scratch DB table count), E2E integration, Docker buildx, container vulnerability scan (Trivy).
- **Deployment Gate Evaluation**:
  Lines 376–388:
  ```yaml
  - name: Trigger Render deploy hook
    run: |
      if [ -n "$RENDER_DEPLOY_HOOK" ]; then
        curl -fsS -X POST "$RENDER_DEPLOY_HOOK"
      else
        echo "RENDER_DEPLOY_HOOK secret not configured; deploy-gate is a stub until the Render service exists"
      fi
  - name: Post-deploy smoke test (healthcheck gate)
    run: |
      if [ -z "$SMOKE_TEST_URL" ]; then
        echo "SMOKE_TEST_URL secret not configured; smoke test is a stub until the production URL exists"
        exit 0
      fi
  ```
  When repository secrets are not configured, the deploy job prints a notice and exits 0.
- **Classification**: **NOT_PROVEN** deployment automation gate (cannot claim deployment is verified in CI).

---

## 14. Phase 16 — OpenAPI Contract Parity

- **Local Contract**: `openapi.json` (88 paths, 111 operations).
- **Runtime Contract**: `https://vovinamapinode.onrender.com/docs-json` (88 paths, 111 operations).
- **Delta**:
  - Missing in live: 0
  - Extra in live: 0
  - OperationId mismatches: 0
- **Verdict**: **NOT CONFIRMED (CLEAN)**.

---

## 15. Phase 17 — Deployment Posture Classification

- **Environment Tier**: Live Thesis Integration / Staging environment.
- **Swagger Documentation**: Intentionally enabled for manual testing and thesis evaluation.
- **Payment Processing**: Simulated Payment Gateway (`PAYMENTS_GATEWAY=simulated`). Commercial banking rail integration is pending owner-supplied payOS/SePay live credentials.
- **Verdict**: Accurately classified as Staging in documentation; not a production hardening defect.

---

## 16. Final Evidence Matrix (R1 – R13)

| ID | Suspected Issue | Evidence | Verification Method | Verdict | Severity |
|---|---|---|---|---|---|
| **R1** | UAT report overclaim | `generate-uat-md.mjs:116-131` generates a static table marking F1–F10 and N1–N3 as VERIFIED even when run aborted at credential gate. | Static template inspection & dry-run generation | **PARTIALLY CONFIRMED** | P2 |
| **R2** | UAT coverage false-positive risk | `live-runner-base.mjs:261` derives `covered = executed === true && result === 'PASS'`. Artificial fallback assignments removed. | Code audit, adversarial testing & `uat-runner.spec.mjs` | **NOT CONFIRMED** | CLEAN |
| **R3** | Demo credential live exposure | Hardcoded passwords removed from source. Live Render DB accounts not tested with discovered credentials per safety contract. | Repository pickaxe & static config audit | **UNVERIFIABLE** (Live DB) / **NOT CONFIRMED** (Source) | INFORMATIONAL |
| **R4** | SharedStore restart / multi-instance risk | In-memory store loses rate limits/budgets on restart, but access token revocation is backed by Postgres `session.revoked` & `user.pwdVersion`. | Data-flow tracing in `JwtAuthGuard` & `AuthService` | **PARTIALLY CONFIRMED** (Architecture limitation) | P3 |
| **R5** | Webhook claim-before-settle recovery risk | `updateMany` sets `gatewayTxnId` before `settleInvoice`. If `settleInvoice` throws, retries see `claimed.count === 0` and return 200 no-op, stranding transaction. | Static transactional flow analysis in `payments.service.ts` | **CONFIRMED** | P2 |
| **R6** | Multiple pending QR / overpayment risk | `createQrPayment` allows unbounded PENDING transactions; multiple successful webhooks both settle without overpayment flagging. | Static analysis of payment lifecycle | **PARTIALLY CONFIRMED** | P3 |
| **R7** | Evaluation READ scope | Authorized instructors see all evaluations of an actively enrolled student per Guard 7.3 and Matrix Row 12. Writes strictly author-locked. | Matrix reconciliation & service code audit | **NOT CONFIRMED** | CLEAN |
| **R8** | Smoke script weak fallback credential | `load/smoke.mjs:41` contains `ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123'`. | Static grep in `load/` directory | **CONFIRMED** | P3 |
| **R9** | CI deployment smoke stub | `ci.yml:378-387` exits 0 when `RENDER_DEPLOY_HOOK` or `SMOKE_TEST_URL` are missing. | Workflow inspection | **CONFIRMED** (Classified as NOT_PROVEN) | P2 |
| **R10** | OpenAPI runtime drift | Zero path, method, or operationId differences between `openapi.json` and live `/docs-json`. | Runtime HTTP diff against live Render | **NOT CONFIRMED** | CLEAN |
| **R11** | Business-logic gaps | Core domain workflows (classes, belts, exams, attendance, billing) fully enforced. Only edge-case payment recovery (R5/R6) is partial. | Cross-module invariant inspection & unit specs | **PARTIAL** | P2 |
| **R12** | Security / data leakage | Zero leaks in serializers, Pino logs redact sensitive keys, live probes returned clean envelopes and security headers. | Anonymous live HTTP probes & serializer audit | **NOT CONFIRMED** | CLEAN |
| **R13** | Technical debt | Zero TODOs in code; minor debt in test utility fallback credentials and static report prose. | Repository sweep & npm dependency audit | **CONFIRMED** | P3 |

---

## 17. Final Assessment & Verdict

### Triage Summary
- **Confirmed P0 Blockers**: 0
- **Confirmed P1 Blockers**: 0
- **Confirmed P2 Issues**:
  - R1: Static prose table in `generate-uat-md.mjs` claiming F3–F10, N3 as VERIFIED when live run aborted.
  - R5: Webhook claim-before-settle recovery gap stranding retried transactions.
  - R9: CI deployment gate classified as NOT_PROVEN due to silent exit 0 stub.
- **Confirmed P3 Issues**:
  - R4: Single-instance in-memory SharedStore reset characteristics.
  - R6: Multiple concurrent pending QR transactions without overpayment flags.
  - R8: Fallback credential literal in `load/smoke.mjs`.
  - R13: Transitive moderate vulnerabilities in Bruno CLI devDependency.

### Verification Verdict

**CONFIRMED ISSUES REQUIRE REPAIR**

*Rationale*:  
While the application source code contains no P0/P1 security breaches or authorization defects, the release evidence contains a confirmed test-reporting defect (R1) where `docs/LIVE_RENDER_UAT.md` claims operational invariants are verified even when the run was aborted after 6 probes, alongside an unhandled payment webhook recovery edge-case (R5). Once the report generator is updated to dynamically evaluate Section 4 and the webhook settlement claim is bound inside the transaction, the release evidence will be authoritative.

---
*No source code, database records, CI configurations, or Render deployment settings were modified during this verification.*
