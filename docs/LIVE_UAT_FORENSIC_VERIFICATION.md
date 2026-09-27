# Live UAT Forensic Verification

Independent verification of previously reported UAT/security/test-harness findings
against the repository source and the live Render deployment.
**Verification only — no code, configuration, or live data was modified, and no fixes were implemented.**

- **Date of verification**: 2026-09-26
- **Target**: `https://vovinamapinode.onrender.com`
- **Method**: static source/data-flow analysis, offline harness execution of the real runner module, and anonymous read-only HTTP probes. No login was performed with any discovered credential; no mutation was issued against the live deployment.

## 1. Scope

Verify, independently and without assuming truth or falsehood, findings F1–F10 about
`test/uat/live-render-runner.mjs`, `test/uat/live-runner-base.mjs`, `docs/LIVE_RENDER_UAT.md`,
`docs/LIVE_ENDPOINT_COVERAGE.md`, and the underlying application. Every finding is classified
**CONFIRMED / PARTIALLY CONFIRMED / NOT CONFIRMED / UNVERIFIABLE**, and every piece of evidence is
tagged **STATIC** (source/commit inspection), **DYNAMIC** (my own read-only live probes),
**REPRODUCTION** (the committed artifacts of the actual live UAT run), or **INFERENCE** (explicit
chains of evidence; never presented as fact).

Not in scope: implementing fixes, rotating credentials, destructive actions, mutating live UAT,
flood testing, and login attempts with discovered secrets.

## 2. Repository Commit Verified

- Local checkout `main` @ `1843954` is **36 commits behind** `origin/main`; it contains neither the
  runner nor the UAT docs (its `test/uat/` holds only the untracked, gitignored
  `test/uat/uat-admin-totp-secret.txt`). All repository evidence below is therefore taken from
  **`origin/main` @ `fff8642`** (merge of PR #30), extracted to a scratch directory; the working
  tree was not modified except for this report file.
- The live UAT harness and the committed run artifacts were introduced in commit **`b311670`**
  ("test(uat): add live render verification harness and reports", merged by `fff8642`).
- Correspondence check (STATIC): `docs/LIVE_RENDER_UAT.md` and `docs/LIVE_ENDPOINT_COVERAGE.md` carry
  Run ID `live-uat-1790411258051`, timestamp `2026-09-26T08:30:06.699Z`, 167 assertions / 166 PASS /
  1 BLOCKED / 111/111 coverage — exactly matching the committed `test/uat/live-uat-results.json`,
  which is structured exactly as `live-runner-base.mjs`/`live-render-runner.mjs` @ `b311670` emit it.
  **The report corresponds to the current runner at `fff8642`.** No evidence from other commits was
  mixed into finding verdicts; history checks (secret introduction) are explicitly labeled.

## 3. Evidence Sources

| Source | Kind | Notes |
|---|---|---|
| `origin/main @ fff8642` full tree (scratch extraction) | STATIC | runner, docs, src, prisma, CI, openapi.json |
| `git log --all` / pickaxe over reachable history | STATIC | only for secret-introduction history (§4) |
| `test/uat/live-uat-results.json` @ `b311670` | REPRODUCTION | machine-written record of the live run (167 records + 111 operation rows) |
| `docs/LIVE_RENDER_UAT.md`, `docs/LIVE_ENDPOINT_COVERAGE.md` | REPRODUCTION | generated from that JSON by `test/uat/generate-uat-md.mjs` / `generate-coverage-md.mjs` |
| Offline harness run of the real `live-runner-base.mjs` (F6/F7/F8) | REPRODUCTION (logic) | simulated inputs, stubbed `fetch`, zero network; transcripts in §8–§10 |
| Anonymous live probes 2026-09-26: `GET /healthz`, `/readyz`, `/docs`, `/docs-json`, `/metrics` (no token), `http://` redirect, one 404 probe | DYNAMIC | status + latency + headers + contract diff vs `openapi.json` only |
| Read-only Explore agents over `src/` (security; business logic) | STATIC | independent line-cited reviews (§13, §14) |

Not available / not used: Render dashboard or environment variables, the database, Bruno run logs,
and any authenticated request.

## 4. Finding F1 — Credential Exposure (incl. F2)

**VERDICT: CONFIRMED** (F1). **F2: CONFIRMED** on REPRODUCTION evidence (not re-tested live, per the no-login constraint).

Evidence (STATIC):
- `test/uat/live-render-runner.mjs:17` — the live UAT login body contains
  `email: 'uat-admin@example.com'` and a hard-coded password literal (value withheld here; visible
  in the cited line of the public source). Introduced to reachable history by commit `b311670`
  (pickaxe evidence). This is the runner's primary credential for **every** admin operation of the
  live run.
- `docs/BRUNO_UAT.md:45-46` — the same `ADMIN_EMAIL=uat-admin@example.com` and the same password
  literal are documented in committed prose (as the seed-time `ADMIN_PASSWORD` value).
- `test/uat/live-render-runner.mjs:22` — the runner additionally reads a TOTP secret from
  `test/uat/uat-admin-totp-secret.txt` (untracked; `.gitignore:22-23` ignores
  `test/uat/*-secret.txt`; a file of that name exists in local working trees but was **never
  committed** — history check).
- `test/uat/live-render-runner.mjs:211,221,232,270,282,443,445,454` — hard-coded
  `demo-instructor@example.com` / `demo-student@example.com` / `demo-parent@example.com` with the
  seeded demo password, defined in `prisma/seed.ts:134,154-170` (fixture by design, but these
  accounts exist on the deployed database — REPRODUCTION: the live run logged in as all three).
- Secret sweep of the rest of `origin/main`: no other hardcoded secrets; `.env`/`.pem`/key files were
  never committed (history check); JWT secret and encryption key are env-only with fail-fast
  validation (`src/config/env.validation.ts:69-77`).

Classification of the reported UAT password (per Phase 1 rubric): **C — a credential used by the
live UAT runner**, and on the evidence below effectively **D — proven to belong to the deployed
environment at run time**: `live-uat-results.json` shows the run acquired an admin session and
completed ~100 ADMIN-gated operations (user creation, settings writes, audit log with total 451)
against `https://vovinamapinode.onrender.com` (REPRODUCTION). Note the account is TOTP-enrolled, so
the committed password alone is not sufficient for admin login without the (uncommitted) TOTP
secret — a meaningful mitigation, not a cure. Whether the password is still valid **today** is
**UNVERIFIABLE** from the evidence gathered (no login was attempted, by design).

## 5. Finding F3 — Pre-existing Data Mutation

**VERDICT: CONFIRMED.** The runner's own Phase 2 assertion "All mutating operations will strictly
target synthetic entities" (`live-render-runner.mjs:134-135`) is a **self-asserted claim with no
test behind it** (STATIC; the recorded PASS is the literal string `'PASS'`), and the code contradicts
it.

Fixed-ID inventory (STATIC data-flow; every chain starts at a source literal):

| Fixed constant | Definition | Used for | Provenance | Cleanup |
|---|---|---|---|---|
| `basicClassId = 'a5ffc83b-…'` | runner:760 | create attendance session (765), attendance record upsert (799), generate-monthly classIds (1003,1012), tuition-rates PUT (1026), leave requests (1165,1180,1193,1230,1249), evaluation (1353) | PRE_EXISTING (the seeded `basicClass`, `prisma/seed.ts:232`; the hard-coded UUID only resolves against the live seeded DB) | **none** |
| `demoStudentProfileId = '7f4287ae-…'` | runner:46,761 | attendance record upsert (799–807), exam registration (917), result PASS → belt promotion (944), manual invoice (976), leave requests, proposal creation, evaluation, consent, notification read, `PATCH /students/me` edits (543) | PRE_EXISTING (seeded demo student) | **none** |
| `adminUserId = '5abedcea-…'` | runner:39 | self-deactivation attempt (1507, expects 400) | PRE_EXISTING | n/a (non-mutating) |
| foreign-student probe `8dc988a0-…` | runner:475 | GET only | PRE_EXISTING | n/a (READ ONLY) |

Confirmed mutation chains (STATIC + REPRODUCTION):

1. `demoStudentProfileId` → hard-coded constant → `POST /attendance-sessions` (classId=basicClassId,
   runner:765) → `POST /attendance-sessions/:id/records` body `studentId: demoStudentProfileId`
   (runner:799–807) → **an attendance record for the pre-existing demo student is written** → no
   deletion of session or record anywhere in the runner. REPRODUCTION: `live-uat-results.json`
   records `Session ID: 36b2bc5b-78c1-491b-b71f-8427e5f07bed` and "Upserted records" (status 200).
2. `demoStudentProfileId` → `POST /belt-exams/:id/register` (runner:917) →
   `POST /exam-registrations/:id/result {status: RESULT_PASS}` (runner:944) → the service sets the
   student's `currentBeltRankId` (`src/exams/exams.service.ts:295-298`) → **the pre-existing demo
   student's belt rank is permanently promoted**; runner:953–956 verifies the new rank on live.
3. `PATCH /api/v1/students/me {phone, address}` with the demo student's token (runner:543–549) →
   **the pre-existing demo student profile's phone and address are permanently overwritten**
   (no restore).
4. `GET /promotion-proposals` → find pre-existing `PENDING` proposal for the demo student →
   `POST …/review {status: REJECTED}` (runner:1270–1277) → **pre-existing business records are
   force-closed** ("Pre-existing proposal closed for clean UAT run").
5. `POST /auth/change-email/request` on the demo student account (runner:295–300) → a pending
   change-email token/request is attached to the pre-existing account (persists until expiry).
6. `POST /parents/link` binds the **pre-existing** demo parent to the in-run child
   (runner:593–599); the verified link cannot be removed by design (409, runner:617–619) and the
   child profile is then soft-deleted (runner:627) — the persistent link row remains.
7. `POST /consent`, `/consent/revoke`, `PATCH /notifications/:id/read` (first item of the demo
   student's **pre-existing** feed, runner:1559–1563) — rows written against pre-existing data.
8. `POST /belt-ranks` writes a `TEST_*` rank with a random `orderIndex` 2000–9000 into the live
   catalog (runner:845–854) and is never deleted; on the failure path `rankToUpdateId = testRankId
   \|\| 1` (runner:857) would PATCH **pre-existing catalog rank 1** (not triggered in this run).

Not confirmed: no destructive DELETE of any pre-existing business record was found; the two
fixed-ID `GET` probes are read-only; belt-rank 1 was not PATCHed in the recorded run.

## 6. Finding F4 — Global Settings Mutation

**VERDICT: CONFIRMED** (both endpoints are called, both are mutations of global settings, and
restoration does not exist).

- `PUT /api/v1/admin/billing/settings/tuition-rates {classId: basicClassId, monthlyAmount: 400000}`
  (runner:1026–1031) writes the `tuition_rates` app setting for the pre-existing demo class.
  Mitigating: the seed default for that class is also 400000 (`prisma/seed.ts:348`), so the written
  value most likely coincided with the existing one (no value change provable from artifacts).
  Structural defect: the previous value is **never captured** and **never restored**; a crash
  between PUT and the end of the run leaves whatever was written; if the club had configured real
  rates, they would be overwritten.
- `PUT /api/v1/admin/billing/settings/bank-account {bin:'970422', number:'123456789',
  name:'VOVINAM CLUB'}` (runner:1034–1039) overwrites the `bank_account` app setting. REPRODUCTION
  shows status 200. The seeded demo value differs — `{bin:'970422', number:'9012345678901',
  name:'VOVINAM DEMO CLUB'}` (`prisma/seed.ts:358-363`) — so this run **did change the live
  setting's value** (both values are synthetic; the point is the pre-existing value was replaced,
  not restored). Same absence of capture/restore/crash-safety.
- Crash guarantee: there is no `finally` block, cleanup registry, or signal handler anywhere in the
  runner (STATIC; see §12). Restoration is therefore not guaranteed under any failure.
- Effect on other users: both settings are global — QR generation refuses to run against a
  non-configured BUSINESS account (`src/billing/payments.service.ts:60,329-336`), so whoever owns
  `bank_account` owns where members pay. The mutation is live-affecting by design of the endpoint,
  not merely by accident.

No live settings were read or modified during this verification (the values above come from the
seed and the committed run artifacts).

## 7. Finding F5 — Financial Mutation

**VERDICT: PARTIALLY CONFIRMED.** No direct mutation of a pre-existing invoice or payment row was
found; however, new financial records are created against **pre-existing** students/classes and
persist, and prior-run residue proves this recurs.

- Payment lifecycle operations — QR (runner:1061), confirm-cash (1074), double-confirm (1083),
  refund PATCH (1093) — all target `syntheticInvoiceId`, which is the ID returned by
  `POST /invoices` **in the same run** (runner:973–984), and the refunded payment ID is the one
  returned by confirm-cash (1091). By the task's rubric these are **CREATED_IN_RUN**. The invoice is
  created for `demoStudentProfileId` (PRE_EXISTING student): the invoice/payment rows are new, but
  they permanently join the demo student's financial history (no invoice deletion exists in the
  runner).
- `POST /admin/billing/generate-monthly {month:11, year:2026, classIds:[basicClassId]}`
  (runner:1003–1018) targets the pre-existing demo class's **pre-existing enrollments**.
  REPRODUCTION: the first call returned `Generated: 0, Skipped: 2` — i.e., tuition invoices for
  Nov-2026 already existed for the 2 enrolled demo students **before** this run. The seed only
  creates current-month invoices (`prisma/seed.ts:373-418`, `periodMonth: thisMonth`), so the
  Nov-2026 invoices are residue from an earlier live UAT run — direct evidence that this runner
  repeatedly writes tuition invoices for pre-existing enrollments (INFERENCE, each link evidenced).
  It also means the recorded "idempotency" assertion never actually demonstrated creation.
- Nothing in the run mutated the seed's own demo invoices `INV-*-D001/D002` or their CASH payment
  (no endpoint call targets them).

## 8. Finding F6 — False Operation Coverage

**VERDICT: CONFIRMED.** The coverage mechanism can mark an operation COVERED/PASS without any HTTP
request, and counts failing assertions as covered.

STATIC:
- `live-runner-base.mjs:107-120` — `recordTest(..., opId)` sets `covered = true` unconditionally
  whenever `opId` is supplied, **regardless of PASS/FAIL/BLOCKED**.
- `live-render-runner.mjs:815-823` — when session creation fails (`syntheticSessionId` falsy), the
  runner directly assigns
  `operationCoverage.get('AttendanceController_upsertRecords').covered = true … result = 'PASS' …
  status = 200 … workflow = 'Pre-verified session records'` (and the same for `listRecords`) with
  **no request and no assertion**. The branch is reachable on any session-creation failure (e.g.
  403/404/500).
- `live-render-runner.mjs:429` and `:1057` record assertions with hard-coded `expected`/`actual`
  literals and no request (see §9/§11) — they don't touch the coverage map, but they inflate the
  PASS count.

REPRODUCTION (offline harness against the **real** `live-runner-base.mjs`, `fetch` stubbed, zero
network — run from a scratch copy):
- Executing the verbatim fallback branch marked both attendance operations
  `covered=true, result=PASS, status=200` with zero HTTP calls.
- `recordTest(..., 'FAIL', opId)` on a simulated 500 still set `covered=true` — so `111/111
  covered` does not imply 111 passed.
- The `/docs-json` record was verified to be genuinely fail-closed (real ternary), proving the
  harness distinguishes enforced from non-enforced assertions (fail-closed probe demanded by the
  task).

In the specific reported run the real branch did execute (the session was created), so the 111/111
figure happened to be backed by real requests — but the **mechanism** is proven false-positive-capable.

## 9. Finding F7 — `/docs` Assertion

**VERDICT: CONFIRMED.**

STATIC: `live-render-runner.mjs:94-97` —

```js
const docs = await request('GET', '/docs');
recordTest(0, 'GET /docs live documentation endpoint', '200 (Enabled for QA)', docs.status, 'PASS', …);
```

The result argument is the literal `'PASS'`; `docs.status` is recorded as "actual" but never
compared to anything. The status→comparison→PASS/FAIL chain required by the task does not exist.
(Contrast: the very next assertion, `/docs-json`, uses a real ternary
`docsJson.status === 200 ? 'PASS' : 'FAIL'`.)

REPRODUCTION (same offline harness): replaying the verbatim call with simulated `docs.status` =
200, 404, and 500 recorded **PASS in all three cases**.

DYNAMIC: the live `/docs` currently returns 200, so the recorded run's output happened to match
reality — the defect is in the assertion logic, not in this instance's outcome.

## 10. Finding F8 — Rate Limit Assertion

**VERDICT: CONFIRMED.** The assertion can report PASS without verifying any rate-limit behavior.

STATIC: `live-render-runner.mjs:1668-1687` — an 8-request concurrent burst against `/auth/login`
(nothing near the configured 30/min auth limit, so a 429 was structurally unlikely), then:

```js
recordTest(22, 'Auth IP rate limit responds without crashing server', 'Handled (401 or 429)',
  `Statuses: …`, 'PASS', `Auth rate limit layer active. 429 observed: ${burst429Seen}`);
```

Again the result is the literal `'PASS'` — independent of every status, of whether 429 appeared, and
of server health. The intended requirement (from `src/config/env.validation.ts:81-83`,
`src/auth/auth-ip-throttle.guard.ts:31-39`: 30 req/60s per IP on `/auth`, plus a 100/min global
window) is never exercised: no test drives the counter to the limit.

REPRODUCTION (offline harness, `fetch` stubbed): replaying the verbatim burst block recorded
**PASS for all-401, all-429, all-500, and all-503** sequences. EXPECTED and UNEXPECTED are
indistinguishable to this assertion.

REPRODUCTION (live run): the recorded note reads `429 observed: false` with statuses
`401, 401, 401, 401…` — and the assertion still shows PASS with the note "Auth rate limit layer
active", which the evidence does not establish. No production flood was performed in this
verification.

## 11. Finding F9 — Report Transparency

**VERDICT: CONFIRMED.** `docs/LIVE_RENDER_UAT.md` claims more than the runner can prove, and
`test/uat/generate-uat-md.mjs` is a hard-coded narrative template: only the header counts are
interpolated from the results JSON; **every claim below the fold is static text** that would appear
verbatim in any future run regardless of outcomes (STATIC).

CLAIM → SOURCE → ACTUAL BEHAVIOR → SUPPORTED?

| Report claim | Source | Actual behavior | Verdict |
|---|---|---|---|
| "166 Passed … 0 Failed" | template §1 (hard-coded) | counts in header are dynamic, narrative is not; a failing future run would still print "166 Passed" | **UNSUPPORTED as mechanism** |
| "All mutating operations … synthetic entities" | runner:134-135 records PASS with no test | §5 lists 10+ confirmed pre-existing-data mutations | **UNSUPPORTED** |
| "Zero Information Leaks … scanned all 167 raw response bodies" | template §29; runner:1636-1645 | the scan iterates `testResults`, whose `actual` is a status-code **number** for 160/167 records — 563 characters total were examined, never a response body | **UNSUPPORTED** (no leak found by my probes, but the scan cannot detect one) |
| "NODE_ENV=production" | template §2 | contradicted: `src/config/env.validation.ts:136-142` refuses to boot with `PAYMENTS_GATEWAY=simulated` when `NODE_ENV=production`; the live run's 401 (not 404) on `POST /payments/webhook/simulated` proves `gateway.provider === 'simulated'` (`src/billing/payments.service.ts:105-109`) | **CONTRADICTED** (INFERENCE, each link independently evidenced; the deployed app booted, so NODE_ENV ≠ production) |
| "Confirmed live environment runs PAYMENTS_GATEWAY=simulated" | template §17; runner:1057-1058 records PASS from two literals, note claims "Verified via live probe" | **no probe exists in the runner**. The conclusion itself is nevertheless true: provider-match dispatch means the recorded 401 proves the simulated gateway (REPRODUCTION + STATIC) | **UNSUPPORTED claim, TRUE conclusion** |
| "Admin MFA Guard: Live RolesGuard enforces …" | template §9; runner:429 records expected=403, actual=403, PASS — no request | nothing was exercised in the run; (the underlying guard exists in source, `src/auth/guards/roles.guard.ts:39-47`) | **UNSUPPORTED as live evidence** |
| "Billing Idempotency: re-running … yields created: 0" | template §16 | the FIRST call already returned `Generated: 0, Skipped: 2` — creation was never demonstrated; idempotency was not distinguishable from a no-op | **PARTIALLY SUPPORTED** |
| "Runtime: Node.js 24.x", "PostgreSQL 16", "Total Duration ~2.5 minutes" | template §2/§3 | Dockerfile pins `node:22-alpine`; no artifact records duration or DB version | **UNSUPPORTED / UNVERIFIABLE** |
| "exactly 88 paths and 111 operations, exactly matching … openapi.json" | template §5 | my anonymous `GET /docs-json` diff: paths, method+path sets, and operationIds are identical to the repo contract | **SUPPORTED** (DYNAMIC) |
| Pre-flight, headers, metrics 401, HTTPS redirect, uniform 404 envelope | template §4/§29 | reproduced exactly by my probes (200/200/401/301; HSTS, robots, nosniff, frame, CSP present) | **SUPPORTED** (DYNAMIC) |
| "All security controls … verified", "READY FOR HUMAN ACCEPTANCE TESTING" | template §31 | with §8–§10 + the above, the run cannot substantiate this strength of claim | **UNSUPPORTED** |

Additionally, of the 167 recorded assertions, at least **5 PASS records involved no HTTP request at
all** (template/`fs` check; "Synthetic prefix isolation"; "Admin MFA enforcement"; "Determine live
PAYMENTS_GATEWAY"; self-referential leak scan), and 2 more (the `/docs` and rate-limit assertions)
were HTTP-backed but logically incapable of failing. The report presents all 167 as equivalent
evidence.

## 12. Finding F10 — Persistent Side Effects / Cleanup

**VERDICT: CONFIRMED (LEAKY).**

STATIC: the runner has **no** `finally` block, no cleanup registry, no SIGINT/SIGTERM handling, and
no partial-run recovery; the only error handling is `run().catch(err => console.error(...))`
(`live-render-runner.mjs:1729-1731`), and `test/uat/live-uat-results.json` is written only on
successful completion (1712-1724). If the runner stops after step 100 of 200, **everything created
up to that point remains on Render, and no results file is produced.**

Persistent artifacts of a complete successful run (STATIC inventory; REPRODUCTION confirms the run
completed):

- Pre-existing data changed: demo student belt rank (promoted), demo student phone/address,
  `bank_account` setting value, pre-existing PENDING proposals (rejected), demo student's consent
  history / read receipt / pending change-email request, demo parent's verified link to a
  now-soft-deleted child.
- Created and never removed: attendance session `36b2bc5b-…` + attendance record for the demo
  student; synthetic class + schedule + enrollment + enrollee profile; synthetic belt rank;
  synthetic exam + registration + exam invoice; manual invoice (UNPAID after refund) + payment
  rows on the demo student; approved leave request; APPROVED + REJECTED proposals; `live-uat-instr2-…`
  **ACTIVE instructor account**; two unverified registered users; Nov-2026 tuition invoices for the
  demo class (this run: skipped because **earlier runs already left them** — recurring pollution).
- Cleaned by the runner (credit where due): synthetic student + child student (soft-deleted),
  announcements, discount, evaluation, two leave requests, three synthetic users
  (deactivated/self-deleted), one schedule, proposal `prop2` (closed).

Classification: **LEAKY** (deterministic leak of records attached to pre-existing entities, plus an
accumulating leak across runs). No live destructive simulation was performed.

## 13. Security Review

Independent line-cited review of `src/` at `fff8642` (areas 1–17: JWT, sessions, refresh rotation,
denylist, passwords, MFA, RBAC, ownership, validation, rate limiting, webhook signatures, financial
authorization, serialization, logging, CORS, headers, metrics, secrets). Summary; full detail was
reviewed with file:line citations:

- **SOUND**: HS256-pinned JWTs with `kid` rotation and type checking; DB-backed sessions + hashed
  refresh tokens with atomic rotation, reuse detection (family revocation + audit + email);
  single-use action tokens via `used_tokens` unique jti in-tx; bcrypt cost 10 with timing-equalized
  unknown-user path and `pwdVersion` bumping; TOTP with replay window, shared failure lockout,
  AES-256-GCM sealed secrets, recovery codes hashed + single-use; ADMIN-admitting routes require
  MFA enrollment; central ownership service with uniform-404; global forbidNonWhitelisted
  validation + ParseUuidPipe + 1 MB body cap; per-IP throttling with IPv6 /64 buckets and a
  dedicated auth-surface window; HMAC-SHA256 webhook verification with `timingSafeEqual` over the
  raw body and exactly-once settlement claims; ADMIN-only cash/refund; no passwordHash/TOTP-secret/
  recovery-code exposure in any serializer; Pino redaction; strict CORS allowlist; helmet + noindex;
  metrics behind constant-time token comparison.
- **New finding N1 (P2, deployment)**: the live deployment runs `PAYMENTS_GATEWAY=simulated`
  outside `NODE_ENV=production` (evidence chain in §11). The code comment at
  `env.validation.ts:135` states the simulated gateway "must never reach production … a fake
  checkout must not be able to settle in a live deployment". The deployed environment therefore
  settles real (club-demo) invoice records through the simulated gateway and without the
  production-only hardening posture the report claims.
- **New finding N2 (P3)**: `SWAGGER_ENABLED` is not force-disabled in production (unlike
  `MAIL_LOG_FILE` and the simulated gateway); `/docs` and `/docs-json` are currently **enabled** on
  the live deployment (deliberate per the report, DYNAMIC 200) with the relaxed CSP.
- **P3, documented design trade-offs**: in-memory `SharedStore` for rate-limit counters, login
  lockout, mail budgets, and jti denylist (reset on restart, not shared across replicas);
  `totpVerify` consumes the pending secret before validating the code (UX); bcrypt cost 10;
  dev/demo literals (`Demo#2026` seed behind `SEED_DEMO_DATA`, compose password, `.env.example`
  placeholders).
- No new exploitable P0/P1 security vulnerability was identified in application source.

## 14. Business Logic Review

Independent line-cited review of the 12 critical invariants (details with file:line in the working
notes):

- **ENFORCED (11/12)**: student ownership/status/soft-delete (financial rows retained via
  `onDelete: Restrict`); parent verified links, race-safe single-use invite rotation; class capacity
  via `SELECT … FOR UPDATE` + shrink guard, same-day rejoin rule (app-level, serialized); attendance
  session + record uniqueness at DB level; exam deadline/capacity/duplicate/finality and belt
  transition with concurrent-promotion guard; promotion review writes proposal fields only (belt
  untouched); billing totals and monthly uniqueness (`@@unique(studentId,type,periodMonth,periodYear)`)
  with P2002-as-skip idempotency; payment amount pinned to invoice total, signature-verified,
  claim-first idempotent, Σ SUCCESS settlement and refund re-derivation; announcement audience
  isolation (ALL = ADMIN-only); leave review scope (foreign instructor → uniform 404) + finality;
  exam registration + invoice atomic in one transaction.
- **PARTIAL — new finding N3 (P2)**: `POST /evaluations` validates `classId` for **existence only**
  (`src/evaluations/evaluations.service.ts:72-82`): an instructor who may access a student may
  attach the evaluation to **any** existing class, not one they teach (no `assertOwnClass`
  equivalent as in announcements/leaves/attendance). Untested by any suite. Duplicate-period
  prevention exists but does not cover period-less evaluations (NULLs distinct — possibly intended).
- Minor (P3): ADMIN manual TUITION invoice with a duplicate period surfaces as 500 (P2002
  re-thrown after invoice-no retries) instead of 409; multiple concurrent PENDING QR transactions
  per invoice are not prevented (surplus payments no-op silently).

## 15. Confirmed Findings

- **F1 CONFIRMED** — hard-coded live-UAT admin credential in repository source
  (`test/uat/live-render-runner.mjs:17`) and documentation (`docs/BRUNO_UAT.md:45-46`);
  TOTP secret file untracked but present on disk (never committed).
- **F2 CONFIRMED** — the credential belongs to the deployed environment's bootstrap admin
  (REPRODUCTION: committed run artifact shows successful MFA-satisfied admin auth on Render; not
  re-tested live by this verification).
- **F3 CONFIRMED** — systematic mutation of pre-existing data (attendance record for the demo
  student on the demo class, permanent belt-rank promotion, profile edits, force-closed pre-existing
  proposals, verified-link creation, notification/consent rows); the runner's "synthetic isolation"
  assertion is self-asserted and false in substance.
- **F4 CONFIRMED** — global settings mutated with no capture/restore; `bank_account` value actually
  changed (seed value ≠ written value); crash-unsafe.
- **F6 CONFIRMED** — coverage can be marked COVERED/PASS without any request (fallback branch),
  and FAILs count as covered; demonstrated on the real module offline.
- **F7 CONFIRMED** — `/docs` assertion is a hard-coded PASS; cannot fail at any status.
- **F8 CONFIRMED** — rate-limit assertion is a hard-coded PASS; 429-never-observed still recorded
  "Auth rate limit layer active"; indistinguishable outcomes in harness simulation.
- **F9 CONFIRMED** — report overstates evidence (§11 table); narrative is a static template;
  several PASS records involve no HTTP request; the leak scan never examined a response body;
  `NODE_ENV=production` claim contradicted by the code's own fail-fast rule.
- **F10 CONFIRMED** — no guaranteed cleanup; deterministic persistent side effects on the Render
  database; residue from earlier runs proven by `Skipped: 2` on first generate-monthly call.
- **N1 (new, P2)** — live deployment runs the simulated payments gateway outside
  `NODE_ENV=production`.
- **N2 (new, P3)** — `/docs`+`/docs-json` enabled in the live deployment; not force-disabled in
  production builds.
- **N3 (new, P2)** — evaluations accept any existing `classId` from instructors permitted to access
  the student (no own-class scoping).

## 16. Rejected / Unproven Findings

- **F5 PARTIALLY CONFIRMED** — the specific claim "financial mutations on pre-existing invoices or
  payment records" is **NOT CONFIRMED** (all payment mutations targeted CREATED_IN_RUN records);
  what is confirmed is creation of new financial records bound to PRE_EXISTING students/classes and
  their persistence (and recurring monthly-invoice writes evidenced by prior-run residue).
- **Unproven / UNVERIFIABLE** (not asserted either way): current validity of the committed UAT
  password (no login attempted); live DB engine version ("PostgreSQL 16"); live Node runtime
  ("24.x" — repo Dockerfile says node:22); "~2.5 minutes" run duration (not recorded); whether any
  actual secret leak ever occurred (the scan that claims zero leaks was vacuous; my probes found
  none); live rate-limit enforcement behavior (a 429 was never observed by the run and no flood was
  performed here).
- **Claims verified as accurate** (to keep the report honest): live contract identical to
  `openapi.json` (88 paths / 111 operations / operationIds); pre-flight probe results; security
  headers; `/metrics` 401; HTTP→HTTPS 301; uniform 404 envelope; webhook bad-signature 401; the
  simulated-gateway conclusion of §17/§18 (true conclusion, unsupported verification).

## 17. Repair Priority

- **P0**: none proven.
- **P1**
  1. F1/F2 — remove the hard-coded UAT credential from source and docs; source it from env/secret
     store; rotate the exposed password.
  2. F3 — redesign the runner to operate only on CREATED_IN_RUN resources (including creating its
     own class/student for attendance, exams, billing) and to restore or avoid global state.
  3. F4 — capture-and-restore (or read-only verification) for `bank_account` / `tuition_rates`.
  4. F10 — add guaranteed cleanup (try/finally + registry + signal handlers + results-file-on-exit).
- **P2**
  5. F6/F7/F8 — every recordTest must derive PASS/FAIL from the actual status/body; delete the
     coverage fallback or mark it UNVERIFIED; make coverage count PASS only.
  6. F9 — generate the narrative from the results JSON (no static claims); drop or gate
     unverifiable environment claims.
  7. N1 — move the live deployment to `NODE_ENV=production` + a real gateway sandbox, or explicitly
     accept and document the simulated-gateway posture.
  8. N3 — scope evaluation `classId` to classes the instructor teaches.
- **P3**
  9. F5 — clean up financial test records or isolate UAT to a dedicated tenant/dataset.
  10. N2 — forbid `SWAGGER_ENABLED=true` in production or accept explicitly per environment.
  11. Security P3 notes (shared store, TOTP verify UX, bcrypt cost) and billing P3 notes
      (duplicate-period 500, concurrent PENDING QRs).

---

VERIFICATION VERDICT:

**CONFIRMED ISSUES REQUIRE REPAIR**
