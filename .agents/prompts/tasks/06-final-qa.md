# TASK-06 — Final QA and Release Readiness

## Objective

Perform the final quality, functional, security, contract, database, and operational verification of VovinamApiNode.

This task is a RELEASE GATE.

It does not exist to add features.

The goal is to determine whether the current repository is ready to be presented, demonstrated, deployed as a thesis prototype, or released to the intended environment.

---

# 1. Preconditions

Read:

- `.agents/AGENTS.md`
- global engineering contract
- launcher
- `docs/CURRENT_STATE_AUDIT.md`
- `docs/SYSTEM_ARCHITECTURE_BASELINE.md`
- `docs/DATABASE_BASELINE.md`
- API baseline
- `docs/PLAN.md`
- `IMPLEMENTATION_PROGRESS.md`

Inspect the complete repository and current Git state.

---

# 2. Functional Verification

Verify the complete thesis-critical flow.

At minimum:

## Authentication

- register
- verification
- login
- session
- refresh
- logout
- password lifecycle
- MFA where enabled

## Student Management

- profile creation
- profile retrieval
- profile update
- ownership enforcement

## Training

- class creation
- class update
- schedule
- enrollment
- leave/rejoin
- attendance

## Belt/Exam

- belt rank
- exam creation
- exam registration
- payment dependency where required
- result
- belt promotion

## Tuition/Payment

- invoice
- monthly tuition generation
- QR payment
- webhook
- duplicate webhook
- payment confirmation
- refund/dispute
- revenue report

## Parent

- verified student relationship
- allowed student information
- access restrictions

## Notifications/Consent

Verify only features actually included in the approved scope.

---

# 3. Authorization Matrix Verification

For every thesis actor verify:

- allowed operations
- denied operations
- object ownership
- data exposure

Compare actual behavior against the authoritative permission matrix.

No endpoint should rely on frontend checks for security.

---

# 4. Database Verification

Verify:

- migrations replay from empty database
- current schema matches migrations
- constraints exist
- important foreign keys exist
- financial records cannot be accidentally deleted
- historical records survive intended lifecycle operations
- idempotency constraints work
- seed is safe and deterministic

Do not modify already-applied migrations.

---

# 5. API Contract Verification

Verify:

- route inventory
- HTTP methods
- request DTOs
- response shape
- status codes
- validation
- authorization
- ownership behavior
- OpenAPI synchronization

Run:

- `npm run openapi:generate`
- `npm run contract:lint`

Confirm generated contract does not drift from implementation.

---

# 6. Test Verification

Run the full relevant test suite.

At minimum:

- format check
- lint
- typecheck
- unit tests
- E2E tests
- security tests
- build
- migration verification
- OpenAPI contract lint
- dependency/security gates where available

Record actual outputs.

Do not state that a test passed unless it actually ran.

---

# 7. Security Release Gate

Review all outstanding:

- P0
- P1
- P2
- P3

Security and data-integrity blockers must not remain unresolved.

Verify:

- authentication
- authorization
- IDOR
- input handling
- secret handling
- payment integrity
- webhook integrity
- rate limiting
- sensitive data exposure

No unsupported "secure" statement is allowed.

---

# 8. Production/Deployment Readiness

Verify actual:

- build artifact
- Docker build
- environment requirements
- migration deployment
- health endpoint
- readiness endpoint
- metrics access control
- startup behavior
- graceful shutdown
- logging

Document provider/infrastructure dependencies separately from application guarantees.

---

# 9. Thesis Traceability

Produce a final traceability matrix:

THESIS REQUIREMENT
→ USE CASE
→ MODULE
→ DATABASE
→ API
→ TEST
→ RESULT

This matrix is part of the thesis evidence.

Classify each requirement:

- PASS
- PARTIAL
- NOT IMPLEMENTED
- OUT OF SCOPE

Do not mark PASS without evidence.

---

# 10. Known Limitations

Explicitly document:

- technical limitations
- deployment limitations
- infrastructure limitations
- external-provider dependencies
- unverified legal/accounting items
- intentionally deferred features
- future scalability limitations

A known limitation is acceptable.

An undocumented limitation is not.

---

# 11. Release Decision

Choose exactly ONE:

## RELEASE READY

All required acceptance criteria pass and no P0/P1 blocker remains.

## RELEASE READY WITH DOCUMENTED LIMITATIONS

Thesis requirements pass, no critical blocker remains, but non-critical production limitations exist.

## NOT READY

One or more required acceptance criteria or critical gates fail.

For NOT READY, identify the blocking task.

---

# 12. Implementation Restrictions

Do not add new business features.

Only make minimal fixes for:

- release-blocking defects
- incorrect tests
- broken contract
- critical security/integrity defects

Every fix requires regression verification.

---

# 13. Deliverables

Create or update:

`docs/FINAL_QA_REPORT.md`

The report must contain:

## Executive summary

## Thesis traceability matrix

## Functional verification

## Authorization verification

## Database verification

## API/OpenAPI verification

## Security verification

## Test evidence

## Deployment readiness

## Known limitations

## Remaining risks

## Final release decision

Also update:

`IMPLEMENTATION_PROGRESS.md`

with verified release status.

---

# 14. Acceptance Criteria

- All thesis-critical flows are verified.
- Permission matrix is verified.
- Database migrations are verified.
- API/OpenAPI is synchronized.
- Relevant tests actually run.
- Security blockers are resolved.
- Financial integrity is verified.
- Production readiness limitations are documented.
- Thesis traceability is complete.
- No unsupported claims appear.
- Final release decision is explicit.

---

# 15. Required Closing Output

RESULT:
<RELEASE READY / RELEASE READY WITH DOCUMENTED LIMITATIONS / NOT READY>

THESIS STATUS:
<summary>

FUNCTIONAL STATUS:
<summary>

AUTHORIZATION STATUS:
<summary>

DATABASE STATUS:
<summary>

API STATUS:
<summary>

SECURITY STATUS:
<summary>

TEST EVIDENCE:
<actual results>

DEPLOYMENT STATUS:
<summary>

KNOWN LIMITATIONS:
<list>

BLOCKERS:
<list>

REMAINING RISKS:
<list>

NEXT ACTION:
<none or one blocking task>

STOP.