# TASK-01 — Architecture Reconciliation

## Objective

Reconcile the current VovinamApiNode architecture with the actual thesis requirements and establish the authoritative system architecture baseline.

This task is an ARCHITECTURE RECONCILIATION task.

It is not a greenfield redesign.

The repository already contains a functioning backend. Preserve working architecture unless evidence proves that an architectural change is necessary.

---

# 1. Preconditions

Before executing this task, inspect:

- `.agents/AGENTS.md`
- `.agents/prompts/00-global-contract.md`
- `.agents/prompts/01-prompt-launcher.md`
- `docs/PLAN.md`
- `IMPLEMENTATION_PROGRESS.md`
- `docs/CURRENT_STATE_AUDIT.md` if available
- current Git state
- current source tree
- current Prisma schema
- migrations
- controllers
- services
- guards
- serializers
- tests
- OpenAPI

The audit/reconciliation evidence is authoritative over assumptions.

Do not begin implementation until the current architecture is understood.

---

# 2. Thesis Context

The system is a Vovinam club management system.

Primary objective:

Build a system allowing Vovinam students to quickly access information such as:

- class schedules
- tuition
- club activities

The system also supports club management through:

- student management
- instructor/training management
- class management
- attendance
- belt/rank management
- belt examination
- tuition management
- QR payment
- role-based authorization
- testing
- deployment trial

Expected technical stack:

- Node.js
- React frontend in the overall project
- PostgreSQL
- RESTful API
- QR Code
- role-based authorization

This repository is the backend API.

---

# 3. Architecture Reconciliation

Determine the actual architecture represented by the current repository.

Analyze:

- application boundaries
- modules
- responsibilities
- domain boundaries
- infrastructure boundaries
- authentication boundary
- authorization boundary
- data access boundary
- API boundary
- external integration boundary
- background jobs
- observability
- testing architecture

Determine whether the current modular-monolith architecture is appropriate for this project.

Do not introduce microservices merely because they are theoretically more scalable.

---

# 4. Actor Reconciliation

Compare the thesis actor model with the current implementation.

Thesis actors:

- Admin
- Võ sư
- Huấn luyện viên
- Võ sinh

Current backend may also contain:

- Parent

Determine:

1. Which actors are authoritative?
2. Which are roles?
3. Which are domain concepts?
4. Which are extensions?
5. Whether `Võ sư` and `Huấn luyện viên` require separate authorization roles.
6. Whether `Parent` is justified as a supporting actor.
7. Whether the current `ADMIN / INSTRUCTOR / STUDENT / PARENT` model should remain.

Do not change roles during this task.

Produce a recommendation first.

---

# 5. Domain Boundary Reconciliation

Classify current modules into:

CORE DOMAIN
SUPPORTING DOMAIN
INFRASTRUCTURE
OPTIONAL EXTENSION
OUT OF SCOPE

Evaluate:

- auth
- users
- students
- parents
- classes
- attendance
- belts
- exams
- billing
- payments
- notifications
- consent
- health
- logging
- config
- Prisma/common infrastructure

Ensure that domain boundaries reflect actual business responsibilities.

Detect:

- overlapping responsibilities
- duplicated business rules
- incorrect module ownership
- circular responsibilities
- infrastructure leaking into domain modules

---

# 6. System Layer Architecture

Establish the authoritative layer model.

At minimum evaluate:

HTTP/API layer
↓
Application/business services
↓
Domain logic
↓
Persistence/infrastructure

Verify the existing rule:

- Controllers do not directly access Prisma.
- Business logic lives in services/domain components.
- HTTP concerns remain at the HTTP boundary.
- Shared infrastructure is reused.

Identify violations.

---

# 7. Business Flow Architecture

Map the primary business flows:

## Student

registration
→ verification/approval
→ student profile
→ class enrollment
→ schedule
→ attendance
→ tuition
→ payment

## Parent

parent account
→ verified student relationship
→ student information
→ attendance/tuition/exam access

## Training

class
→ schedule
→ enrollment
→ attendance session
→ attendance record

## Belt examination

belt rank
→ exam
→ registration
→ payment
→ result
→ belt promotion

## Billing

invoice
→ payment initiation
→ QR
→ webhook/payment confirmation
→ settlement
→ report

For every flow determine:

- owning module
- database entities
- authorization
- transaction boundary
- audit requirement
- historical-data requirement

---

# 8. Thesis Scope Control

Classify every current feature:

- REQUIRED FOR THESIS
- STRONGLY JUSTIFIED EXTENSION
- PRODUCTION HARDENING
- BACKLOG / OPTIONAL

Do not remove production-hardening functionality automatically.

The purpose is to distinguish:

1. what the thesis is fundamentally about
2. what improves real-world quality
3. what is outside the thesis core

---

# 9. Architecture Decision Rules

For every proposed architectural change:

- provide evidence
- identify affected modules
- identify affected APIs
- identify affected database entities
- identify migration impact
- identify test impact
- identify deployment impact

Never propose a rewrite based only on stylistic preference.

---

# 10. Required Deliverable

Create or update:

`docs/SYSTEM_ARCHITECTURE_BASELINE.md`

The document must contain:

## A. System purpose

## B. Actors

## C. Domain boundaries

## D. Application architecture

## E. Module responsibility matrix

## F. Business flow ownership

## G. Authorization boundary

## H. Data ownership boundary

## I. External integration boundary

## J. Thesis scope vs production hardening

## K. Current architecture findings

## L. Approved architecture decisions

## M. Deferred architecture decisions

---

# 11. Implementation Rule

This task may modify documentation only.

Do NOT:

- rewrite modules
- change roles
- modify Prisma schema
- create migrations
- change endpoints
- add new business features

A critical defect that prevents the baseline from being established may be fixed only with the minimum necessary change and regression evidence.

---

# 12. Acceptance Criteria

- Current architecture is documented from repository evidence.
- Thesis requirements are mapped to system components.
- Actor/role mismatches are explicitly identified.
- Module responsibilities are explicit.
- Core business flows have owners.
- Thesis scope and production-hardening scope are separated.
- Existing architecture is either approved or specific justified changes are listed.
- No unsupported claim is made.
- No implementation change is made without evidence.

---

# 13. Required Closing Output

RESULT:
<COMPLETE or BLOCKED>

ARCHITECTURE VERDICT:
<KEEP / KEEP WITH TARGETED CHANGES / MAJOR REDESIGN>

THESIS ALIGNMENT:
<summary>

ROLE MODEL:
<summary>

DOMAIN MODEL:
<summary>

FILES CHANGED:
<files>

CODE CHANGES:
<none unless critical defect>

DATABASE CHANGES:
<none>

API CHANGES:
<none>

REMAINING RISKS:
<risks>

NEXT ELIGIBLE TASK:
<TASK-02 or repair task>

STOP.