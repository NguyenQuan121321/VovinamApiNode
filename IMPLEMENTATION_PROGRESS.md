# VovinamApiNode — Implementation Progress

Single source of truth for cross-session handoff (see the execution prompt and `docs/PLAN.md`).
Read this file and `git log` before writing any code. Update it after every completed task or before stopping.

Current status: **P0 bootstrap COMPLETE on branch `phase/0-bootstrap` (awaiting PR + CI + merge).**

## Phase task table

| Phase | Task | Status | Notes / evidence |
|---|---|---|---|
| P0 | Read plan v3, confirm repo state | DONE | Repo had zero commits; remote `origin` empty |
| P0 | Repo baseline (.gitignore, .env.example, docs/PLAN.md, this file) | DONE | Commit `chore: add repository baseline...` |
| P0 | Tooling baseline (package.json, tsconfig strict, eslint flat + prettier, jest w/ 75% floor) | DONE | npm install OK; npm 11 blocked dep lifecycle scripts → approved `prisma @prisma/client @prisma/engines`, denied `@scarf/scarf` |
| P0 | Prisma schema + initial migration + seed script | DONE | 9 tables (users, sessions, refresh_tokens, totp_credentials, recovery_codes, used_tokens, audit_logs, app_settings, belt_ranks); migration generated via `prisma migrate diff` (Docker daemon down locally — CI migration-dry-run validates on real Postgres); seed: 15 belt ranks + first admin, idempotent upserts `update: {}` |
| P0 | Config: joi fail-fast env validation + typed EnvService | DONE | Production requires APP_ENCRYPTION_KEY (64-hex) + METRICS_TOKEN (min 16) |
| P0 | Logging: pino factory + Nest LoggerService bridge, redaction | DONE | Manual pino, NOT nestjs-pino (peer-dep risk) |
| P0 | Common: envelope, exception filter, request-id, request-logging, SharedStore, constantTimeEquals | DONE | Each with unit specs |
| P0 | Health: /healthz, /readyz, /metrics bearer-only + Prometheus middleware/registry | DONE | Metrics skip-envelope; 404 when no token configured; route-label cardinality control |
| P0 | App bootstrap: helmet (Swagger-aware CSP), CORS allowlist, 1 MB cap, validation pipe, global prefix /api/v1, Swagger gated | DONE | `createApp()` shared by main.ts AND e2e |
| P0 | Stub modules auth/billing/classes (bind coverage floor) | DONE | Marked with their real phase (P1/P4/P2) |
| P0 | E2E specs (health/ops/metrics/404/413 + swagger) | WRITTEN, NOT RUN LOCALLY | Docker daemon down all session; CI `integration` job runs them on Postgres 16 service — **verify on the PR before merge** |
| P0 | Dockerfile (multi-stage non-root) + docker-compose (Postgres only) + .dockerignore | DONE | `node:22-alpine`, non-root `app` user, `node --enable-source-maps dist/main.js` |
| P0 | CI per plan 11.3 | DONE | 7 jobs: lint, build-test (coverage), migration-dry-run (deploy + assert 10 tables incl. _prisma_migrations + reset/replay), integration (e2e), audit, docker, deploy-gate (Render hook stub on main); Dependabot weekly |
| P0 | Local gates green | DONE | format:check ✓, lint ✓ (max-warnings 0), typecheck ✓, 50/50 unit tests ✓ coverage 98.58% global / 100% auth+billing+classes, build ✓ |
| P0 | Push branch + PR to main | DONE (push) / PENDING (PR) | `main` created on remote from baseline commit; **`gh` NOT authenticated — PR must be opened manually** (URL in handoff log) |
| P1–P7 | — | NOT STARTED | See docs/PLAN.md section 13 |

## Handoff log

### 2026-09-05 — Session 3: P0 finished, pushed, PR pending manual open
- Continued from the session-2 handoff below; wrote all remaining source per the locked design decisions (no re-derivation).
- Fixed 3 wrong TEST expectations (implementation was correct): SharedStore fixed-window anchoring (window anchored at first increment — required by P1 lockout/TOTP bucket), module-destroy sweep assertion via internal map (get() expires lazily), prom-client emits HELP/TYPE even with zero observations (assert no `_bucket{` samples instead).
- Typecheck fixes along the way: APP_FILTER/APP_INTERCEPTOR import from `@nestjs/core` (not common); helmet CSP needs `{ directives: ... }` wrapper; exported SharedStoreEntry for specs.
- Local gate evidence: `npm run format:check` ✓, `npm run lint` ✓, `npm run typecheck` ✓, `npm test -- --coverage` → 18 suites / 50 tests passed, global 98.58%, per-dir floors met, `npm run build` ✓.
- E2E NOT run locally (Docker daemon never came up despite launch attempt) — CI integration job is the authoritative check; if it fails on the PR, fix before merge.
- Remote `main` created by pushing the baseline commit; branch `phase/0-bootstrap` pushed on top.
- **PR must be opened manually** (gh CLI unauthenticated): https://github.com/NguyenQuan121321/VovinamApiNode/compare/main...phase/0-bootstrap
  PR body: scope = P0 deliverables above; AC checklist = plan section 13 P0 row (CI green all jobs; migrate up/down in CI; Swagger reachable locally with SWAGGER_ENABLED=true).
- Next step after merge: `git checkout main && git pull`, tag `v0.1.0` optional, start P1 Auth (`phase/1-auth`) per plan section 5 — all auth tables/infrastructure (SharedStore, JWT config, used_tokens, audit_logs) already exist.

### 2026-09-05 — Session 2 (GLM-5.3-Flash) STOPPED mid-scaffold, handed over
Stopped after config + logging were written; design decisions and remaining steps were recorded here and followed exactly by session 3. Key locked decisions: manual pino (no nestjs-pino), envelope via ResponseInterceptor + SkipEnvelope for /metrics, /healthz//readyz//metrics outside the /api/v1 prefix, createApp() shared by main+e2e, @Global AppConfig/Prisma modules, coverage stubs for auth/billing/classes, idempotent seed.

### 2026-09-05 — Session 1: P0 started
- Read plan v3 (committed as `docs/PLAN.md`); repo confirmed empty.
- Environment: Windows + Git Bash, Node v24.20.0 (engines >=22), npm 11.19.0, Docker CLI present but daemon down, `gh` 2.98.0 NOT authenticated.
- Security constraints locked in: strict TS no `any`, envelope everywhere, 404-not-403 ownership guard (P2), webhook HMAC + idempotency (P4), nothing from the "Do NOT build" list.
