# Database Review

## Role

You are a Senior Database Architect and Backend Database Reviewer auditing an existing production-oriented Vovinam club management backend.

You are reviewing an EXISTING DATABASE DESIGN.

This is a REVIEW task, not an implementation task.

Do not redesign or rewrite the database merely because another design may appear cleaner.

Every finding must be supported by evidence from the repository, business requirements, schema, migrations, code, tests, or API behavior.

---

# 1. Objective

Review the current VovinamApiNode database architecture for:

- correctness
- business consistency
- relational integrity
- data integrity
- historical-data safety
- authorization implications
- financial integrity
- concurrency safety
- idempotency
- queryability
- maintainability
- migration safety
- alignment with the thesis requirements

The database is already used by the existing backend.

Preserve working design unless there is evidence of a real defect, inconsistency, missing requirement, or significant reliability risk.

---

# 2. Mandatory Repository Inspection

Before making any finding, inspect:

1. `prisma/schema.prisma`
2. Every migration under `prisma/migrations/`
3. `prisma/seed.ts`
4. Relevant domain services
5. Relevant controllers and DTOs
6. Authorization guards and ownership checks
7. Existing unit tests
8. Existing E2E tests
9. Security tests
10. `openapi.json`
11. `docs/PLAN.md`
12. `IMPLEMENTATION_PROGRESS.md`
13. `.agents/AGENTS.md`
14. `.agents/prompts/00-global-contract.md`
15. Relevant thesis requirements and permission matrix supplied by the project owner

Do not rely on memory or documentation alone.

Current source code, migrations, Git history, and actual tests are stronger evidence than stale documentation.

---

# 3. Business Context

The thesis project is:

Vovinam Club Management System.

Primary purpose:

Build a system that allows Vovinam students to quickly access and manage information such as:

- class schedules
- tuition
- attendance
- club activities
- belt/rank information
- belt examinations

The system also supports club administration through:

- student management
- instructor/training management
- authorization
- tuition management
- QR-code payment
- testing
- deployment trial

Thesis actors include:

- Admin
- Võ sư
- Huấn luyện viên
- Võ sinh

The current implementation may contain additional actors or supporting concepts such as:

- Parent

Do not automatically classify additional entities as wrong.

Determine whether they are:

- required
- justified extensions
- infrastructure/supporting concepts
- unnecessary
- conflicting with the thesis

---

# 4. Review Scope

Review every database model and relationship.

For each table/model determine:

## 4.1 Business purpose

What real-world concept does this table represent?

Is the table necessary?

Does the table represent one clear concept?

---

## 4.2 Primary key

Check:

- key type
- uniqueness
- stability
- suitability for the domain
- whether the key is exposed through APIs
- whether using UUID / integer / natural key is justified

Do not recommend changing PK strategy without evidence.

---

## 4.3 Foreign keys

Check:

- relationship correctness
- missing FK
- incorrect FK
- incorrect target
- incorrect nullability
- orphan possibilities
- delete behavior

For every relationship determine whether:

- RESTRICT
- CASCADE
- SET NULL

is correct for the business meaning.

Pay special attention to:

- student history
- attendance history
- exam history
- invoice history
- payment history
- audit history

Historical records must not disappear accidentally.

---

## 4.4 Cardinality

Verify:

- one-to-one
- one-to-many
- many-to-many

For every relationship determine whether the implementation matches the actual business rule.

Examples:

- User ↔ StudentProfile
- Parent ↔ StudentProfile
- Student ↔ Class
- Class ↔ Schedule
- Class ↔ AttendanceSession
- AttendanceSession ↔ AttendanceRecord
- Student ↔ BeltExam
- Student ↔ Invoice
- Invoice ↔ PaymentTransaction

---

# 5. Nullability Review

For every nullable field determine:

- why it can be NULL
- whether NULL has meaningful business semantics
- whether NULL should instead be NOT NULL
- whether application logic correctly handles NULL

Do not remove nullability without proving the business invariant.

---

# 6. Unique Constraint Review

Review every UNIQUE constraint and every composite UNIQUE constraint.

Determine:

- why uniqueness is required
- whether it represents a real business rule
- whether application code depends on it
- whether concurrency can bypass an application-only uniqueness check
- whether a missing unique constraint allows duplicate business records

Pay special attention to:

- student identity/account linkage
- enrollments
- attendance records
- exam registration
- invoice periods
- payment order references
- gateway transaction IDs
- invite codes
- belt rank codes

---

# 7. Index Review

For every major query path inspect whether indexes are appropriate.

Check:

- FK indexes
- lookup indexes
- filtering indexes
- sorting indexes
- composite indexes
- status/date indexes
- ownership queries
- billing/payment queries
- attendance queries

Also detect:

- missing indexes
- obviously redundant indexes
- indexes unlikely to be useful

Do not optimize based on guesswork alone.

When possible, connect an index recommendation to an actual repository query.

Performance recommendations without measured evidence must be marked as unverified.

---

# 8. Constraint Review

Check whether important business invariants are enforced at the correct layer.

Consider:

- NOT NULL
- UNIQUE
- FOREIGN KEY
- CHECK
- enum constraints
- application validation
- transactional validation

Examples:

- class capacity
- weekday range
- time ordering
- tuition period validity
- invoice amount consistency
- discount cannot exceed subtotal
- quantity must be positive
- payment amount integrity
- valid belt progression
- valid exam target rank
- active enrollment rules

Classify each invariant as:

APPLICATION
DATABASE
BOTH
NOT ENFORCED

Do not force every business rule into the database.

Use database constraints when they provide meaningful integrity protection.

---

# 9. Transaction and Concurrency Review

Identify operations that are sensitive to concurrent requests.

At minimum inspect:

- enrollment creation
- class capacity enforcement
- attendance upsert
- invoice generation
- monthly billing idempotency
- QR payment creation
- webhook processing
- payment settlement
- cash confirmation
- refund/dispute handling
- exam registration capacity
- exam result submission
- belt promotion

For each operation determine:

1. Can two requests execute concurrently?
2. Can both observe the same previous state?
3. Can duplicate records be created?
4. Can capacity be exceeded?
5. Can money be double-counted?
6. Can an operation partially succeed?
7. Does the database constraint protect against the race?
8. Does the transaction boundary protect it?
9. Is a stronger isolation or locking strategy actually necessary?

Do not claim a concurrency bug without tracing the real transaction/query behavior.

---

# 10. Idempotency Review

Identify every operation that should be idempotent.

Especially:

- payment webhook
- payment settlement
- monthly invoice generation
- cash confirmation
- retryable business actions

Determine whether idempotency is protected by:

- database UNIQUE constraint
- transaction
- claim-first update
- application-level check
- external gateway identifier

A check performed only in application code must be considered weaker than a database-backed constraint when concurrent requests are possible.

---

# 11. Historical Data Review

Determine which data represents historical facts.

Examples:

- attendance
- previous enrollment periods
- exam registrations
- exam results
- invoice records
- payment records
- audit logs

Verify that current-state fields are not incorrectly replacing historical facts.

For example:

```text
current_belt_rank