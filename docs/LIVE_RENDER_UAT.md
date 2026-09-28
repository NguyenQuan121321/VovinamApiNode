# Live Render UAT — Full System Verification Report

**Target Environment**: Thesis Staging / Integration Deployment (Render)  
**Base URL**: `https://vovinamapinode.onrender.com`  
**Run ID**: `uat-mukgjip5-568eb4`  
**Execution Timestamp**: `2026-09-27T23:36:30.005Z`  
**Run Lifecycle Status**: `RUN ABORTED`  
**Cleanup Lifecycle Status**: `CLEANUP COMPLETED`  
**Total Assertions Recorded**: `6`  
**Pass**: `5 (83.3%)`  
**Fail**: `0 (0.0%)`  
**Blocked**: `1`  
**Manual Required**: `0`  
**Not Safe To Automate (Protected Global Settings)**: `0`  
**OpenAPI Operation Coverage (PASS with real HTTP)**: `3 / 111`  

---

## 1. Executive Summary & Environment Posture

This report documents the black-box User Acceptance Testing (UAT) pass executed against the live deployed VovinamApiNode service on Render.

### Deployment Environment Classification (Findings N1 & N2)
- **Deployment Tier**: Live Integration / Staging Environment.
- **Swagger Documentation (/docs & /docs-json)**: **INTENTIONALLY ENABLED** on this staging environment to support frontend client development, manual QA, and thesis evaluation. (In production hardening, Swagger is configured off).
- **Payment Processing**: **SIMULATED PAYMENT GATEWAY** (`PAYMENTS_GATEWAY=simulated`). This deployment does not settle against live commercial banking or real-money card networks. Real payment gateway settlement remains **BLOCKED / MANUAL_REQUIRED** pending owner-provided live credentials.
- **Data Protection & Isolation**: All mutating operations strictly targeted newly-created synthetic entities initialized within this specific test run. Zero pre-existing demo or member records were modified.

### Key Verification Metrics
- **Assertions Passing**: `5 / 6`
- **Failures Detected**: `0`
- **Response Bodies Scanned for Leaks**: `5`
- **Detected Credential / Stack Leaks**: `0`
- **Global Settings Mutations**: **0 executed** (`PUT /admin/billing/settings/*` classified as `NOT_SAFE_TO_AUTOMATE` and withheld).
- **Cleanup Guarantee**: Guaranteed `try/finally` execution with signal trapping (`SIGINT` / `SIGTERM`).

---

## 2. Resource Isolation & Synthetic Residue Audit

To eliminate data corruption and ensure complete isolation from demo or real records, every entity mutated by this runner was created during this specific run with the prefix `uat-mukgjip5-568eb4`.

### Synthetic Resources Created & Cleaned
| Resource Type | Created in Run | Cleaned Up on Exit | Status |
|---|---|---|---|
| User Accounts | 0 | 0 (Deactivated) | **NOT_APPLICABLE** (0 created) |
| Student Profiles | 0 | 0 (Soft-deleted) | **NOT_APPLICABLE** (0 created) |
| Classes | 0 | 0 (Deleted) | **NOT_APPLICABLE** (0 created) |
| Schedules | 0 | 0 (Removed) | **NOT_APPLICABLE** (0 created) |
| Enrollments | 0 | 0 (Removed) | **NOT_APPLICABLE** (0 created) |
| Announcements | 0 | 0 (Deleted) | **NOT_APPLICABLE** (0 created) |
| Leave Requests | 0 | 0 (Deleted/Cancelled) | **NOT_APPLICABLE** (0 created) |
| Evaluations | 0 | 0 (Deleted) | **NOT_APPLICABLE** (0 created) |
| Discounts | 0 | 0 (Deleted) | **NOT_APPLICABLE** (0 created) |

### Immutable Financial Residue (Preserved by Database Foreign-Key Policy)
By application design, financial invoices and payments enforce historical immutability (`onDelete: Restrict`). The synthetic financial entities created in this run remain safely associated only with the soft-deleted synthetic student profiles:
- **Synthetic Invoices Created**: `0` (None)
- **Synthetic Payments Created**: `0` (None)

---

## 3. Information Leak & Security Scan

Actual response bodies received from the live server were inspected for sensitive information patterns (`DATABASE_URL`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `passwordHash`, unhandled Prisma errors, or raw Node.js stack traces).

- **Total HTTP Responses Inspected**: `5`
- **Information Leaks Found**: `0`
- **Audit Verdict**: **VERIFIED — CLEAN**



---

## 4. Operational Invariant Verification Verdicts

Separation of implementation contract verification (source, test suite, and static gates) from live black-box execution evidence. An invariant is marked **VERIFIED** in live execution only when actual execution evidence exists.

| Domain Invariant / Finding | Verification Focus | Implementation Status | Live Execution Status | Evidence / Notes |
|---|---|---|---|---|
| **F1/F2 Credential Repair** | Runtime Credentials & Source Hygiene | **VERIFIED** | **BLOCKED** | LIVE_UAT_ADMIN_PASSWORD missing in runtime environment; authentication safely blocked. |
| **F3 Resource Isolation** | Synthetic Graph & Zero Pre-existing IDs | **VERIFIED** | **NOT_PROVEN** | Run created 0 synthetic entities; resource isolation unproven in live run. |
| **F4 Global Settings Preservation** | Settings Immutability on Live | **VERIFIED** | **NOT_PROVEN** | Run aborted before settings safety assertions were reached. |
| **F5 Financial Mutation Safety** | Synthetic Invoices & Payment Isolation | **VERIFIED** | **NOT_PROVEN** | No financial workflows executed live in this run. |
| **F6 OpenAPI Coverage Integrity** | Coverage Calculated on Pass Only | **VERIFIED** | **NOT_PROVEN** | Only 3/111 operations covered; live run did not execute full API suite. |
| **F7 /docs Fail-Closed Assertion** | HTTP 200 Dynamic Evaluation | **VERIFIED** | **VERIFIED** | Live /docs responded with HTTP 200 and was dynamically verified. |
| **F8 Rate-Limit Non-Flooding** | Safe Sampling Rate Probe | **VERIFIED** | **NOT_PROVEN** | Rate limit probe was not reached during this run. |
| **F9 Dynamic Reporting** | JSON-driven Report Interpolation | **VERIFIED** | **VERIFIED** | Report generated dynamically from execution JSON (6 tests, 5 pass, 0 fail). |
| **F10 Guaranteed Cleanup** | Signal Trapping & Process Cleanup | **VERIFIED** | **NOT_APPLICABLE** | Zero synthetic resources were created; cleanup had no live entities to process. |
| **N1 Render Environment Posture** | Staging Deployment Classification | **VERIFIED** | **VERIFIED** | Render live probes confirmed /healthz and /readyz (DB up) in staging posture. |
| **N2 Swagger Posture** | Staging Documentation Enablement | **VERIFIED** | **VERIFIED** | Swagger OpenAPI document actively served at /docs-json for staging review. |
| **N3 Evaluation Class Scoping** | Instructor Scoping Anti-probing 404 | **VERIFIED** | **NOT_PROVEN** | Run aborted before evaluation workflow was reached; unproven in live run. |

---

## 5. Detailed Test Execution Log

| Phase | Assertion Name | Expected | Actual | Result | Notes |
|---|---|---|---|---|---|
| 0 | GET /healthz liveness probe | 200 | 200 | **PASS** | Latency: 321ms |
| 0 | GET /readyz readiness probe | 200 | 200 | **PASS** | Latency: 89ms, DB: up |
| 0 | GET /metrics without token returns 401 | 401 | 401 | **PASS** | Protected metrics endpoint requires Bearer [REDACTED] |
| 0 | GET /docs live documentation endpoint | 200 | 200 | **PASS** | Swagger UI served (Staging/Integration environment posture) |
| 0 | GET /docs-json live OpenAPI document | 200 | 200 | **PASS** | OpenAPI document served, paths: 88 |
| 1 | Safety Gate: Runtime credentials present | LIVE_UAT_ADMIN_PASSWORD set in environment | MISSING | **BLOCKED** | LIVE_UAT_ADMIN_PASSWORD required. Live run blocked per Phase 1/15 safety contract. |
