# VovinamApiNode

Backend API for a legally registered Vovinam club: students (including minors), parents, instructors, classes and schedules, attendance, belt ranks and exams, tuition billing (QR gateway + cash), notifications, and data-processing consent.

- **Stack:** NestJS 11 + Prisma + PostgreSQL 16, in-process outbox, no Redis (plan section 3)
- **Spec:** [`docs/PLAN.md`](docs/PLAN.md) is the single source of truth; the approved baselines in `docs/` (architecture, database, API) reconcile it against the code
- **Status:** P0–P5 phases and the reconciliation/hardening tasks (TASK-00…TASK-05) are merged; see [`docs/FINAL_QA_REPORT.md`](docs/FINAL_QA_REPORT.md) and [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md)

## Quickstart (local)

Prerequisites: Node >= 22, Docker (for Postgres only).

```bash
cp .env.example .env          # defaults match docker-compose.yml
docker compose up -d db
npm install
npx prisma migrate dev
npm run seed                  # belt ranks + first admin (ADMIN_EMAIL/ADMIN_PASSWORD)
npm run start:dev
```

- Liveness: `GET /healthz` — readiness (DB ping): `GET /readyz`
- Metrics (bearer `METRICS_TOKEN`): `GET /metrics`
- Swagger UI: set `SWAGGER_ENABLED=true`, then `GET /docs` (JSON: `/docs-json`)
- All business routes live under `/api/v1` and respond with the envelope `{"code","message","data"}`

> npm 11 blocks dependency install scripts by default. If `prisma generate` did not run:
> `npm install-scripts approve prisma @prisma/client @prisma/engines && npm rebuild prisma @prisma/client @prisma/engines`

## Quality gates

```bash
npm run lint        # eslint (typescript-eslint, zero warnings)
npm run format:check
npm run typecheck   # tsc --noEmit (strict)
npm test            # unit tests (jest)
npm run test:e2e    # supertest e2e; needs DATABASE_URL pointing at a migrated Postgres
npm run build       # nest build
```

CI (`.github/workflows/ci.yml`): lint, build-test (coverage floor 75% on auth/billing/classes), migration-dry-run (apply to empty Postgres, assert tables, replay), integration (e2e), `npm audit --audit-level=high`, docker build, deploy-gate (Render hook on main, stubbed until configured).

## Migrations

Committed SQL under `prisma/migrations/`. Apply with `prisma migrate dev` locally and `prisma migrate deploy` in CI/production; never `prisma db push` outside throwaway dev databases.
