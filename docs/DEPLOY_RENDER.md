# VovinamApiNode — Render Deployment Guide

Audience: the deploy owner. This is the concrete runbook for the "deployment trial"
(thesis requirement 9, PLAN.md §11/P7). Application-side readiness is verified
(`docs/FINAL_QA_REPORT.md` §9); what remains is the hosting setup described here.

---

## 1. Services to create

| Service | Type | Notes |
|---|---|---|
| API | Web Service, **Docker** (repo Dockerfile) | Multi-stage, non-root, `node --enable-source-maps dist/main.js` |
| Database | Render PostgreSQL 16 | Copy the **internal** connection string into `DATABASE_URL` |

Database is accessed only by the API (architecture baseline §4). Do not expose it
elsewhere; Render databases are not publicly reachable by default.

## 2. Migrations on release (pre-deploy command)

The Docker image does **not** self-migrate (deliberate). On the Web Service set the
**Pre-Deploy Command** to:

```
npx prisma migrate deploy
```

Prisma is a runtime dependency, so this runs inside the already-built image. It applies
only pending committed migrations and is a no-op when the schema is current. Never use
`prisma db push` or `migrate dev` against the hosted database.

## 3. Environment variables (Web Service → Environment)

Required production set (all validated fail-fast at boot; a missing/wrong value blocks
startup with an explicit message — verified by test and live boot):

| Variable | Value / guidance |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Render Postgres internal connection string |
| `JWT_SECRET` | Fresh 64-hex secret (never reuse a dev value) |
| `JWT_SECRET_PREVIOUS` | Set only while rotating keys |
| `APP_ENCRYPTION_KEY` | 64-hex (32 bytes) — seals TOTP secrets |
| `METRICS_TOKEN` | ≥ 16 chars; `/metrics` answers 401 without the right bearer |
| `PAYMENTS_GATEWAY` | `payos` (production refuses `simulated`) |
| `PAYOS_CLIENT_ID` / `PAYOS_API_KEY` / `PAYOS_CHECKSUM_KEY` | From the payOS merchant portal |
| `PAYOS_RETURN_URL` / `PAYOS_CANCEL_URL` | Public frontend URLs |
| `PAYMENTS_WEBHOOK_SECRET` | payOS webhook secret |
| `CORS_ALLOWED_ORIGINS` | Exact frontend origins, e.g. `https://yourapp.onrender.com` — **required for the React frontend to call the API**; keep empty only if no browser client exists |
| `MAIL_DRIVER` | `smtp` + `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — required for deliverable email (verification/reset mail) |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX_REQUESTS` | Defaults 60 s / 100 req per IP — see §5 tuning |
| `AUTH_IP_LIMIT_MAX` / `AUTH_IP_LIMIT_TTL_SECONDS` | Defaults 30 / 60 s per IP on `/auth` — see §5 tuning |
| `SWAGGER_ENABLED` | Leave unset (off) in production |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Only used by the seed script run manually — not needed by the web service |

Forbidden in production (boot refuses): `PAYMENTS_GATEWAY=simulated`,
`PAYMENTS_WEBHOOK_SECRET` missing, `MAIL_LOG_FILE` set, missing `METRICS_TOKEN` or
`APP_ENCRYPTION_KEY`.

## 4. Health checks, deploy hook, smoke

- **Health Check Path**: `/healthz` (liveness, no DB). `/readyz` additionally pings the DB.
- After the first deploy: open the service URL and check `GET /healthz` →
  `{"code":200,"message":"OK","data":{"status":"ok"}}`.
- CI's deploy job activates automatically once the repo secrets `RENDER_DEPLOY_HOOK`
  and `SMOKE_TEST_URL` are set (Settings → Secrets and variables → Actions): every green
  push to `main` then triggers the hook and polls `/readyz`.
- Seed the club data once (from a machine with the hosted `DATABASE_URL`):
  `npx prisma db seed` (creates `app_settings` + belt ranks; add
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` to also create the first admin). Then **verify the
  admin's email is deliverable and enroll TOTP immediately** — ADMIN MFA is enforced on
  all admin routes (plan §4.1).

## 5. Abuse protection and IP handling on Render

Application layer (implemented, tested):

- Global per-IP throttle: `RATE_LIMIT_*` (default 100 req/60 s), IPv6 /64 bucketing,
  key from the proxy-resolved `request.ip`.
- Strict per-IP auth-surface window: `AUTH_IP_LIMIT_*` (default 30 req/60 s on all
  `/auth` routes) — credential stuffing, mail bombing, token guessing.
- Per-account: login lockout (5 fails → 15 min), mail budgets (5/hour).
- `X-Robots-Tag: noindex, nofollow` on every response; Swagger off by default.

Tuning notes for real usage: if many students share one IP (club Wi-Fi / school NAT),
raise `RATE_LIMIT_MAX_REQUESTS` and `AUTH_IP_LIMIT_MAX` — the values above are per IP,
not per user.

Infrastructure layer (provider responsibility — do not attribute these to the app):
TLS termination, HTTP→HTTPS redirect, HSTS header, WAF/CDN, volumetric DDoS mitigation.
Render terminates TLS at its edge and forwards to the app over the private network;
the application's `trust proxy = 1` matches Render's single proxy hop, and Render's
edge sets `X-Forwarded-For` from the real client (the app reads `request.ip`, which is
that address). If you additionally put Cloudflare (or another CDN) in front, review the
proxy chain: either strip client-supplied XFF at the first trusted hop or lower the
app's `trust proxy` setting (`src/bootstrap.ts`). Direct-IP access to the app is not
possible on Render (no public raw-IP ingress); the origin is reached only through the
provider edge.

## 6. Backups

- Render managed PostgreSQL: enable/verify **point-in-time recovery and daily backups**
  on the instance (plan §11.4). Business data (students, invoices, payments) is never
  deleted by the app, so the backup path is the only data-loss protection.
- Before real money flows: run one **restore drill** (restore a backup into a scratch
  instance, verify row counts) and record the date + duration — the QA report tracks
  this as an open owner item.

## 7. First-deploy checklist (condensed from PLAN.md §14)

1. Pre-deploy migration applies cleanly; `/healthz` and `/readyz` return 200.
2. Seed + first ADMIN created; admin email verified; TOTP enrolled (admin routes stay
   403 until then, by design).
3. `CORS_ALLOWED_ORIGINS` matches the frontend origin exactly.
4. Swagger returns 404 on the production URL.
5. One real payOS sandbox payment: QR → webhook → invoice PAID.
6. `RENDER_DEPLOY_HOOK` + `SMOKE_TEST_URL` secrets set; CI deploy job runs green.
7. Metrics reachable only with `METRICS_TOKEN`.
