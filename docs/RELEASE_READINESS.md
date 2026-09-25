# VovinamApiNode — Release Readiness Checklist (TASK-06)

Date: 2026-09-24. Release tree: `origin/main` @ `61c711b` (+ QA branch `docs/final-qa`:
S-02 regression test, README status line). Companion narrative: `docs/FINAL_QA_REPORT.md`.
Verdict: **RELEASE READY WITH DOCUMENTED LIMITATIONS** — every item below states PASS or
names its missing evidence; nothing is claimed without proof.

## Mandatory lifecycles (e2e, real database)

| # | Lifecycle | Result | Evidence (86/86 e2e+security run, 2026-09-24) |
|---|---|---|---|
| 1 | Register → verify → login → refresh → logout | PASS | `auth-lifecycle.e2e-spec.ts`, `auth-coverage.e2e-spec.ts` |
| 2 | MFA: enroll → TOTP login → recovery code → disable | PASS | `auth-coverage` (methods/recovery/disable), `s05` (login-verify), `s13` (enroll via API) |
| 3 | Parent: register → invite-code link → child access | PASS | `students-roles.e2e-spec.ts` |
| 4 | Class → enrollment → attendance session → bulk records → history/summary | PASS | `classes-attendance.e2e-spec.ts` |
| 5 | Belt rank → exam → registration (invoice) → result → promotion | PASS | `belts-exams.e2e-spec.ts` |
| 6 | Invoice → QR → signed webhook → exactly-once → PAID | PASS | `billing.e2e-spec.ts` (incl. S-03 parallel, S-11, DD-04) |
| 7 | Monthly generation → payment → revenue report | PASS | `billing.e2e-spec.ts` |
| 8 | Notification: queue → deliver → retry/fallback | PASS | `notifications-consent.e2e-spec.ts` + outbox unit specs (fallback/backoff/cap/stale recovery) |
| 9 | Consent: grant → use → revoke → honored | PASS | `notifications-consent.e2e-spec.ts` |
| 10 | Admin operation → audit record | PASS | `auth-coverage` audit-log test + audit assertions in consent/exam/invoice/payment suites |

## Mandatory security cases

| Case | Result | Evidence |
|---|---|---|
| S-01 IDOR parent | PASS | e2e (students-roles, classes-attendance, notifications-consent) |
| S-02 soft-delete financial integrity | PASS | e2e — **test added by TASK-06 QA** (`students-roles.e2e-spec.ts`); regression-verified |
| S-03 webhook duplicate/parallel | PASS | e2e (billing) |
| S-04 instructor scoping | PASS | e2e (classes-attendance, students-roles) |
| S-05 shared TOTP bucket | PASS | e2e (s05) |
| S-06 minor self-registration block | PASS | unit (`auth.service.spec.ts` `/under 18/`) |
| S-07 uniform auth failures | PASS | e2e (s07) |
| S-08 refresh replay revokes all | PASS | e2e (s08) |
| S-09 forgot-password uniformity | PASS | e2e (s09) |
| S-10 IPv6 /64 throttling + pinned key | PASS | unit (`ip-tracker.spec.ts`, 8 cases) |
| S-11 webhook signature/amount | PASS | e2e (billing) |
| S-12 post-logout jti denylist | PASS | e2e (s12) |
| S-13 ADMIN MFA enforcement | PASS | e2e (s13) + roles.guard unit specs |

## Gates (real output, 2026-09-24)

| Gate | Result |
|---|---|
| format / lint / typecheck / build | PASS (exit 0 each) |
| Unit tests + coverage floors | **325/325 (66 suites)**; global 91.09% stmts ≥ 75% floors |
| E2E + security vs disposable PG 18 | **86/86 (15 suites)** |
| Migration verification (empty DB) | deploy clean → **25 tables**; `migrate status` up to date; drift diff "No difference detected"; seed idempotent ×2 |
| OpenAPI | regenerate idempotent, **67 paths / 81 operations**; spectral **0 errors** (81 description warnings, pre-existing) |
| Dependency audit | `npm audit --audit-level=high` → **0 vulnerabilities** |
| SAST / secrets / container scan / license | CI **success** on `61c711b` (Semgrep, gitleaks, Trivy, license-check) |
| Docker image | CI `docker` job **success** (multi-stage, non-root) |
| Production boot guards | Demonstrated live: prod refuses simulated gateway, missing webhook secret, missing METRICS_TOKEN (exit 1) |
| CI on release commit | 13/13 applicable jobs success; commitlint skipped (PR-only); deploy job "success" = documented stub behavior |

## Performance/load smoke

Measured baseline from TASK-05 (`load/smoke.mjs`, 20 VU, disposable PG 18;
`docs/SECURITY.md` §8): GET /invoices (ADMIN) ≈ 340–400 rps, p50 49–58 ms, p99 69–97 ms;
/healthz ≈ 3.4–3.6k rps; RSS ≈ 415 MB; event-loop lag ≤ 4 ms. TASK-06 changed no
production code → baseline stands (no remeasure required by the measurement rule). No
N+1 / unbounded-list / missing-pagination defect open.

## Migrations

Committed SQL; replay from empty DB → 25-table assertion (CI `migration-dry-run`
success); applied history frozen; `announcements` was the only post-baseline table.
Deployment applies `prisma migrate deploy` via the release command — **wiring pending
hosting service (owner)**.

## Legal/accounting dependencies (require human verification — not code claims)

- Decree 13/2023 (personal data), Children Law 2016 (minors/consent), medical-notes
  handling, e-invoice obligations (Decree 123/2020) at current scale, bank-account/tax
  status (Circular 25/2025 / Decree 68/2026), audit-log retention.
- Status: **requires named, dated human/legal/accounting verification** before real-money
  go-live (SECURITY.md §10 classification).

## Open items blocking *full* go-live (not prototype demonstration)

1. Deployment trial: create staging/prod service, wire release-command migrations, set
   `RENDER_DEPLOY_HOOK` + `SMOKE_TEST_URL`, run first deploy + smoke (application side
   verified; owner action).
2. Backup/DR: enable provider PITR, run first restore drill (owner action).
3. payOS sandbox credentials → one real QR → webhook → PAID demo (adapter ready).
4. SMTP account for deliverable email; Zalo OA/ZNS template approval (optional channels).
5. Legal/accounting verifications above.

**Verdict: RELEASE READY WITH DOCUMENTED LIMITATIONS** (see FINAL_QA_REPORT.md §12).
