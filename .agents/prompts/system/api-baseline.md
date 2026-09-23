Using the approved:

- SYSTEM BASELINE
- AUTHORIZATION BASELINE
- DATABASE ARCHITECTURE

audit the current REST API.

DO NOT IMPLEMENT.

Map:

USE CASE
→ ACTOR
→ PERMISSION
→ SERVICE
→ DATABASE
→ ENDPOINT

For every endpoint determine:

- purpose
- actor
- authorization rule
- ownership rule
- input
- output
- error behavior
- idempotency
- transaction requirement
- audit requirement

Identify:

- missing endpoints
- unnecessary endpoints
- duplicated endpoints
- endpoints violating business rules
- endpoints exposing excessive data
- inconsistent response semantics

Keep the existing /api/v1 contract conventions unless evidence requires change.

Produce the canonical API inventory.

No code changes.
No OpenAPI modifications yet.