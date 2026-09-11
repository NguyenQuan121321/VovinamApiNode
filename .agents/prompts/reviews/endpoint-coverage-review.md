# Endpoint Coverage Review

Compare controllers, OpenAPI operations, E2E tests, and security tests; identify uncovered endpoints and important uncovered failure states.

## Steps

1. Enumerate controllers and their routes from the source tree.
2. Extract all OpenAPI operations from the current `openapi.json` (path x method).
3. Cross-check: every controller route present in OpenAPI; every OpenAPI operation backed by a controller. Divergence in either direction is a finding (stale contract or undocumented route).
4. Map each operation to its test coverage: which E2E/security spec exercises it, and what failure states are covered.
5. Identify uncovered operations and uncovered failure states that matter: authorization failures (401/403), ownership violations (uniform 404), validation failures (400), conflicts (409), and idempotency/anti-enumeration cases for sensitive endpoints.
6. Add tests for all required uncovered operations and for the important uncovered failure states of sensitive endpoints (auth, students, payments, admin).
7. Regenerate OpenAPI if implementation changed, then run `npm run contract:lint` and the relevant test suites.

## Completion

Completion requires a documented coverage result based on the current contract, not an old count: a table of total operations vs. covered vs. intentionally uncovered (with the reason each exclusion is acceptable). Report real test counts and gate output.

## Rules

- A missing negative/authorization test on a sensitive endpoint is a gap even when the happy path is covered.
- Do not hit real external providers in tests; use the existing fakes/ports.
- Do not weaken existing tests to make coverage arithmetic simpler.
