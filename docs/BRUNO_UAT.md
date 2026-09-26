# Bruno UAT — setup, execution, and results

`bruno/` contains a runnable Bruno collection that performs user-acceptance
testing of the deployed API over real HTTP: one request per business step,
chained with environment variables, asserting business outcomes (invoice
totals, belt promotions, audience visibility, settlement idempotency) rather
than bare status codes.

**Recorded result (2026-09-25, commit under review): 245/245 requests passed,
363/363 tests passed, against a disposable PostgreSQL from a fresh seed.**

---

## 1. Setup

### 1.1 Disposable database

No Docker required. On the WSL host the verified procedure is:

```bash
/usr/lib/postgresql/18/bin/initdb -D /tmp/pg-uat -U vovinam --auth=trust
/usr/lib/postgresql/18/bin/pg_ctl -D /tmp/pg-uat -o "-p 5433 -k /tmp" start
/usr/lib/postgresql/18/bin/createdb -h /tmp -p 5433 -U vovinam vovinam_uat
```

### 1.2 Environment (temporary `.env`, never committed)

```env
DATABASE_URL=postgresql://vovinam@localhost:5433/vovinam_uat?schema=public
JWT_SECRET=uat-jwt-secret-0123456789abcdef0123456789abcdef
APP_ENCRYPTION_KEY=abab...abab            # 64 hex chars
SWAGGER_ENABLED=true
MAIL_DRIVER=logging
MAIL_LOG_FILE=tmp/uat-mail.log
PAYMENTS_GATEWAY=simulated
PAYMENTS_WEBHOOK_SECRET=uat-webhook-secret-0123456789abcdef
METRICS_TOKEN=uat-metrics-token
RATE_LIMIT_MAX_REQUESTS=2000              # raised: the collection fires ~245
AUTH_IP_LIMIT_MAX=300                     # requests in ~45 s from one IP
ADMIN_EMAIL=uat-admin@example.com         # bootstrap admin (now seeded verified)
ADMIN_PASSWORD="UatAdmin2026x"            # quote it: '#' starts a dotenv comment
SEED_DEMO_DATA=true
```

Then:

```bash
npx prisma migrate deploy
npx prisma db seed
npm run build && node dist/main.js        # readyz must answer 200
```

### 1.3 Bruno environment

`bruno/environments/Local.bru` ships with matching demo values (`baseUrl`,
`metricsToken`, `webhookSecret`, the four demo accounts). All runtime ids and
tokens (`adminToken`, `studentId`, `tuitionInvoiceId`, `qrOrderRef`, ...) are
captured automatically during the run — nothing to copy by hand.

## 2. Execution order

Run the collection top-to-bottom (folder order is alphabetical and encodes the
business sequence; see `bruno/README.md` for the folder map):

```bash
cd bruno
npx bru run --env Local
```

Single domains can be run for debugging (`npx bru run 11_payments --env Local`)
but most depend on state captured by earlier folders (login tokens are created
in `01_auth`; ids flow forward through `bru.setEnvVar`).

## 3. Business workflows covered

- **Auth lifecycle** — register (anti-enumeration duplicate), unverified-login
  rejection, per-role logins, TOTP enrollment with computed codes, MFA login,
  sessions, refresh rotation, refresh-replay family revocation, logout/logout-all.
- **Student lifecycle** — admin directory + filters, self-service contact edit,
  identity-field whitelist rejection, soft delete, invite regeneration.
- **Parent linking** — single-use invite claim (replay of a claimed code → 404),
  verified unlink refused, child visibility.
- **Classes/enrollments** — capacity wall, duplicate enrollment, same-day rejoin
  refusal, soft leave, paused/foreign-class behavior.
- **Attendance** — one session per class/date, enrolled-students-only batches,
  duplicate-in-batch rejection, overwrite correction, history/summary/report
  scoping.
- **Belts/exams** — catalog ordering, duplicate code/order-index conflicts,
  exam lifecycle, atomic registration + EXAM_FEE invoice, deadline and capacity
  refusals, duplicate registration, **PASS promotes / FAIL does not**, finality,
  foreign-instructor result attempt → uniform 404 (regression test for the
  result-recording scope guard).
- **Billing** — manual invoice math (total = subtotal − discount − code),
  period rules, idempotent monthly close (rerun creates nothing, classes
  without rates reported), revenue and tuition reports, settings, discount
  CRUD + XOR + expiry.
- **Payments** — QR initiation, **HMAC-signed webhook computed over the exact
  raw body in-script**, settlement → invoice PAID, duplicate webhook no-op,
  wrong signature 401, unknown order no-op, **amount mismatch → DISPUTED and
  never PAID**, cash confirmation + double-confirm 409, refund → invoice
  re-derivation to UNPAID.
- **Announcements** — ALL vs CLASS posting rules per role, audience-scoped
  feeds for student/parent, foreign-class 404.
- **Leaves** — duplicate/past-date/enrollment rules, review scoping, finality,
  cancellation rules.
- **Promotions** — propose/rank-ordering/open-proposal rules, **approval does
  NOT move the belt** (asserted against the API), master-only review.
- **Evaluations** — duplicate period conflicts, author-scoped update/delete,
  unknown classId → 404 (regression for the former FK 500).
- **Consent** — idempotent grant, revocation, append-only history, parent-proxy
  limits (no-account minor → 400).
- **Notifications** — invoice-issued notification delivery, read marking +
  idempotency, foreign-id 404, outbox flush.

## 4. Expected results

The run must end with `245 (245 Passed)` requests and `363/363` tests. Any
failure names the business rule that regressed; the collection is the
acceptance harness for the thesis permission-matrix domains.

## 5. Known limitations

- **Email-bound steps are not automatable end-to-end** (verification, reset,
  email change): the logging mail driver writes to `MAIL_LOG_FILE`, which an
  external black-box client cannot read. The collection asserts the
  anti-enumeration envelopes for these flows instead; the e2e suite reads the
  mail log and covers the full token flows.
- **Auth throttles must be raised for automated UAT** (see `.env` above); the
  production defaults (30 auth req/min/IP) would 429 a 245-request run.
- **The webhook HMAC/TOTP is computed in-script** with inlined pure-JS crypto
  because Bruno's sandbox has no `require('crypto')`; the implementations are
  verified byte-exact against `node:crypto`.
- **Audit-log rows are written by an async batcher** (50 entries or shutdown),
  so immediately-adjacent reads may be empty; the collection asserts shape only.
  This lossy-by-design behavior is tracked as a P3 finding in
  `POST_RELEASE_VALIDATION.md`.
- Bruno CLI 4.2.0 ignores `query`/`params:query` blocks when building requests
  (verified against an echo server), so query parameters are embedded in the
  `url` field where interpolation works.

## 6. External credentials

None required. The simulated gateway needs only `PAYMENTS_WEBHOOK_SECRET` (a
local UAT value). Real PayOS/SePay credentials are intentionally never
fabricated; exercising the real gateway is out of scope for UAT and gated in
production by `env.validation.ts`.
