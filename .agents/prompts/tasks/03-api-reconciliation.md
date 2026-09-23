# TASK-03 — API Reconciliation

## Objective

Reconcile the current REST API with the approved:

- thesis requirements
- system architecture baseline
- authorization baseline
- database baseline

The objective is to establish a canonical API contract without unnecessary endpoint churn.

---

# 1. Preconditions

Read:

- `.agents/AGENTS.md`
- global engineering contract
- launcher
- `docs/CURRENT_STATE_AUDIT.md`
- `docs/SYSTEM_ARCHITECTURE_BASELINE.md`
- `docs/DATABASE_BASELINE.md`
- `docs/PLAN.md`
- `IMPLEMENTATION_PROGRESS.md`

Inspect:

- controllers
- DTOs
- services
- guards
- serializers
- `openapi.json`
- unit tests
- E2E tests
- security tests

---

# 2. Use Case Mapping

For every thesis use case map:

USE CASE
→ ACTOR
→ PERMISSION
→ ENDPOINT
→ SERVICE
→ DATABASE

Required areas:

- auth
- students
- classes
- schedules
- attendance
- belts
- exams
- tuition
- payment
- parent access
- reports
- notifications

---

# 3. Endpoint Review

Identify:

- missing endpoints
- duplicate endpoints
- unnecessary endpoints
- incorrect HTTP methods
- inconsistent response behavior
- inconsistent pagination
- missing authorization
- missing ownership checks
- excessive data exposure
- inconsistent errors

Preserve existing API conventions unless evidence requires change.

---

# 4. Authorization Review

Verify every protected endpoint has explicit authorization.

Check:

- ADMIN
- INSTRUCTOR / Võ sư / HLV mapping
- STUDENT
- PARENT

Verify object ownership.

Student-scoped endpoints must not expose another student's data.

---

# 5. Data Exposure Review

Check serializers and DTO outputs for:

- password hashes
- authentication secrets
- MFA secrets
- internal identifiers
- medical notes
- parent/private data
- payment-sensitive information
- audit details

Role-based exposure must match the approved authorization baseline.

---

# 6. API Consistency

Verify:

- `/api/v1`
- response envelope
- pagination
- validation
- error format
- status codes
- UUID parsing
- authentication
- authorization
- ownership behavior
- Swagger documentation

---

# 7. Implementation

Implement only required API corrections.

For every API change:

- update controller
- update DTO
- update service if required
- update tests
- regenerate `openapi.json`
- run `npm run contract:lint`

---

# 8. Acceptance Criteria

- Every core thesis use case maps to an API.
- Every protected endpoint has explicit authorization.
- Ownership rules are enforced.
- API behavior is consistent.
- OpenAPI matches implementation.
- Relevant unit/E2E/security tests pass.
- No unrelated endpoint refactor is introduced.

---

# 9. Required Closing Output

RESULT:
<COMPLETE or BLOCKED>

API VERDICT:
<summary>

ENDPOINTS ADDED:
<list>

ENDPOINTS MODIFIED:
<list>

ENDPOINTS REMOVED:
<list>

AUTHORIZATION IMPACT:
<summary>

OPENAPI:
<actual status>

TEST EVIDENCE:
<actual results>

REMAINING RISKS:
<risks>

NEXT ELIGIBLE TASK:
<TASK-04>

STOP.