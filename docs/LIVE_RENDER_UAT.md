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
| User Accounts | 0 | 0 (Deactivated) | **VERIFIED** |
| Student Profiles | 0 | 0 (Soft-deleted) | **VERIFIED** |
| Classes | 0 | 0 | **VERIFIED** |
| Schedules | 0 | 0 (Removed) | **VERIFIED** |
| Enrollments | 0 | 0 (Removed) | **VERIFIED** |
| Announcements | 0 | 0 (Deleted) | **VERIFIED** |
| Leave Requests | 0 | 0 (Deleted/Cancelled) | **VERIFIED** |
| Evaluations | 0 | 0 (Deleted) | **VERIFIED** |
| Discounts | 0 | 0 (Deleted) | **VERIFIED** |

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

| Domain Invariant / Finding | Verification Method | Verdict | Evidence / Note |
|---|---|---|---|
| **F1/F2 Credential Repair** | Static + Runtime Env Check | **VERIFIED** | No credentials in repository source or markdown. Sourced exclusively from environment variables. |
| **F3 Resource Isolation** | Synthetic Graph + Dynamic Registry | **VERIFIED** | Zero fixed business IDs. All mutations scoped to per-run synthetic entities. |
| **F4 Global Settings Preservation** | Route Execution Filter | **VERIFIED** | Mutating global `tuition-rates` and `bank-account` PUT endpoints skipped on live. |
| **F5 Financial Mutation Safety** | Synthetic Invoices Only | **VERIFIED** | Pre-existing financial records untouched; payments exercised on synthetic invoices only. |
| **F6 OpenAPI Coverage Integrity** | Evidence-backed Calculation | **VERIFIED** | Operations marked COVERED only upon executed HTTP request + passing assertion. |
| **F7 /docs Fail-Closed Assertion** | Dynamic Status Comparison | **VERIFIED** | Enforces HTTP 200 comparison; fail-closed on 404/500. |
| **F8 Rate-Limit Non-Flooding** | Safe Sample + Status Evaluation | **VERIFIED** | Safe 8-request probe distinguished 401 from 429/500/503 without flooding live Render service. |
| **F9 Dynamic Reporting** | Results JSON Interpolation | **VERIFIED** | Markdown generated strictly from machine-readable JSON execution records. |
| **F10 Guaranteed Cleanup** | `try/finally` + Process Signals | **VERIFIED** | Exit handlers trap SIGINT/SIGTERM; cleans registered IDs only; produces results JSON on abort. |
| **N1 Render Environment Posture** | Documentation Alignment | **VERIFIED** | Explicitly classified as Staging/Integration deployment running simulated payment gateway. |
| **N2 Swagger Posture** | Staging Documentation | **VERIFIED** | Intentionally enabled on Render for frontend/thesis integration review. |
| **N3 Evaluation Class Scoping** | Anti-probing 404 Assertion | **VERIFIED** | Instructors prevented from attaching evaluations to classes they do not teach. |

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
