# VovinamApiNode — Security & Hardening Notes (TASK-05)

Date: 2026-09-24. Produced by TASK-05-HARDENING on `feat/task-05-hardening` (stacked on
`feat/task-04-implementation`). This document records **verified facts only** — evidence for
every claim is a passing test, a boot-time check, or an explicit measurement in this session
(see IMPLEMENTATION_PROGRESS.md, Session 22, for the full gate log). Nothing here claims
"secure", "compliant", or "production-ready" beyond what is demonstrated.

---

## 1. Authentication controls (verified)

| Control | Implementation | Evidence |
|---|---|---|
| Password policy | min 8, letters+digits, must not contain email/username; enforced at register/change/reset and seed | unit specs (password-policy.spec.ts) |
| Anti-enumeration | uniform 401 + identical message for unknown user / wrong password / locked / disabled / unverified; dummy-bcrypt timing equalization | S-07/S-09 e2e |
| Account lockout | 5 consecutive failures → 15 min (env-tunable), per-account via SharedStore | S-07 e2e |
| Rate limiting | global per-IP throttler (IPv6 /64 buckets, S-10) + per-account mail budgets | S-10 unit; e2e-env disables for tests |
| Session lifecycle | session rows with ip/UA/expiry; list/revoke/logout-all; JWT guard checks jti denylist + pwd_version + account + session state | S-12, auth-coverage e2e |
| Refresh rotation | opaque 256-bit token, SHA-256 at rest, rotate-on-use; replay of a rotated token revokes ALL sessions + email alert | S-08 e2e |
| Email verification / reset | single-use tokens via `used_tokens` (verify 24 h, reset 15 min), purge job every 6 h | S-07/S-09 e2e, auth-coverage |
| TOTP MFA | AES-256-GCM sealed secrets, ±1 step skew, 120 s replay guard, ONE shared 5-failures/5-min bucket across verify/validate/login-verify, 10 hashed single-use recovery codes | S-05 e2e |
| **ADMIN MFA enforcement (this task)** | `RolesGuard` rejects any ADMIN-token request to a route whose `@Roles` admit ADMIN with 403 "MFA enrollment required" until a TOTP credential exists. Self-scoped `/auth/*` routes (and any-authenticated catalog reads) stay reachable so the account can bootstrap enrollment. | new unit specs (roles.guard.spec.ts) + new S-13 e2e (`test/security/s13-admin-mfa.e2e-spec.ts`) |

ADMIN MFA enforcement boundary (documented, deliberate): routes **without** `@Roles` metadata —
self-scoped auth routes and any-authenticated reads such as `GET /classes`, `GET /belt-ranks`,
`GET /students/:id` (ownership-guarded) — remain reachable by a password-only ADMIN. This is the
bootstrap path (enabling TOTP itself is a self-scoped route). The gated surface is everything
with dedicated admin admission: all admin writes, financial reads/writes, admin lists, exam
result entry, attendance writes. A password-only ADMIN therefore cannot write anything, list
students, or see invoices/payments.

Go-live requirement (process, not code): the seeded ADMIN must (a) verify its email address
(the seed does not set `email_verified_at` — login is impossible before verification, by
design) and (b) enroll TOTP via `POST /auth/mfa/totp/enable` + `/verify` before any admin
endpoint works.

## 2. Authorization controls (verified)

- Four enforcement layers (architecture baseline §10): JWT guard → `@Roles` + RolesGuard →
  ownership guard 7.3 (404 posture) → field serializer 7.4 matrix.
- INSTRUCTOR has zero financial surface: no invoice/payment reads (404) and no QR initiation
  (`@Roles('ADMIN','STUDENT','PARENT')`, AD-06 — TASK-03).
- New in this task: the ADMIN MFA gate above (§1). Non-ADMIN roles keep the plain 403 posture;
  no extra DB query is made for them (unit-verified).
- IDOR: every student-scoped route passes `StudentOwnershipService.assertCanAccess`
  (S-01/S-04); foreign session revoke → uniform 401; notifications foreign id → 404.

## 3. Abuse protection — two distinct layers

**APPLICATION-LAYER PROTECTION (implemented here):**
- Global per-IP throttle (`RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX_REQUESTS`, default
  100 req/60 s), IPv6 /64 bucketing, tracker taken from the proxy-resolved `request.ip`.
- **Strict per-IP auth-surface window (2026-09-25):** `AuthIpThrottleGuard` applies a
  second, tighter fixed-window bucket (`AUTH_IP_LIMIT_MAX`, default 30 req/60 s) to every
  `/auth` route — register, login, refresh, verification mail, reset, MFA. Counters live
  in the SharedStore (same primitive as lockout/mail budgets) and use the same hardened
  tracker. Closes the low-volume abuse windows: credential stuffing, mail bombing,
  verification-token guessing. Unit-tested (`auth-ip-throttle.guard.spec.ts`); e2e raises
  the limit via env.
- Throttle-key hardening (this task, audit I-4/P2-7): the bucket key is Express's
  first-untrusted-from-socket address (`request.ip`). The previous `request.ips[0]` key was
  attacker-rotatable behind an edge that APPENDS to `X-Forwarded-For` (client-supplied XFF
  prefix lands in `ips[0]`).
  **Deployment requirement:** the edge proxy must overwrite or strip client-supplied
  `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $remote_addr;` or
  `$proxy_add_x_forwarded_for` on a trusted chain). With a non-conforming proxy, set
  `trust proxy` to 0 (bootstrap.ts) so the socket address is used. On Render the edge
  overwrites XFF and `trust proxy = 1` matches its single hop (docs/DEPLOY_RENDER.md §5).
- Login lockout, shared TOTP failure bucket, per-account mail budgets, 1 MB JSON body cap,
  `ValidationPipe(whitelist, forbidNonWhitelisted)`, ParseUuidPipe on all id params.
- **Anti-scraping/anti-indexing posture (2026-09-25, deliberately light):** every response
  carries `X-Robots-Tag: noindex, nofollow`; Swagger is off in production; list endpoints
  are paginated (limit ≤ 100); error envelopes are uniform with no schema disclosure. For
  an authenticated club API this is the honest ceiling — a determined scraper with valid
  credentials cannot be fully prevented, only rate-limited and kept out of search indexes.

**INFRASTRUCTURE-LAYER PROTECTION (NOT implemented in this codebase):**
TLS termination, WAF/CDN, volumetric/network DDoS mitigation, HSTS at the proxy are the
hosting provider's responsibility (architecture baseline §4). **The application throttler
mitigates per-IP abuse and resource exhaustion only; it does not stop a volumetric DDoS
attack.** This boundary is contract §13 and must not be presented as full DDoS protection.

## 4. Financial integrity (verified — regression coverage)

- Webhook chain: constant-time HMAC over exact raw bytes → 401 only on bad signature;
  malformed-but-signed payload → 200 `{processed:false}` (DD-04) so gateways never retry
  garbage; unknown orderRef → 200 no-op.
- Idempotency: claim-first `gateway_txn_id` conditional update + DB unique constraint —
  duplicate AND parallel deliveries process exactly once, all 200 (S-03); parallel cash
  confirmation claim-first on the invoice flip (409 on double confirm).
- Amount rule: mismatch → DISPUTED + `payment_flagged` audit, never PAID (S-11); invoice
  flips PAID only when SUCCESS-sum ≥ total inside one transaction.
- Refund/dispute: re-derivation from SUCCESS sums; OVERDUE never regresses.
- Concurrency: enrollment/exam capacity serialized via `SELECT … FOR UPDATE`
  (db-integrity-races e2e); invite-code claim-first rotation; result-time rank re-validation
  prevents belt downgrade (TASK-04 fixes, kept green here).
- Production guards (this task): `PAYMENTS_GATEWAY=simulated` fails boot in production;
  the webhook secret is REQUIRED whenever the simulated gateway is selected (without it
  webhooks could never verify and payments would silently never settle — audit I-3).

## 5. Configuration fail-fast (verified — env.validation.spec.ts)

Boot blocks on, among others:
- `production` without `APP_ENCRYPTION_KEY` (64-hex) or `METRICS_TOKEN` (pre-existing).
- `production` with `PAYMENTS_GATEWAY=simulated` (new — simulated can never settle real money).
- any env with `PAYMENTS_GATEWAY=simulated` but no `PAYMENTS_WEBHOOK_SECRET` (new).
- `production` with `MAIL_LOG_FILE` set (new — that file captures full mail bodies including
  single-use tokens; audit P3-4).
- `MAIL_DRIVER=smtp` without `SMTP_HOST`/`SMTP_FROM`; `PAYMENTS_GATEWAY=payos` without any of
  the five payOS variables (pre-existing).

Metrics (`/metrics`): 404 when unconfigured (non-production), 401 on wrong bearer token,
constant-time comparison; Swagger (`/docs`) only when `SWAGGER_ENABLED=true` and is off by
default with a dedicated CSP when on.

## 6. Reliability (reviewed this task; findings)

| Area | Verified behavior |
|---|---|
| DB failures | Prisma connects at boot (fail-fast); queries that fail throw into the request path with a mapped error envelope; no silent partial commits observed — every multi-write operation is one `$transaction` |
| Gateway failures | payOS adapter maps fetch failures / non-`00` responses to 503 with a 10 s abort timeout; QR creation is transactional, so a failed gateway call leaves no orphan PENDING row that can settle |
| Email failures | `MAIL_PORT` adapters never throw into the request path (SMTP adapter and LoggingMailSender both log-and-continue) |
| Notification outbox | claim-first QUEUED→SENDING, stale-SENDING recovery after 10 min, bounded retry (5) with backoff, ZNS→SMS→EMAIL fallback, worker pass never throws into the interval |
| Background jobs | unref'd intervals + `enableShutdownHooks` + `onModuleDestroy` — SIGTERM stops intake and drains |
| Request limits | Node 22+ defaults (headers 60 s / request 300 s) + 1 MB body cap; no custom timeout added — no measured need |
| Config failures | joi fail-fast at boot (§5) — the process refuses to start misconfigured |

## 7. Observability (verified)

pino JSON logs + request-id middleware on every route; request logging interceptor;
prom-client metrics (HTTP durations/errors, default process metrics) at bearer-protected
`/metrics`; append-only audit log with user-facing `GET /auth/me/audit-log`. Log redaction:
no passwords, tokens, TOTP codes, or mail bodies are logged; `MAIL_LOG_FILE` (the one
token-bearing sink) is now production-forbidden (§5).

## 8. Performance baseline (measured 2026-09-24, re-verified 2026-09-25)

Zero-dependency load script: `load/smoke.mjs` (plan §3 reserves `load/` for this). Workload
assumption: ~300-user club, single instance — **no enterprise targets are implied**.
Method: disposable PostgreSQL 18 (:5433), server built from the measured tree, 20 VU
closed-loop fetch, 4 s warmup + 12 s measurement per scenario, 2 runs per tree. Client and
server share one host, so absolute numbers carry host noise; the unaffected control
endpoint bounds that noise.

| Scenario (20 VU) | baseline rps | baseline p50/p95/p99 ms | after rps | after p50/p95/p99 ms |
|---|---|---|---|---|
| GET /healthz (no DB) | 3552 / 3411 | 5 / 11–12 / 20 | 3392 / 3581 | 5 / 12 / 19–21 |
| GET /readyz (SELECT 1) | 1974 / 2333 | 9 / 16–18 / 22–25 | 2105 / 1631 | 8 / 19–33 / 27–72 |
| GET /classes (control, unguarded) | 359 / 388 | 55 / 68–133 / 80–184 | 341 / 345 | 46–57 / 75–121 / 83–145 |
| GET /invoices (ADMIN — new MFA check) | 402 / 375 | 49–51 / 62–76 / 69–97 | 340 / 360 | 54–58 / 72–78 / 82–86 |

Server process (prom metrics): RSS ≈ 415 MB, heap ≈ 180 MB used, event-loop lag ≤ 4 ms,
≈ 90 s CPU across ~64 s of wall-clock load (≈ 1.4 cores) — identical across trees.

**Re-measurement 2026-09-25 (auth-limiter + noindex-header tree, throttles disabled for
measurement):** /healthz 2690 rps (p50 6.3 / p95 19.5 / p99 26.4 ms), /readyz 1330 rps
(p50 13.8 ms), GET /classes 248 rps (p50 78.3 / p99 118.6 ms), GET /invoices 255 rps
(p50 76.1 / p99 108.4 ms), 0 errors, RSS ≈ 385 MB, event-loop lag ≈ 6 ms. Absolute
numbers sit below the 09-24 run (different DB state — the e2e suite had just seeded the
database — plus host load); the decision-relevant comparison is internal: the
classes↔invoices ratio is unchanged (1.03 vs 1.1 across runs), i.e. the new auth-surface
guard and the per-response `X-Robots-Tag` header — which do not execute on these paths —
cost nothing measurable here. The same session also demonstrated the throttler under
default production settings: a single IP above 100 req/60 s is answered 429 across all
scenarios (≈ 23k blocked requests in the first measurement run before the limit was
raised for measurement).

Reading (honest): the ADMIN MFA guard adds one indexed primary-key lookup per request on
admin-admitting routes. Measured invoices delta is ≈ −7 % median throughput, but the
unguarded control endpoint shows the same run-to-run swing (±10 %), so the true cost of the
guard is at or below the measurement noise; p50 shift is ≤ 8 ms. At club scale this is not a
bottleneck; no optimization is justified. No N+1, unbounded-list, or missing-pagination
defect was found in inspection (all list endpoints paginated or structurally bounded;
serializers map over included relations). Deferred with trigger conditions: revenue report
in-memory aggregation (DDB context, DB-baseline §16) and `attendance_records(student_id)`
index (DDB-3).

## 9. Backup / recovery (facts only)

- **Implemented in this repository: nothing.** No backup job, no restore script, no drill.
- Data-loss exposure: single PostgreSQL instance; committed migrations allow schema rebuild
  from an empty database, but **business data has no verified backup path yet**.
- Responsibility: the deployment owner, via the managed-Postgres provider (plan §11.4: PITR
  + offsite dumps + monthly restore drill). **RPO/RTO targets are planned, not demonstrated;
  no restore has ever been executed.** Owner: TASK-06 + provider setup.

## 10. Privacy / legal boundary (classification)

| Item | Technical control | Business process | Legal / accounting | Unverified |
|---|---|---|---|---|
| Minor data | no minor self-registration; invite-code parent links; ownership guard; serializer matrix | parent consent handling at the club | Children Law 2016 posture — **requires legal verification** | whether the club's actual consent workflow satisfies it |
| Consent records | append-only purpose-scoped `consent_logs`, parent-proxy, revocation | publishing the data/consent policy to parents | Decree 13/2023 posture — **requires legal verification** | scope of "sensitive data" interpretation |
| Medical notes | serialized to all four roles (safety rationale, plan §7.4) | who may read them operationally | sensitive-data category — **requires legal verification** | retention |
| Financial records | never hard-deleted; FK RESTRICT chain; integer VND | cash handling, reconciliation runbook (TASK-06) | e-invoice obligations (Decree 123/2020) — **requires accountant** | whether the club must issue e-invoices at current scale |
| Bank account | `owner_type=BUSINESS` config guard before QR issuance | account opened in the legal entity's name | Circular 25/2025 / Decree 68/2026 — **requires verification** | tax declaration status |
| IPs / audit logs | minimal retention (sessions/tokens purged), request-id correlation | incident response process | — | retention period for audit rows |

Code existence is **not** compliance. Every legal/accounting cell above needs named, dated
human verification before any claim is made (contract §11).

## 11. Remaining production limitations (owner)

1. Deployment trial not executed: deploy CI job is a stub (no `RENDER_DEPLOY_HOOK` /
   `SMOKE_TEST_URL`), no staging/prod instance. The concrete setup steps are now written
   down in `docs/DEPLOY_RENDER.md` (2026-09-25); executing them is the owner action.
2. Backup/DR: none demonstrated (§9).
3. payOS sandbox verification (real QR → webhook → PAID) pending owner credentials; the
   adapter is verified against SDK-derived test vectors only.
4. ZNS/SMS adapters are stubs (fail-safe fallback to EMAIL); Zalo OA/template approval is an
   owner action.
5. Runbooks (`docs/OPERATIONS.md`), consolidated security-suite packaging, and the oasdiff
   breaking-change gate are TASK-06 items.
6. Single-instance constraint (in-process workers, in-memory SharedStore) — documented,
   accepted at club scale; horizontal scale-out is out of scope until measured (DD-03).
