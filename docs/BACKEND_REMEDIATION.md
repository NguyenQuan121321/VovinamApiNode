# Backend remediation acceptance

Date: 2026-10-05. Source branch: codex/acceptance-remediation. Baseline: 1e174e8e9522ff41e823387c8f4dc194c829eb27. Scope: backend repairs from the final thesis acceptance findings, Render deployment reliability and preparation for a later single-instance VPS. The original acceptance report remains a historical baseline.

## Confirmed findings repaired

| Finding | Repair | Regression evidence |
|---|---|---|
| D1: distinct concurrent payments over-settle an invoice | All money transitions serialize on the invoice row; excess signed receipts become DISPUTED | Five real-PostgreSQL fixtures, two concurrent distinct successful callbacks: one SUCCESS and one DISPUTED per invoice |
| D2: concurrent QR replacement leaves multiple pending transactions | Lock invoice before replacing pending QR state | Five concurrent requests leave one PENDING and preserve five history rows |
| D3: student audit actor absent | Pass authenticated actor into student mutations and record structured userId | API-created student audit row matches the MFA-authenticated ADMIN |
| D4: failed audit batch lost | Retain batches, retry stable event UUIDs with duplicate suppression and sanitized failure logging | Injected first DB failure, second flush persists the original event once |
| D5: SMTP failure marked SENT | Propagate sanitized SMTP failures; outbox increments retries and schedules backoff | SMTP fault injection remains QUEUED with retry count 1, not SENT |
| D6: scanner errors could pass | Require successful exit plus explicit empty findings and errors arrays | Fatal error, nonzero exit, findings and malformed/missing report regressions fail |
| D7: dependency advisories | Patch dependency tree; migrate Jest 30; replace Spectral CLI with official SDK using existing rules | Clean npm ci and npm audit: zero vulnerabilities; Bruno CLI version/help and Spectral quality smoke checks |
| D8: valid DTO monetary multiplication causes DB overflow | Validate line products and aggregate subtotal/discount against integer storage bounds | Oversized product and combined subtotal return controlled HTTP 400 |

Additional safeguards: late/expired receipts remain disputed for reconciliation; disputed receipts can be recorded refunded by an authorized MFA administrator; terminal refunded state survives callback replay. Notification claims use lease timestamps, eligible-row locks, real fallback channel metadata and shutdown draining. Database disconnect happens after module drains. SMTP transport waits are bounded. Logs omit mail recipients, bodies and raw provider errors.

## Verification

- Unit: 448/448, 84 suites, coverage gates unchanged and passed. Global coverage: statements 91.94%, branches 83.57%, functions 85.49%, lines 92.31%.
- Integration/security: 107/107, 17 suites, real isolated PostgreSQL 16. Billing regression fixtures exercise actual transactions and row locks.
- UAT runner/report tests: 15/15. These verify the runner and evidence classification; they do not establish authenticated hosted UAT.
- CI helper regression tests: 5/5.
- Format, lint, TypeScript, build and license checks passed.
- OpenAPI: 89 paths, 112 operations; Spectral zero diagnostics. GET /version and changed monetary/refund behavior are documented. Frontend handoff: FRONTEND_INTEGRATION.md.
- Migration replay: nine committed migrations applied from an empty synthetic database; 29 public tables including _prisma_migrations. Reliability migration adds audit event IDs and notification claim timestamps only.
- Docker: non-root runtime, migration on startup, health/readiness/version HTTP 200; SIGTERM exits 0 without OOM. Local image uses the baseline SHA as a smoke-test build argument and is not evidence of a released source identity.
- Gitleaks source snapshot: version 8.30.1, zero leaks; full Git history is checked independently in CI.
- Semgrep source snapshot: pinned version 1.178.0; 144 rules, zero findings and zero scanner errors. Exit/report integrity gate passed.
- Container scan: pinned Trivy 0.74.0, configured HIGH/CRITICAL policy with unfixed excluded and bundled npm skipped as in CI: zero findings. This is not a claim that all unfixed vulnerabilities are absent.
- Restore drill: isolated synthetic database restored in 3 seconds; counts match across all 29 tables. A populated restore target is rejected. No live data was restored or overwritten.
- Adapter fault injection: audit retry, failed SMTP/outbox retry and invalid production configuration all passed.

An initial E2E attempt lost its WSL database connection midway; the complete rerun on isolated PostgreSQL 16 passed. A /version contract omission was corrected and the full unit/coverage run repeated successfully. A local Semgrep attempt could not resolve the Windows worktree Git pointer inside Docker; verification uses a clean source snapshot and the repository CI checkout. No scanner-error gate was bypassed.

## Deployment status

LOCAL_BACKEND_REMEDIATION = VERIFIED for the checks listed above.
CI_SECURITY_AND_RELEASE = PENDING until the current commit's required jobs complete.
RENDER_EXACT_COMMIT_DEPLOYMENT = PENDING until /version matches the released commit and health/readiness pass.
LIVE_AUTHENTICATED_UAT = BLOCKED: a legitimate seed exists, but this session has no authorized deployment shell/database connection or dedicated ADMIN credentials to provision an isolated administrative identity. No public bootstrap was invented, no role was promoted directly and MFA remains enforced.

No live accounts or business resources were created during this remediation. Local fixtures are synthetic and isolated. Original financial and audit evidence is preserved.

## Remaining operational acceptance

These require provider configuration or human evidence, not an authentication workaround:

- Configure and prove actual email delivery on a path supported by the current host. Logging mail does not support real account verification/reset. Free Render blocks common SMTP ports.
- Configure approved real payOS merchant credentials and verify QR -> authentic callback -> settlement/refund reconciliation in the sandbox before real money.
- Supply exact frontend origins and verify the delivered frontend's integration against the committed contract.
- Verify actual managed backup/PITR entitlement, retention, offsite copies, monitoring and a representative operational recovery. Local counts are not byte-level integrity or proven production RPO/RTO.
- Confirm privacy, consent, retention, banking and accounting duties through responsible qualified owners.
- Keep one API instance; process-local SharedStore and buffered audits are not durable cluster-wide facilities. Audit buffering still has a bounded-capacity/abrupt-crash loss limit. Notification delivery is at-least-once. ZNS/SMS adapters remain intentionally unconfigured until approved integrations exist.

Do not call the system production-ready solely from local tests or deploy health. Current CI/deployment outcomes and compact evidence will be added after the release check. Raw local logs are intentionally not committed because they contain test event detail and add little review value.

Compact local evidence: [verification.json](evidence/backend-remediation-20261005/verification.json). Raw local artifacts are retained in the same directory; CI provides independent release logs.
