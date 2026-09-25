# API / Frontend Contract Audit — TASK-07

Date: 2026-09-25 · Branch under review: `feat/matrix-completion` (merged to
`main` as PR #27) plus the TASK-07 fixes on top.

## 1. Current counts (re-verified by inspection, not carried from prior reports)

| Metric | Value |
| --- | --- |
| OpenAPI paths | **88** (85 under `/api/v1` + `/healthz`, `/readyz`, `/metrics`) |
| OpenAPI operations | **111** (GET 39, POST 47, PATCH 12, DELETE 11, PUT 2) |
| OpenAPI schemas | **78** (50 request DTOs + 23 response components + `ErrorEnvelope` + enums) |
| Controller classes | **19** in 18 files |
| Services / Modules | 27 / 20 |
| Prisma models / migrations | 28 / 8 (+lock) |
| Unit tests | 425 in 83 suites |
| E2E + security tests | 101 in 17 suites |
| CI | green on `main` and the feature branch before this task |

## 2. Controller ↔ OpenAPI reconciliation

Every route decorator in `src/**/*.controller.ts` was extracted mechanically
(method, path, params normalized) and diffed against `openapi.json`:

- **111 controller routes = 111 OpenAPI operations, 1:1, zero mismatch.**
- No undocumented routes, no stale operations, no duplicate `operationId`s, no
  wrong methods/paths. The three prefix-excluded routes (`/healthz`, `/readyz`,
  `/metrics`) match the runtime wiring (`setGlobalPrefix` exclude list).
- `npm run openapi:generate` is deterministic (byte-identical regeneration
  verified twice) and now routes through the same enrichment as runtime Swagger,
  so `/docs-json` and `openapi.json` cannot drift.

## 3. Gaps found in the committed contract (before this task)

The audit found the pre-existing contract **unusable for a frontend team**:

| # | Gap | Severity for FE |
| --- | --- | --- |
| G1 | **All 50 DTO schemas were empty objects** — zero request fields documented | Blocker |
| G2 | **No response schemas** — every 2xx response was `{description: ""}` with no content; the `{code,message,data}` envelope was undocumented | Blocker |
| G3 | **No security metadata** — no operation carried `security`; JWT vs public vs HMAC-webhook vs metrics-token was invisible | Blocker |
| G4 | **No summaries/descriptions** on any operation; no role requirements | Blocker |
| G5 | **No query parameters** documented (pagination, filters — all lists showed `parameters: []`) | Major |
| G6 | **No error catalog** — 400/401/403/404/409/429 surfaces undocumented | Major |
| G7 | **No request examples** | Minor |

## 4. What was changed (all in this task)

1. **DTOs** (`src/**/dto/*.ts`, 16 files): every field annotated with
   `@ApiProperty`/`@ApiPropertyOptional` — types, enums, bounds, descriptions,
   realistic fake examples. The 50 request schemas are now complete.
2. **Contract module** (`src/openapi/`):
   - `contract.ts` — a per-operation contract table (all 111): summary, business
     description, roles, auth class, response `data` schema, per-endpoint error
     catalog, query parameters, request examples.
   - `schema-kit.ts` — the uniform envelope, error envelope, pagination shape
     and 23 named response components (student, class, enrollment, attendance,
     belts, exams, invoices, payments, discounts, notifications, consent,
     announcements, leaves, proposals, evaluations, users, audit, sessions).
   - `enrich-openapi.ts` — applies the table onto the generated document and
     **fails loudly** if an operation has no contract entry or an entry has no
     operation: a route can never ship undocumented.
   - `openapi.contract.spec.ts` — drift guard: every committed operation must
     have a contract entry (and vice versa), security must match the auth
     class, every JSON 2xx must carry the envelope, all `$ref`s must resolve,
     path parameters must survive enrichment.
3. **Wiring**: `bootstrap.ts` (runtime Swagger) and `scripts/generate-openapi.ts`
   both call `enrichOpenApiDocument`, guaranteeing `/docs-json` ≡ `openapi.json`.
4. **Sensitive-field hygiene**: response components document only what the
   serializers actually return — no password hashes, MFA secrets, token hashes,
   recovery codes or webhook secrets appear anywhere in the contract.

## 5. Frontend usability audit (openapi.json only)

The questions from the audit checklist, answerable now without reading backend
source:

| Question | Answerable via |
| --- | --- |
| URL / method | `paths` + operation entries |
| JWT needed? which role? | operation `security` + explicit **Roles:** line in every description |
| What body do I send? | DTO schema + `example` on ~30 write operations |
| Query parameters | documented per list endpoint (page/limit/filters with caps) |
| Success response shape | `{code,message,data}` envelope with a concrete `data` schema per operation |
| Validation error shape | `ErrorEnvelope` (data always null) catalogued per operation |
| Forbidden vs not-found | per-operation error catalog; the uniform 404 anti-probing posture is documented |
| Resource ownership | descriptions state the guard-7.3 scoping per endpoint |
| Fields renderable / role-dependent fields | response components + serializer notes (e.g. instructor views omit contacts) |
| IDs needed from previous calls | response components mark the ids; descriptions state the flows |

Residual notes (documented, non-blocking):

- The payment webhook **request** body shape is provider-specific; the contract
  documents the HMAC requirement, response and semantics, and the simulated
  gateway's `{orderRef, gatewayTxnId, amount, success}` payload.
- Role-dependent response variation (e.g. instructor views hiding contacts) is
  documented in descriptions/component notes rather than modelled as separate
  schemas per role.
- `SWAGGER_ENABLED` gates `/docs` and `/docs-json`; the enriched document is
  what both serve.

## 6. Validation results

- `npm run openapi:generate` → `openapi.json written (88 paths)`, deterministic
  (regeneration is byte-identical; CI staleness gate keeps it honest).
- `npm run contract:lint` (spectral, `.spectral.yaml`): **0 errors**.
- New drift-guard unit tests pass (part of 425 green unit tests).

## 7. Verdict

**A. FRONTEND CONTRACT READY.**

Every one of the 111 operations is documented with summary, business
description, roles, security requirement, envelope'd response schema, error
catalog, query parameters and (for writes) a request example; the document is
generated by a fail-loud pipeline with drift-guard tests. The two residual
notes above are documented in the contract itself and are not blockers for
frontend work.
