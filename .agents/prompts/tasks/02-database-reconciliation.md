# TASK-02 — Database Reconciliation

## Objective

Reconcile the existing PostgreSQL/Prisma database with the approved:

- thesis requirements
- system architecture baseline
- actor/authorization model
- domain model
- business flows

The objective is NOT to create a new database from scratch.

The objective is to determine whether the current schema should be:

- KEPT
- KEPT WITH TARGETED MIGRATIONS
- MAJOR REDESIGN REQUIRED

---

# 1. Preconditions

Read:

- `.agents/AGENTS.md`
- `.agents/prompts/00-global-contract.md`
- `.agents/prompts/01-prompt-launcher.md`
- `docs/SYSTEM_ARCHITECTURE_BASELINE.md`
- `docs/CURRENT_STATE_AUDIT.md`
- `docs/PLAN.md`
- `IMPLEMENTATION_PROGRESS.md`

Inspect:

- `prisma/schema.prisma`
- every migration
- `prisma/seed.ts`
- relevant services
- DTOs
- controllers
- tests
- OpenAPI

---

# 2. Database Domains

Review:

AUTH
- users
- sessions
- refresh tokens
- MFA
- recovery
- used tokens
- audit

STUDENT
- student profiles
- parent/student relationship

TRAINING
- classes
- schedules
- enrollments
- attendance sessions
- attendance records

BELTS/EXAMS
- belt ranks
- belt exams
- exam registrations

BILLING
- invoices
- invoice items
- payment transactions

CONFIG
- app settings

Determine whether each table is:

KEEP
KEEP + MODIFY
DEFER
MERGE
SPLIT
REMOVE

Do not recommend destructive changes without strong evidence.

---

# 3. Relationship Review

For every major relationship verify:

- cardinality
- FK correctness
- nullable semantics
- ownership
- delete behavior
- historical preservation

Pay special attention to:

student → enrollment
student → attendance
student → exams
student → invoices
invoice → payments
parent → student
class → schedules
class → attendance sessions

---

# 4. Constraint Review

Determine whether important invariants are enforced correctly using:

- NOT NULL
- UNIQUE
- composite UNIQUE
- FOREIGN KEY
- CHECK
- ENUM
- indexes
- transactions

Review at least:

- class capacity
- duplicate enrollment
- attendance uniqueness
- exam registration uniqueness
- invoice period uniqueness
- payment transaction uniqueness
- gateway idempotency
- invite-code uniqueness
- valid periods
- valid amounts
- valid belt relationships

Classify enforcement:

APPLICATION
DATABASE
BOTH
MISSING

---

# 5. Historical Data

Identify which data represents historical facts.

Verify that:

- attendance survives enrollment removal
- exam history survives belt promotion
- financial history survives account changes
- payment records are never accidentally deleted
- audit history remains available where required

Ensure current-state fields are not incorrectly used as history.

---

# 6. Concurrency and Transactions

Inspect:

- enrollment creation
- capacity checks
- invoice generation
- payment creation
- payment webhook
- cash confirmation
- refund/dispute
- exam registration
- result submission

Determine whether concurrent requests can violate invariants.

Do not invent enterprise concurrency requirements.

Use evidence from actual query/transaction structure.

---

# 7. Authorization Support

Verify that database relationships support:

- student ownership
- parent-child access
- instructor-class access
- admin access

Identify schema structures that make secure authorization difficult.

---

# 8. Financial Integrity

Review:

- invoice totals
- invoice items
- discount handling
- payment amounts
- payment status
- settlement
- refunds
- disputes
- unique gateway transaction IDs
- order references

Determine whether contradictory financial states are representable.

---

# 9. Migration Strategy

For every required schema change define:

- migration name
- purpose
- affected tables
- data transformation
- backward compatibility
- deployment risk
- rollback consideration
- test requirement

Never modify an existing applied migration.

Only create a new migration if implementation is authorized by the selected task.

---

# 10. Required Deliverable

Create or update:

`docs/DATABASE_BASELINE.md`

The document must define:

## A. Canonical tables

## B. Canonical relationships

## C. Key constraints

## D. Index strategy

## E. Historical-data policy

## F. Soft-delete policy

## G. Transaction boundaries

## H. Idempotency rules

## I. Database/application responsibility split

## J. Required migrations

## K. Deferred database changes

---

# 11. Implementation

ONLY implement database changes that are explicitly identified as necessary by this reconciliation.

For every schema change:

1. modify `schema.prisma`
2. create a NEW Prisma migration
3. never edit an already-applied migration
4. update affected tests
5. update OpenAPI when API shape changes
6. run the required migration verification

Never use `prisma db push` for persistent project schema changes.

---

# 12. Acceptance Criteria

- Current schema is fully reconciled against architecture.
- Every important relationship is justified.
- Important invariants are classified by enforcement layer.
- Historical data is protected.
- Payment/invoice integrity is verified.
- Concurrency-sensitive operations are reviewed.
- All required schema changes have explicit reasons.
- Any migration is versioned and committed.
- Existing migrations remain unchanged.
- Relevant tests pass.
- Required CI/database verification passes.

---

# 13. Required Closing Output

RESULT:
<COMPLETE or BLOCKED>

DATABASE VERDICT:
<KEEP / KEEP + TARGETED MIGRATIONS / MAJOR REDESIGN>

SCHEMA CHANGES:
<summary>

MIGRATIONS:
<list>

TABLES ADDED:
<list>

TABLES MODIFIED:
<list>

TABLES REMOVED:
<list>

API IMPACT:
<summary>

TEST EVIDENCE:
<actual results>

OPENAPI STATUS:
<actual status>

REMAINING RISKS:
<risks>

NEXT ELIGIBLE TASK:
<TASK-03>

STOP.