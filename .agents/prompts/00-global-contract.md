# Global Engineering Contract

These rules are immutable for every task in this repository. They contain rules only — no roadmap, no task sequencing. Task selection is the Launcher's job (`.agents/prompts/01-prompt-launcher.md`).

You are modifying an existing repository, not creating a greenfield system.

## 1. Architectural rules

- Stack is fixed: Node.js 22 LTS, TypeScript (strict), NestJS 11 (Express adapter), Prisma 6, PostgreSQL, REST under `/api/v1`. Modular monolith.
- Controllers never access Prisma directly; they parse HTTP input and delegate to services.
- Services never import HTTP-layer classes (guards, controllers, interceptors).
- Business rules live in services/domain components; HTTP concerns stay at the HTTP boundary.
- Shared infrastructure (`src/common`, `src/config`, `src/prisma`, `src/logging`) is reused, never duplicated per module.
- Database integrity is enforced by both application logic and database constraints (unique keys, FK behavior) where appropriate.
- No new infrastructure components (Redis, external message brokers, extra services) without measured necessity documented in the task; the default is in-process workers behind interfaces.

## 2. Clean-code rules

- Strong typing everywhere: no `any`, no non-null assertions to silence the compiler, no `@ts-ignore` without a written justification in the same change.
- Follow the naming, DTO, serializer, error-mapping, and file-placement conventions already established in neighboring modules.
- Comments state constraints the code cannot express; they never narrate obvious steps.
- Dead code is removed in the same change that makes it dead; no commented-out code blocks.
- Every feature module that uses `JwtAuthGuard` imports `AuthModule` (boot failure otherwise).

## 3. Testing rules

- Tests are mandatory for every functional or security change. Bug fixes add a regression test that fails without the fix.
- Security-relevant behavior (authorization, ownership, idempotency, anti-enumeration, webhook integrity) requires an explicit test case.
- Every new module ships with unit specs; otherwise the jest global coverage bucket drops below the CI floor.
- Run the relevant subset of the quality gates and report the real output:
  - `npm run format:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test` (unit, with coverage thresholds)
  - `npm run test:e2e` (needs a migrated Postgres)
  - `npm run build`
- Any response-status, route-shape, or DTO change requires `npm run openapi:generate` in the same commit (the contract-gate fails otherwise).
- Never fabricate, estimate, or paraphrase test results. Failures are reported verbatim or summarized faithfully, including when nothing was run.
- Never disable, skip, or weaken an existing test to make a change pass; change behavior or fix the test with a stated reason.

## 4. API contract rules

- Preserve `/api/v1`, the response envelope `{"code","message","data"}`, global pagination (`?page=1&limit=20`, limit capped at 100), the uniform error envelope, and the uniform-401/404 postures (anti-enumeration, anti-IDOR disclosure).
- Student-scoped routes go through the ownership guard (plan section 7.3): violation answers 404, not 403.
- Every public route change updates Swagger decorators and the committed `openapi.json` (`npm run openapi:generate`, then `npm run contract:lint`).
- Errors are short and never disclose internal conditions; details go to logs.

## 5. Security rules

- Preserve and verify: authentication, role authorization, object-ownership/IDOR protection, anti-enumeration, password policy, refresh-token rotation with reuse detection, MFA, rate limiting, secure headers, fail-fast validated configuration, and audit logging.
- Authorization is enforced server-side on every route; client-side checks are UX only.
- New endpoints get explicit role restrictions via the existing guards/decorators, not implicit defaults.
- Security findings are classified P0 (release blocker), P1 (high), P2 (medium), P3 (low) and P0/P1 technical findings are fixed within the task that finds them, with regression tests.

## 6. Database rules

- Schema changes go through versioned Prisma migrations committed to the repo. Never `prisma db push` outside throwaway dev databases; production applies `prisma migrate deploy`.
- Never modify an already-applied migration; add a new one.
- Financial tables (invoices, invoice_items, payment_transactions) use FK RESTRICT on the financial chain and are never hard-deleted; users and student profiles are soft-deleted (`deleted_at`).
- Idempotent operations are backed by database unique constraints, not only by application checks.
- Every migration is verified against an empty database (the CI migration-dry-run asserts the table list).

## 7. Personal-data handling

- Student/minor identity data, addresses, phone numbers, emergency contacts, medical notes, attendance history, payment history, IP addresses, authentication data, and audit records are sensitive.
- Collect, expose, log, retain, export, and notify with the minimum data required for the use case.
- Field exposure follows the role serializer matrix (plan section 7.4); do not add new exposure paths without updating that matrix and its tests.
- Personal data never appears in logs, error messages, URLs, or analytics.

## 8. Secret handling

- Secrets live only in platform environment variables or local `.env` files; `.env` files are gitignored and never committed.
- Required environment variables are validated fail-fast at boot (joi); missing variables block startup.
- Never hardcode, echo, or log secrets, tokens, passwords, keys, or webhook signatures. Log redaction stays in place.
- Never fabricate credentials (gateway keys, OA tokens) to make code paths pass; unconfigured providers fail fast with explicit messages.
- Placeholder values in `.env.example` are clearly fake and never functional.

## 9. Git safety rules

- Inspect branch and status before editing. Work only on the intended branch.
- Never silently reset, stash-drop, or discard user work, including uncommitted changes you did not make.
- Never rewrite or amend published history unless explicitly instructed.
- Commits follow Conventional Commits with a scope from `commitlint.config.js`; keep each commit focused on its task.
- Never commit: `.env`, build output, coverage reports, secrets, or unrelated files.

## 10. Performance measurement rules

- No performance change without a measured baseline first (throughput, p50/p95/p99, error rate, DB connections, slow queries, CPU/memory as applicable).
- Load work uses the existing k6/load tooling; there are no invented "enterprise" targets.
- The loop is: measure baseline -> identify bottleneck with evidence -> fix -> remeasure -> report both numbers.
- N+1 queries, unbounded list queries, and missing pagination are defects found by inspection, fixed with tests, and verified against the baseline.

## 11. Legal verification rules

- Never rely on an old plan citation as the current legal baseline. When law affects implementation, verify the currently effective Vietnamese legal framework (personal data protection, children's rights, accounting/invoicing, payment collection) before coding.
- Distinguish always: (a) technical implementation, (b) organizational/business process, (c) legal requirement, (d) accounting/tax requirement, (e) unresolved item.
- The software is not the legal authority. Compliance claims require named, dated human/legal/accounting verification; otherwise mark the item as requiring verification.
- Do not claim "secure", "compliant", or "production ready" without evidence.

## 12. Production safety rules

- Fail fast on invalid configuration; never default secrets.
- Health (`/healthz`), readiness (`/readyz`), and metrics (`/metrics`, bearer-only) postures are preserved.
- Swagger stays disabled in production (or hardened with CSP when explicitly enabled).
- Graceful shutdown, request timeouts, and DB connection handling must not regress.
- Backups, restore procedures, RPO/RTO claims, and rollback steps are documented only with demonstrated or provider-verified evidence.
- Infrastructure-layer protections (TLS termination, WAF/CDN, DDoS mitigation, HSTS at the proxy) are documented as provider responsibilities, separate from application code.

## 13. DDoS boundary

- Application-layer controls (throttling, per-account budgets, payload caps) mitigate abuse and resource exhaustion only.
- They do not constitute protection against large volumetric or network-layer DDoS attacks; that requires infrastructure-layer mitigation at the hosting/CDN/network level.
- Documentation must keep these two layers separate and must never claim that NestJS middleware alone provides full DDoS protection.

## 14. Prohibited actions

- No blind rewrites of working modules.
- No unrelated refactors while implementing a task.
- No new features outside the selected task's scope.
- No fabricated credentials, test results, security guarantees, or legal claims.
- No weakening of existing security controls without an explicit, documented, evidence-backed reason.
