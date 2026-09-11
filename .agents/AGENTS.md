# VovinamApiNode — Agent Entry Point

You are an AI coding agent working in an existing, production-oriented backend for a legally registered Vovinam club. The system manages students (including minors), parents, instructors, classes, attendance, belt ranks, exams, personal data, invoices, and real payments.

This file is the entry point. It defines how you work. The linked prompts define what you do.

## Mandatory session workflow

Every coding session MUST follow these steps in order:

1. Read the global engineering contract: `.agents/prompts/00-global-contract.md`.
2. Read the orchestration prompt: `.agents/prompts/01-prompt-launcher.md`.
3. Read the project plan (`docs/PLAN.md`) and the progress record (`IMPLEMENTATION_PROGRESS.md`).
4. Inspect Git (status, current branch, recent history), the source tree, Prisma schema and migrations, `openapi.json`, CI configuration, and the existing tests before writing any code.
5. Determine the actual project state from that evidence. Documentation can be stale; code, migrations, and Git history are not.
6. Select exactly ONE eligible task from `.agents/prompts/tasks/`, as directed by the Launcher.
7. Execute only that task.
8. Run the required verification (gates, tests, contract checks) and keep the actual command output as evidence.
9. Update `IMPLEMENTATION_PROGRESS.md` (and task-specific documentation) with verified facts only.
10. Stop after the selected task is complete. Do not start another task.

## Non-negotiable rules

- Prompts and task instructions are written in English.
- Code is clean, strongly typed TypeScript following the existing NestJS module conventions.
- The existing modular-monolith architecture is preserved: Controllers never access Prisma directly; business rules live in services; shared guards, DTOs, serializers, filters, audit, and configuration are reused, not duplicated.
- Swagger/OpenAPI is mandatory for every public API change: run `npm run openapi:generate` and `npm run contract:lint` in the same change.
- Tests are mandatory for every functional or security change. Security-relevant behavior requires a regression test.
- Financial integrity is mandatory: server-derived amounts, idempotent payment processing, auditable financial events, no hard deletion of financial records.
- Personal and minor data requires strict access control: ownership guard on every student-scoped route, role-based field serialization, no sensitive data in logs or error messages.
- Legal compliance must not be falsely claimed. Legal and accounting questions are marked for human verification, never asserted as satisfied by code.
- DDoS protection must distinguish application-layer protection (rate limiting, throttling, input controls) from infrastructure-layer mitigation (CDN/WAF/network layer). Never claim that NestJS middleware alone stops volumetric DDoS attacks.
- No unnecessary microservices, Redis, message queues, or new infrastructure. The stack is NestJS 11 + Prisma + PostgreSQL with in-process workers (docs/PLAN.md, section 3).
- No blind rewrites of working modules. Changes require evidence of a defect or a verified gap.
- No unrelated refactors inside a task.
- No fabricated test results. Report failures and skipped work honestly.

## Source-of-truth priority

When sources disagree, prefer:

1. Current source code
2. Current Prisma schema and migrations
3. Git history
4. Current tests and CI configuration/results
5. Current OpenAPI contract (`openapi.json`)
6. `IMPLEMENTATION_PROGRESS.md`
7. `docs/PLAN.md`
8. Older planning documents

Never invent status, test results, security guarantees, or legal conclusions.

## Workflow file map

- `.agents/prompts/00-global-contract.md` — immutable engineering rules (always in force)
- `.agents/prompts/01-prompt-launcher.md` — state reconciliation and single-task selection
- `.agents/prompts/tasks/` — the only executable task prompts (00–06)
- `.agents/prompts/reviews/` — focused review prompts, run only when the selected task calls for one
- `.agents/state/` — reserved for supplementary execution state (see its README)

Do not create additional prompts or rename these files.

## Completion rule

A task is complete only when its acceptance criteria are satisfied and the relevant quality/security gates pass with real evidence.

A green build alone does not mean production readiness, and code existence alone does not mean a phase is complete.

When the selected task is done and progress is updated, stop.
