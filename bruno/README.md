# VovinamApiNode UAT — Bruno collection

A runnable Bruno collection that exercises the **real API** end to end: business
workflows per domain plus the negative/authorization cases (wrong role, foreign
resource, malformed id, duplicate operation, invalid state, wrong signature,
capacity, deadline).

- 19 folders, 245 requests, 363 test assertions — every request asserts
  business data, not just HTTP 200.
- Requests chain through environment variables (ids/tokens captured in
  post-response scripts), so a single top-to-bottom run needs **no manual ids**.
- Last full recorded run: **245/245 requests, 363/363 tests passed** against a
  disposable PostgreSQL (see `docs/BRUNO_UAT.md`).

## Run it

```bash
# 1. Start the API against a disposable database (see docs/BRUNO_UAT.md)
npm run build && node dist/main.js

# 2. Execute the whole collection in business order
npx bru run --env Local          # from this folder (collection root)

# or a single domain
npx bru run 10_billing --env Local
```

Requires `@usebruno/cli` (already a devDependency). The Bruno desktop app can
open this folder directly as a collection.

## Folders (execution order)

| Folder | Domain | Highlights |
| --- | --- | --- |
| `00_health` | healthz / readyz / metrics | metrics token auth |
| `01_auth` | register → MFA enrollment → logins | anti-enumeration, TOTP computed in-script |
| `02_users` | admin backoffice | role filter, self-protection, audit log |
| `03_students` | directory, self-service, invite codes | 404 anti-probing, whitelist rejections |
| `04_parents` | invite-code linking | single-use code, verified unlink rules |
| `05_classes` | classes + schedules | foreign-instructor 404, validation |
| `06_enrollments` | enrollment rules | capacity, same-day rejoin, soft leave |
| `07_attendance` | sessions, bulk upsert, reports | enrolled-only, overwrite, monthly report |
| `08_belts` | rank catalog + distribution | duplicate code/order conflicts |
| `09_exams` | exams → registration → results | PASS promotes, FAIL does not, deadline/capacity/duplicates |
| `10_billing` | invoices, monthly close, reports, discounts | totals math, idempotent close, discount XOR |
| `11_payments` | QR → signed webhook → settle | HMAC computed in-script, replay, amount mismatch, refund |
| `12_announcements` | ALL/CLASS audience | instructor limits, visibility scoping |
| `13_leaves` | absence requests | duplicate, review/cancel finality, scope |
| `14_promotions` | proposals | advisory only — approval never moves the belt |
| `15_evaluations` | period evaluations | duplicate period, author scoping |
| `16_consent` | consent ledger | idempotent grant, revoke, parent proxy limits |
| `17_notifications` | feed + outbox | read marking, foreign-id 404 |
| `18_auth_teardown` | logout / refresh replay | replay revokes the whole token family |

## Scripting notes

- Bruno's sandbox has no `require('crypto')`; the webhook-signature and TOTP
  requests inline verified pure-JS SHA-1/SHA-256/HMAC/Base32 helpers (byte-exact
  against `node:crypto`).
- Admin surfaces are gated by the ADMIN MFA policy: the collection enrolls
  `demo-admin` into TOTP at `01_auth/09-10` and logs in through
  `POST /auth/mfa/login-verify`.
- Demo credentials come from the `SEED_DEMO_DATA=true` seed — no real
  credentials anywhere.
