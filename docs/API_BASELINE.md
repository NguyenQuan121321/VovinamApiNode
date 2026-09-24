# VovinamApiNode — API Baseline (TASK-03)

Baseline date: 2026-09-24. Status: **APPROVED** — authoritative API baseline for the thesis.
Produced by TASK-03-API-RECONCILIATION against the approved TASK-01 architecture baseline and
TASK-02 database baseline. The code corrections below are merged to `main` via PR #22
(merge `abc2185`); this document is the TASK-03 deliverable record.

**API VERDICT: KEEP EXISTING API + FOUR TARGETED CORRECTIONS.** The existing API conventions
(`/api/v1` prefix, `{code,message,data}` envelope, ownership-guard 404 posture, role
decorators, UUID parsing, uniform pagination) are sound and were preserved. No endpoint was
redesigned or removed. Four corrections were proven necessary by the reconciliation and
implemented: AD-06 (QR initiation role restriction), DD-04 (webhook malformed-payload 200),
the announcements module (AD-07 — the missing thesis primary value 3), and two convention
repairs (session-id UUID parsing, attendance-history pagination).

Method: full inspection of all 14 controllers, every DTO, the guard chain
(JwtAuthGuard → RolesGuard → StudentOwnershipService), both role serializers
(`serializeStudent`, `serializeClass`), the payment webhook chain, all unit specs (63 suites),
all e2e/security suites (13 suites), and the regenerated `openapi.json` (67 paths / 81
operations — matches the controllers exactly).

---

## 1. API Purpose

REST API under `/api/v1` serving the thesis objective: võ sinh (students) quickly view class
schedules, tuition, and club activities; admins manage club operations; instructors manage
training operations; payments are collected by QR or cash; parents act for minors; every
student-scoped read is ownership-guarded. The API is the only interface between the React
frontend (separate project) and the PostgreSQL data (architecture baseline §4–§5).

## 2. API Scope

In scope: auth/account lifecycle (24 paths), students, parents, classes/schedules/enrollments,
attendance, belt ranks, belt exams/registration/results, invoices/tuition, QR/cash payments and
webhook, revenue report, notifications feed, consent, **announcements (new)**, ops probes.
Out of scope: any admin approval workflow for PENDING self-registrations beyond
`PATCH /students/:id` status (exists), bulk import, CSV export, attendance analytics, oasdiff
gate (deferred, §13).

## 3. Actor/Role Access

Roles are exactly `UserRole` (ADMIN, INSTRUCTOR, STUDENT, PARENT); Võ sư = ADMIN persona
(AD-02); PARENT is the supporting actor for minors (AD-03). One role per user.

| Area | ADMIN | INSTRUCTOR | STUDENT | PARENT |
|---|---|---|---|---|
| Auth/account/self | full own-account ops | same | same | same |
| Student profiles | full CRUD + invite codes | list/read own-class, no contact fields | self read | children read (verified link) |
| Classes/schedules | read + write | read | read | read |
| Enrollments | write | — | — | — |
| Attendance sessions/records | write all | write/read own class | — | — |
| Attendance history/summary | any student (guard 7.3) | own-class students | self | children |
| Belt ranks | write | read | read | read |
| Belt exams | CRUD | read | read + register self | read + register child |
| Exam results | write + examiner attribution | write | — | — |
| Invoices | full | **none** | own | children's |
| Payments | full incl. cash confirm, refund | **none** (zero financial surface, AD-06) | own QR initiation | children's QR initiation |
| Webhook | public (HMAC, no JWT) | — | — | — |
| Revenue report | yes | — | — | — |
| Notifications | own feed + admin flush | own feed | own feed | own feed |
| Consent | self + minor-proxy via guard | self | self | self + child proxy (minors only) |
| Announcements | CRUD | read (ALL + own classes) | read (ALL + own classes) | read (ALL + children's classes) |

## 4. Endpoint Inventory (67 paths / 81 operations — matches openapi.json)

| Module | Path (method) | Roles | Guard/ownership |
|---|---|---|---|
| auth | /auth/register POST | public | uniform anti-enumeration |
| auth | /auth/login POST | public | throttle + lockout + dummy bcrypt |
| auth | /auth/refresh-token POST | public (token) | rotation + reuse detection |
| auth | /auth/verify-email, resend-verification, forgot-password, reset-password POST | public | single-use tokens |
| auth | /auth/logout, logout-all POST; sessions GET; sessions/:id DELETE; me GET/DELETE; me/audit-log GET; change-password, change-email/request, change-email/confirm, deactivate POST | JWT self-scoped | sensitive ops require password (+TOTP) |
| auth | /auth/mfa/login-verify POST; mfa/methods GET; mfa/totp/{enable,verify,validate,disable} POST; mfa/totp/recovery-codes GET | public/JWT self-scoped | shared 5/5min failure bucket |
| students | /students GET | ADMIN, INSTRUCTOR | instructor scoped to own classes, serializer drops contacts |
| students | /students POST; /:id PATCH; /:id DELETE; /:id/invite-code POST | ADMIN | — |
| students | /students/me GET | STUDENT | self |
| students | /students/:id GET | any role | guard 7.3, 404 posture |
| parents | /parents/link POST; /parents/me/children GET; /parents/links/:studentId DELETE | PARENT | invite-code only; unlink unverified only |
| classes | /classes GET, /classes/:id GET | any authenticated | — |
| classes | /classes POST, /:id PATCH, /:id/schedules POST, /:id/schedules/:scheduleId DELETE | ADMIN | capacity-shrink guard |
| enrollments | /enrollments POST, GET, /:id DELETE | ADMIN | capacity + same-day guards, soft-leave |
| attendance | /attendance-sessions POST; /:id/records POST(GET); /:id/records GET | ADMIN, INSTRUCTOR | own-class 404 posture |
| attendance | /students/:id/attendance GET (paginated, this task) | any role | guard 7.3 |
| attendance | /attendance/summary GET | any role | guard 7.3 on studentId |
| belts | /belt-ranks GET | any authenticated | — |
| belts | /belt-ranks POST, /:id PATCH | ADMIN | P2002 → 409 |
| exams | /belt-exams GET, /:id GET | any authenticated | — |
| exams | /belt-exams POST, /:id PATCH | ADMIN | lifecycle + rank checks |
| exams | /belt-exams/:id/register POST | STUDENT, PARENT | guard 7.3 + atomic EXAM_FEE invoice |
| exams | /exam-registrations/:id/result POST | ADMIN, INSTRUCTOR | final results; PASS promotes |
| billing | /invoices GET | ADMIN, STUDENT, PARENT | role-scoped in service |
| billing | /invoices/:id GET | any role (service-guarded) | 404 for INSTRUCTOR (plan 7.4) |
| billing | /invoices POST; /admin/billing/generate-monthly POST; /admin/reports/revenue GET | ADMIN | idempotency UQs |
| payments | /payments/qr/:invoiceId POST | **ADMIN, STUDENT, PARENT** (AD-06 fix) | guard 7.3 + payable + bank guard |
| payments | /payments/webhook/:provider POST | public | HMAC over raw body |
| payments | /payments/:invoiceId/confirm-cash POST; /payments/:id PATCH | ADMIN | claim-first idempotency |
| payments | /payments GET | ADMIN, STUDENT, PARENT | guard 7.3 via invoice |
| notifications | /notifications/me GET; /notifications/:id/read PATCH | any authenticated | self-scoped, foreign 404 |
| notifications | /admin/notifications/flush POST | ADMIN | — |
| consent | /consent POST; /consent/revoke POST; /consent/me GET | any authenticated | self + parent-proxy via guard 7.3 |
| announcements | /announcements GET | any authenticated | audience-scoped (ALL + own classes) |
| announcements | /announcements POST; /:id PATCH; /:id DELETE | ADMIN | audience/classId consistency |
| ops | /healthz, /readyz GET | public | — |
| ops | /metrics GET | bearer token | 404 when unconfigured |

## 5. Use Case Mapping (thesis-critical: USE CASE → ACTOR → AUTHZ → ENDPOINT → SERVICE → DB)

| Use case | Actor → authz | Endpoint → service → tables |
|---|---|---|
| Authentication | all → public/self | /auth/* → AuthService → users, sessions, refresh_tokens, used_tokens |
| MFA | all → self | /auth/mfa/* → AuthService+TotpService → totp_credentials, recovery_codes |
| Student management | ADMIN → role | /students* → StudentsService → student_profiles |
| Profile self-view | STUDENT → self | /students/me → StudentsService → student_profiles |
| Parent access | PARENT → verified link | /parents/* → ParentsService → parent_student_links |
| Classes | all read / ADMIN write | /classes* → ClassesService → classes |
| Schedules | all read / ADMIN write | /classes/:id/schedules → ClassesService → class_schedules |
| Enrollment | ADMIN → role | /enrollments* → EnrollmentsService → enrollments |
| Attendance taking | ADMIN, INSTRUCTOR own class | /attendance-sessions* → AttendanceService → attendance_sessions, attendance_records |
| Attendance history | guard 7.3 | /students/:id/attendance, /attendance/summary → AttendanceService → attendance_records |
| Belts | read all / write ADMIN | /belt-ranks → BeltsService → belt_ranks |
| Exams + registration | browse all; register STUDENT/PARENT; result ADMIN/INSTRUCTOR | /belt-exams*, /exam-registrations/:id/result → ExamsService → belt_exams, exam_registrations, invoices |
| Tuition | ADMIN write; reads role-scoped | /invoices*, /admin/billing/generate-monthly → BillingService → invoices, invoice_items, app_settings |
| QR payment | ADMIN/STUDENT/PARENT (AD-06) + guard 7.3 | /payments/qr/:invoiceId → PaymentsService → payment_transactions |
| Payment confirmation | public HMAC webhook + ADMIN cash | /payments/webhook/:provider, /payments/:invoiceId/confirm-cash → PaymentsService → payment_transactions, invoices |
| Payment outcomes/report | ADMIN | /payments/:id PATCH, /admin/reports/revenue → PaymentsService/BillingService |
| Notifications | self-scoped | /notifications/* → NotificationsService → notifications |
| Consent | self + parent-proxy | /consent* → ConsentService → consent_logs |
| Club activities | read audience-scoped; write ADMIN | /announcements* → AnnouncementsService → announcements |
| Reports | ADMIN | /admin/reports/revenue → BillingService → payment_transactions |

Every thesis-critical use case maps to at least one endpoint. No missing, duplicated, or
unnecessary endpoint was found beyond the corrections in §12.

## 6. Authorization Rules

Binding invariants (AD-09): (a) every route carries explicit `@Roles` **or** a documented
self-scoped/service-guarded justification — the unannotated routes are self-scoped auth/students/
notifications/consent reads or the service-guarded invoice/attendance/QR reads, plus the
public webhook (HMAC) and ops probes; (b) student-scoped access always passes guard 7.3 with
the 404 posture; (c) field exposure follows the plan §7.4 matrix; (d) authorization is
server-side only. **AD-06 now enforced: `POST /payments/qr/:invoiceId` carries
`@Roles('ADMIN','STUDENT','PARENT')`** — INSTRUCTOR has zero financial surface, matching the
invoice/payment reads. ADMIN MFA enforcement remains a TASK-05 item (not an API-shape change).

## 7. Ownership Rules

`StudentOwnershipService.assertCanAccess` (plan 7.3, violation = 404, never 403):
- student: `student_profiles.user_id == caller` (self);
- parent: verified `parent_student_links` row;
- instructor: student currently enrolled in a class the caller teaches (`left_at IS NULL`);
- admin: full; existence checked first for every role (uniform 404 on unknown ids).

Applied to: /students/:id, /students/:id/attendance, /attendance/summary, exam registration,
consent studentId proxy, invoices/:id (service-side equivalent), payments list/QR (via
invoice.studentId). Non-student ownership: notifications (userId + foreign 404), sessions
(userId + uniform 401), enrollments/attendance-sessions (own-class 404 for INSTRUCTOR),
announcements (audience membership; admin writes).

## 8. Data Exposure Rules

Serializer matrix verified in place (`serializeStudent`): INSTRUCTOR loses
address/phone/emergency contact/hasLinkedAccount; medical notes visible to all four roles
(safety); contact fields full for ADMIN/STUDENT(self)/PARENT(linked). Auth responses never
expose password hashes, TOTP secrets (sealed AES-256-GCM; enable returns the secret exactly
once over the authenticated channel), refresh/recovery token hashes (recovery codes returned
once at generation), or pwd_version internals. Payments expose no gateway credentials; webhook
responses leak nothing (uniform `{processed}` shapes). Audit log rows expose only the caller's
own entries. Announcements expose only audience-visible rows. No password hash, MFA secret,
or internal financial field is present in any serializer — verified by inspection of every
serialize function and the regenerated contract.

## 9. Pagination / Validation / Error Conventions

- Envelope `{"code","message","data"}` on every response (global interceptor + exception filter).
- Pagination `?page=1&limit=20`, limit ≤ 100 (`PageDto`), response `{items,total,page,limit}`.
  Applied by: students, classes, enrollments, exams, invoices, notifications, audit-log,
  announcements, **and now attendance history (this task's correction)**. Non-paginated lists
  are deliberately bounded by construction: attendance records per session (bulk upsert ≤ 200,
  class capacity bounded), parents' children (verified links), sessions list, consent history,
  payment list per invoice, revenue buckets.
- Validation: global `ValidationPipe(whitelist, forbidNonWhitelisted)`; DTOs use class-validator
  with explicit ranges (VND ints `@Min(0) @Max(1e9)`, months 1–12, years 2000–2100).
- UUIDs: `ParseUuidPipe` on **all 32** id params (was 31; sessions/:id added this task) —
  malformed id → 400, well-formed foreign id → uniform 404/401.
- Errors: short messages, no internals; uniform 401 (auth), 403 (role), 404 (ownership/anti-
  probing), 409 (business conflicts), 400 (validation); 200 on action-style POSTs, 201 on
  creates (post-Session-14 convention).

## 10. Payment API Rules

1. QR initiation `POST /payments/qr/:invoiceId`: roles ADMIN/STUDENT/PARENT (AD-06) + guard
   7.3 via `invoice.studentId`; invoice must be UNPAID/OVERDUE; bank account must be
   `owner_type=BUSINESS` and fully configured; creates PENDING txn (`order_ref` "VV"+8,
   30-min expiry) via `PaymentGatewayPort`.
2. Webhook `POST /payments/webhook/:provider`: public; constant-time HMAC over raw body →
   **401 only on bad signature**; unknown provider → 404; malformed-but-signed payload →
   **200 `{processed:false}` (DD-04 fix — the gateway never retries garbage)**; unknown
   orderRef → 200 no-op; claim-first `gateway_txn_id` idempotency (duplicate/parallel =
   exactly once, all 200); amount mismatch → DISPUTED + flagged audit, never PAID; SUCCESS
   settles invoice PAID when SUCCESS-sum ≥ total, in one transaction.
3. Cash `POST /payments/:invoiceId/confirm-cash` (ADMIN): claim-first on invoice flip; double
   confirm → 409.
4. Outcomes `PATCH /payments/:id` (ADMIN): REFUNDED/DISPUTED on SUCCESS only; invoice
   re-derived (OVERDUE never regresses).
5. Financial rows are never hard-deleted; all amounts are integer VND.

## 11. OpenAPI Contract Policy

`openapi.json` is generated from the code (`npm run openapi:generate`), committed, and enforced
by the CI contract-gate (regenerate-diff + spectral `--fail-severity=error`). Any route, DTO,
or response-status change MUST regenerate the contract in the same commit (contract §3/§4,
session-14 lesson). Current state: **67 paths / 81 operations, 0 spectral errors** (81
pre-existing style warnings, descriptions-only). This task's regeneration cleared the P5
staleness (P1-1 contract half) and includes notifications, consent, and announcements.

## 12. Required API Changes (implemented in this task)

| # | Change | Evidence | Classification |
|---|---|---|---|
| C-1 | `@Roles('ADMIN','STUDENT','PARENT')` on `POST /payments/qr/:invoiceId` (INSTRUCTOR loses QR initiation) | AD-06 approved; plan §7.4; audit H-2/P2-2 — was the only unannotated non-self-scoped route | **required** |
| C-2 | Webhook malformed-but-signed payload → 200 no-op instead of 401 | DD-04; plan §7.5 "always 200 (except 401 on bad signature)"; audit H-5/J-2 | **required** |
| C-3 | Announcements module: `GET /announcements` (audience-scoped: ALL + own classes via enrollment/verified-link/instructorship), `POST`, `PATCH /:id`, `DELETE /:id` (ADMIN) | AD-07 approved design; plan §6/§8; thesis primary value 3 — the only missing thesis use case; table already landed in TASK-02 | **required** |
| C-4 | `ParseUuidPipe` on `DELETE /auth/sessions/:id` (the one remaining unparsed id param; malformed id was a 500-path P2023) | Session-14 fix convention applied to its last omission | **justified** |
| C-5 | Attendance history `GET /students/:id/attendance` paginated (`PageDto`, `{items,total,page,limit}`) | Contract §4 global pagination; unbounded year-spanning list was the only remaining defect of the convention | **justified** |

Classification of TASK-00 items NOT implemented (per instruction 8):
- **Per-student aggregated schedule endpoint (H-3, DD-02)** → **defer** (optional P3). Thesis
  value 1 is served by the class catalog; DD-02 remains an approved optional extension.
- **INSTRUCTOR QR policy** → resolved as C-1 (required, AD-06).
- **Webhook malformed payload** → resolved as C-2 (required, DD-04).
- **Announcements** → resolved as C-3 (required, AD-07). Optional per-user INAPP fan-out via
  the outbox stays a TASK-04 decision (AD-07 extension).
- No unnecessary or duplicated endpoints found; no endpoint removed; no HTTP method changed.

## 13. Deferred API Changes

| # | Deferred change | Why | Owner |
|---|---|---|---|
| D-1 | `GET /students/me/schedule` aggregated schedule | DD-02: UX strengthening, not a boundary change | TASK-04 (optional) |
| D-2 | Announcement INAPP notification fan-out on publish | AD-07 extension decision | TASK-04 |
| D-3 | oasdiff breaking-change gate | Infrastructure packaging, no API-shape issue | TASK-06 |
| D-4 | ADMIN MFA enforcement guard | Guard-layer change within existing routes; no route shape change | TASK-05 |
| D-5 | Real payOS/SePay adapter URLs behind the existing QR endpoint | Port design already additive; credentials missing | TASK-04/05 |
| D-6 | `PATCH /students/:id` status approval endpoint distinct from generic PATCH | Already expressible today; churn without defect | never unless UX demands |

## 14. API Risks

| ID | Risk | Severity | Mitigation/owner |
|---|---|---|---|
| A-1 | The P5 + TASK-02/03 working set landed via PR #22 (merge `abc2185`); residual risk is process discipline only — any future route/DTO/status change must regenerate `openapi.json` in the same commit | Low | CI contract-gate enforces; session-14 lesson recorded |
| A-2 | QR real-gateway demo blocked on payOS/SePay credentials | External (R-9) | TASK-04 adapters + TASK-05 prod guard |
| A-3 | Simulated-gateway checkoutUrl targets a non-existent local route (P3-2, cosmetic) | Low | TASK-04 (adapter replaces it) |
| A-4 | Announcements has no draft/scheduled state (published-at-create per plan §6) | Low (by design) | Revisit only on club request |
| A-5 | INSTRUCTOR exclusion from QR initiation is enforced at the role layer; a future route addition could reintroduce the gap silently | Low | This baseline §6 invariant + review discipline |
| A-6 | Unpaginated bounded lists (sessions, children, payments-per-invoice) rely on structural bounds | Low | Acceptable at club scale; revisit with DDB-3 trigger |

## 15. Thesis Traceability

| # | Thesis requirement | API support | Status after TASK-03 |
|---|---|---|---|
| 1 | Students view class schedules | GET /classes, GET /classes/:id (catalog); aggregated read deferred D-1 | Complete (catalog form) |
| 2 | Students view tuition | GET /invoices (role-scoped), GET /invoices/:id | Complete |
| 3 | Students view club activities | **GET /announcements (audience-scoped) + admin CRUD** | **Complete (this task)** |
| 4 | Admin manages club operations | 30+ ADMIN ops across students/classes/enrollments/attendance/belts/exams/billing | Complete |
| 5 | Instructor manages training operations | attendance sessions/records (own class), exam results, own-class student reads | Complete |
| 6 | QR payment | POST /payments/qr/:invoiceId (AD-06 roles) + webhook + cash + outcomes | Complete (simulated adapter; real gateway D-5) |
| 7 | Role-based authorization | @Roles on every non-self-scoped route + guard 7.3 + serializer 7.4 | Complete |
| 8 | Testing | 285/285 unit (63 suites), 76/76 e2e+security (13 suites), contract lint 0 errors | Verified this session |
| 9 | Deployment trial | ops endpoints (healthz/readyz/metrics) unchanged | TASK-06 |
| 10 | Student management incl. minors | students + parents invite-code flow + consent proxy | Complete |

Stack traceability: REST `/api/v1` ✓; envelope/pagination/errors uniform ✓; OpenAPI = code ✓
(67 paths / 81 ops); RBAC ✓; ownership ✓; data exposure ✓.

---

## Verification log (this session, disposable PostgreSQL 18 on :5433)

- format:check ✓; lint ✓ (0 problems, --max-warnings 0); typecheck ✓; build ✓.
- `npm test` → **285/285 unit, 63 suites** (271 baseline + 14 announcements specs).
- `npx prisma migrate reset --force` (25 tables incl. announcements) → `npm run test:e2e` →
  **76/76 tests, 13 suites** (68 baseline + 8 new: 6 announcements, AD-06 instructor-403,
  DD-04 webhook-200).
- `npm run openapi:generate` → 67 paths / 81 operations (was 59/71 committed); regenerate
  idempotent; `npm run contract:lint` → **0 errors**, 81 pre-existing description warnings.
