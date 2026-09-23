Based on the completed current-state audit, redesign the SYSTEM BASELINE of VovinamApiNode.

DO NOT IMPLEMENT CODE.

The objective is to establish the authoritative business/domain model for the thesis.

Define:

1. SYSTEM PURPOSE

Describe exactly what VovinamApiNode is responsible for.

2. ACTORS

Define the authoritative actors.

For each actor:
- responsibility
- allowed data
- allowed operations
- excluded operations

3. CORE BUSINESS DOMAINS

Identify only domains justified by the thesis:

- student management
- class/training management
- schedules
- attendance
- belt/rank management
- belt exams
- tuition
- payment
- notifications
- parent/student relationship if justified
- audit/security infrastructure

Classify each as:
CORE / SUPPORTING / OPTIONAL / OUT-OF-SCOPE

4. CORE BUSINESS FLOWS

Define canonical workflows:

- student registration
- student approval
- joining a class
- class scheduling
- attendance
- tuition generation
- QR payment
- payment confirmation
- belt exam registration
- exam result
- belt promotion
- notification

5. BUSINESS INVARIANTS

For each workflow define:
- what must always be true
- what can never happen
- what requires transaction atomicity
- what requires idempotency
- what is historical data

6. SCOPE CONTROL

Separate:
MUST HAVE FOR THESIS
GOOD EXTENSION
PRODUCTION HARDENING
BACKLOG

IMPORTANT:
Do not optimize for "enterprise complexity".
Optimize for:
- correctness
- maintainability
- demonstrable architecture
- thesis traceability
- realistic club usage

7. OUTPUT

Produce a canonical SYSTEM BASELINE document.

This document becomes the business source of truth for future database/API/implementation work.