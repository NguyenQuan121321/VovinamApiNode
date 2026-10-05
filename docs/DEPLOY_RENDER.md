# Render deployment

The current deployment is a thesis staging target. Deploying repaired code does not establish live email delivery, payment-provider approval, production backups or authenticated acceptance. Record those checks separately in `BACKEND_REMEDIATION.md`.

## Runtime and migrations

Use the repository Dockerfile for the API and a managed PostgreSQL database. Keep database access restricted to the API and authorized operators. Restrict Render external database access explicitly; do not assume a managed database has no public connection path.

The non-root Docker entrypoint runs `prisma migrate deploy` before starting the API. A migration failure prevents serving against an incompatible schema. Plans supporting a pre-deploy command may also run `npx prisma migrate deploy`; repeating it applies no migrations when current. Never run `migrate reset`, `migrate dev` or `db push` against hosted data. Take a recoverable backup before a schema release.

## Configuration

Supply secrets through Render's environment settings. Never commit values, paste credentials in reports or put credentials in Swagger examples.

| Variable | Guidance |
|---|---|
| `NODE_ENV` | Keep staging configuration for synthetic acceptance; use `production` only with real delivery and payment configuration |
| `DATABASE_URL` | Restricted Render PostgreSQL connection |
| `JWT_SECRET` | Runtime generated signing secret, minimum 32 characters |
| `JWT_SECRET_PREVIOUS` | Previous key during a controlled rotation only |
| `APP_ENCRYPTION_KEY` | 32 bytes encoded as 64 hexadecimal characters; preserve it to decrypt existing MFA credentials |
| `METRICS_TOKEN` | Runtime secret, required in production |
| `TRUST_PROXY_HOPS` | Default 1; verify the actual trusted proxy chain before changing |
| `BUILD_SHA` | Usually unset on Render: `RENDER_GIT_COMMIT` supplies the source identity; never set a stale override |
| `CORS_ALLOWED_ORIGINS` | Exact frontend origins, supplied by the frontend team |
| `MAIL_DRIVER` | `smtp` for actual mail; `logging` supplies no delivery and is suitable for local or synthetic staging only |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Provider credentials and verified sender, when using SMTP |
| `PAYMENTS_GATEWAY` | `payos` for supported real payments; `simulated` is restricted to non-production; `sepay` has no implemented adapter and blocks startup |
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | Runtime payOS merchant credentials |
| `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` | Frontend redirect pages; redirects do not prove payment settlement |
| `PAYMENTS_WEBHOOK_SECRET` | Required for the simulated adapter; payOS verification uses `PAYOS_CHECKSUM_KEY` |
| `SWAGGER_ENABLED` | Defaults to false; share committed `openapi.json` with the frontend team |
| `RATE_LIMIT_*`, `AUTH_IP_LIMIT_*` | Keep tested defaults; tune for legitimate shared-IP traffic after measuring |

Production validation rejects simulated payments, missing encryption/metrics configuration and `MAIL_LOG_FILE`. SMTP errors now propagate to the outbox and trigger retries; auth endpoints still return their uniform public responses. Render free web services block common outbound SMTP ports, so actual email needs a hosting plan/provider path supporting it. Do not weaken validation to conceal a delivery limitation. See [Render free service limitations](https://render.com/docs/free).

## Administrator provisioning

The existing privileged provisioning path is `npm run seed` with runtime-only `ADMIN_EMAIL` and `ADMIN_PASSWORD`, executed by an authorized operator with database access from the checked-out repository after `npm ci`. The seed uses the development TypeScript runner; the minimal production image does not include that runner. It creates a verified ADMIN and does not update an existing account. Self-registration allows STUDENT and PARENT only. No public ADMIN bootstrap endpoint exists.

Use a unique synthetic email for acceptance, leave `SEED_DEMO_DATA` unset and inspect any collision before continuing. Authenticate normally and enroll TOTP through the normal MFA endpoints before admin business endpoints become available. The verified email on a seeded administrator is an intentional property of privileged provisioning; public users still require verification. Never promote a self-registered user directly or disable MFA to run acceptance.

The same seed initializes missing belt ranks and settings without replacing existing values. It does not configure a real receiving bank account. Use the MFA-protected billing settings APIs for club configuration. Do not use the demo seed on a real club database.

## Release verification

Set repository environment secrets `RENDER_DEPLOY_HOOK` and `SMOKE_TEST_URL` through the authorized owner. CI requests the exact commit through the deploy hook, then checks `/version`, `/healthz` and `/readyz`. A healthy older deployment fails the gate. Missing deployment identity also fails it. `/version` exposes only a commit identifier, never environment contents.

Render builds using this Dockerfile normally have an empty `BUILD_SHA` and obtain identity from `RENDER_GIT_COMMIT`. Other image builders must pass `--build-arg GIT_SHA=<full-commit>`. Use `/readyz` for a deployment health check when supported: liveness alone does not verify database connectivity.

After deployment, verify the expected commit, normal MFA login, role/ownership isolation, a synthetic invoice/payment lifecycle and outbox delivery. A real payOS sandbox test requires configured merchant access and must be recorded separately from simulated callbacks. Verify gateway retry behavior and reconciliation for late receipts. Do not delete immutable financial/audit evidence after UAT.

## Operating boundary

Keep one API instance: rate limits, account lockouts, mail budgets and some replay caches are process-local. Database-backed session and refresh-token revocation remain durable. Multi-instance scaling requires a reviewed distributed store and tests before changing topology.

Configure the edge to discard untrusted forwarded headers and review `TRUST_PROXY_HOPS` when adding a CDN or moving to a VPS. TLS, network abuse protection and provider access policies require infrastructure configuration. Application throttling does not establish protection from volumetric attacks.

See `OPERATIONS.md` for releases, shutdown, reconciliation and VPS migration, and `BACKUP_RECOVERY.md` for non-destructive restore drills. Verify actual backup retention, access controls and recovery on the chosen Render plan before onboarding real users. A successful synthetic restore does not prove production PITR.
