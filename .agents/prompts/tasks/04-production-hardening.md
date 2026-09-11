# TASK-04 — Production Hardening

## Objective

Make the deployment path operationally safe without inventing infrastructure capabilities. Harden what exists (Dockerfile, docker-compose, CI, health/metrics endpoints already exist — verify before changing).

## Scope — review and harden

- Docker: multi-stage, non-root runtime user, pinned base image, `node --enable-source-maps dist/main.js`, minimal production dependency set
- secrets: platform-env only; fail-fast validation of every required variable in release mode; no secret in image layers or logs
- production configuration: release-mode guards (e.g., missing `METRICS_TOKEN`, `APP_ENCRYPTION_KEY` fail the boot; Swagger off)
- reverse proxy / CDN / WAF considerations: TLS termination, HSTS at the proxy, trusted-proxy configuration for client IP resolution, and origin protection so the app is not reachable bypassing the proxy
- TLS: terminated/documented at the infrastructure layer with the intended grade; the app enforces nothing less than what the proxy delivers
- health checks: `/healthz` (liveness) and `/readyz` (DB ping) correct semantics for the platform
- graceful shutdown: signal handling, in-flight request draining, open handles closed (intervals unref'd, DB disconnected)
- request timeouts and body limits preserved (1 MB cap)
- external provider failure handling: mail/gateway/ZNS outages degrade without crashing the process
- database connections: pool sizing, connection limits, behavior on DB loss and recovery
- monitoring: `/metrics` bearer-only (prom-client), log-based signals via pino JSON with request IDs
- logging: request IDs on every request; secret-shaped fields redacted
- alerts: uptime probing of `/healthz` and an alert path the admin actually receives (documented with the chosen provider)
- backups: managed-PITR expectations plus an offsite dump procedure — verify provider capabilities before documenting them
- restore: a scripted, actually executed restore drill with evidence
- incident runbook: log inspection, restart, restore, JWT secret rotation, webhook-mismatch handling, gateway outage fallback
- deployment rollback: a documented, tested procedure (previous image/tag redeploy) with the triggers that call for it

## DDoS boundary (mandatory wording)

Document two separate layers:

1. Application-layer resource-abuse controls (rate limiting, budgets, payload caps) — what the app can do.
2. Provider/CDN/WAF/network-layer DDoS mitigation — what the infrastructure must do.

Never state that NestJS middleware stops volumetric DDoS attacks.

## Backup and recovery honesty

- Verify actual provider capabilities (PITR window, dump tooling) before documenting them; if unknown, mark as "to verify with provider" instead of asserting.
- RPO/RTO must be measured or demonstrated, not aspirational. State RPO/RTO as observed from an executed drill, including the drill date and steps, or explicitly as undemonstrated.

## Required evidence

- production configuration validation (release-mode boot against a staging-like environment)
- backup verification and a successful restore drill with recorded steps/duration
- health/readiness verification
- secret redaction verification (no secret-shaped field in logs)
- graceful shutdown test (SIGTERM -> clean exit, no lost in-flight writes)
- external dependency failure behavior documented from an actual simulation where feasible

## Deliverables

- `docs/OPERATIONS.md` runbook (restart, restore, rotation, webhook mismatch, rollback)
- `docs/BACKUP_RECOVERY.md` (or a section in the runbook) with the drill evidence
- any infrastructure scripts under `scripts/` (e.g., restore drill)

## Acceptance criteria

1. A realistic staging deployment can be operated, monitored, recovered, and rolled back using only the documented procedures.
2. No production secret is committed, logged, or baked into an image.
3. RPO/RTO statements are backed by drill evidence or explicitly marked undemonstrated.
4. All relevant quality gates pass with real output.
