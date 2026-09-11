# TASK-06 — Final QA and Release

## Objective

Perform final release-readiness verification of the whole system. No unrelated new features; defects found here are fixed minimally with regression tests.

## Mandatory E2E business lifecycles

Verify each end to end against a real (staging-like) database, with evidence:

1. Register -> verify email -> login -> refresh -> logout
2. MFA: enroll -> login with TOTP -> recovery-code use -> disable
3. Parent: register -> link student via invite code -> access child data
4. Class -> enrollment -> attendance session -> bulk records -> history/summary
5. Belt rank -> exam -> registration (invoice created) -> result entry -> rank promotion
6. Invoice -> QR -> signed webhook -> exactly-once settlement -> invoice PAID
7. Monthly tuition generation -> payment -> revenue report
8. Notification: queue -> deliver -> retry/fallback
9. Consent: grant -> use -> revoke -> revocation honored
10. Admin operation -> corresponding audit record

## Security suite

Run every required security case, including: IDOR/ownership (S-01, S-04), soft-delete financial integrity (S-02), webhook duplicate/parallel (S-03), TOTP shared bucket (S-05), minor self-registration block (S-06), uniform auth failures (S-07), refresh reuse (S-08), forgot-password uniformity (S-09), IPv6 /64 throttling (S-10), webhook signature/amount (S-11), post-logout token rejection (S-12), plus the abuse-protection suite from TASK-03.

## Regression testing

Run the complete unit, E2E, and security suites — not a subset. Any test weakened or skipped during earlier phases must be restored or the reason documented.

## Performance/load smoke

Use the existing k6/load tooling where available. Measure before changing anything: throughput, p50, p95, p99, error rate, DB connections, slow queries, CPU/memory. Do not invent arbitrary enterprise performance targets. The loop is measured baseline -> bottleneck (with evidence) -> minimal fix -> remeasure, reporting both numbers. A smoke result alone does not gate the release unless it exposes a defect.

## Release gates

All must pass with real output: format, lint, typecheck, unit tests with coverage floors, migration verification against an empty DB, E2E, security tests, OpenAPI contract (regenerated + spectral clean), dependency audit, SAST, secret scan, container scan, Docker build.

## Release checklist

Produce `docs/RELEASE_READINESS.md` — a checklist with factual evidence per item:

- every mandatory lifecycle: pass/fail with test counts
- every mandatory security case: pass/fail
- performance/load smoke: measured numbers
- OpenAPI correctness: operation count and contract-gate result
- migrations: applied cleanly to an empty database (table assertion)
- CI gates: the actual run result on the release commit
- Docker image: build and scan results
- backup/restore: drill evidence with date and duration
- production configuration: release-mode boot evidence
- legal/accounting dependencies: explicitly listed as verified or requiring human confirmation

## Release rule

The release is READY only if every item above has evidence AND no required P0/P1 finding remains unresolved. A single unverified required gate means NOT READY — state it plainly with the missing evidence. Do not claim production readiness when a required gate is unverified.

## Acceptance criteria

1. All mandatory lifecycles and security cases pass with recorded output.
2. `docs/RELEASE_READINESS.md` exists, is evidence-backed, and states READY or NOT READY honestly.
3. No unrelated feature work entered the release.
4. All quality gates pass with real output.
