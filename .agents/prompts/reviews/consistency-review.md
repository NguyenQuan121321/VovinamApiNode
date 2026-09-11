# Consistency Review

Review the repository for cross-module consistency. Fix only evidence-based inconsistencies; do not introduce architectural rewrites without evidence of a defect.

## Checklist

- module conventions: file layout, provider wiring, module imports (e.g., `AuthModule` wherever `JwtAuthGuard` is used)
- naming: classes, services, DTOs, methods, audit events
- DTO conventions: naming, validation decorators, whitelist/forbidNonWhitelisted behavior, shared `PageDto` reuse
- error handling: exception filter paths, Prisma error mapping (e.g., P2002 -> 409, P2023 -> 404 posture), message discipline
- response envelopes: `{"code","message","data"}` everywhere, no bare payloads
- pagination: `?page=&limit=` with the limit<=100 cap and `{items,total,page,limit}` shape on every list endpoint
- serializers: role-based serializers in their own file + spec; static shape serializers inline — placement consistent
- guards: decorator/role usage, ownership-guard application on every student-scoped route
- service boundaries: controllers free of Prisma, services free of HTTP-layer imports
- database access patterns: Prisma query style, transaction usage, soft-delete filters on default queries
- API status codes: 200 for action-style POSTs, 201 for creations, 409 for conflicts, uniform 401/404 postures
- OpenAPI consistency: decorators complete, operationIds unique, `openapi.json` matching the code

## Method

Compare neighboring modules (e.g., students vs. parents vs. classes) and identify meaningful divergence — not stylistic noise. For each finding: cite both diverging locations, name the established convention, and state the evidence that it is the convention.

## Rules

- Fix only inconsistencies that are demonstrably divergent from the established convention.
- Add or update regression tests for behavior-level fixes (status codes, envelopes, guards). Formatting-only alignments need no new tests.
- If a "fix" would require redesigning a module, stop and report it as a finding instead.

## Completion

Run the relevant quality gates (format, lint, typecheck, unit, contract gate when OpenAPI-affecting) and report real output. Summarize findings fixed vs. reported-only.
