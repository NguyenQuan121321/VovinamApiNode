# VovinamApiNode — Permission-Matrix Reconciliation (final)

Date: 2026-09-25. This document reconciles the thesis requirement text and the
club permission matrix (Dashboard…Audit Log × Admin / Võ sư / HLV / Võ sinh)
against the implemented backend, after the matrix-completion increment
(branch `feat/matrix-completion`).

Legend: V=View, C=Create, E=Edit, D=Delete, A=Approve, P=Process,
`*` = own data only.

Role mapping (approved, AD-02/AD-03): **Võ sư → ADMIN persona** (ADMIN is a
permission superset of INSTRUCTOR on every route; grading attribution exists via
`exam_registrations.examiner_id`), **Võ sinh → STUDENT role + StudentProfile**
(minors hold a profile without an account), **PARENT** is the required supporting
role for minors (absent from the original matrix — added here as a column).

---

## 1. Row-by-row reconciliation

| # | Module / chức năng | Matrix (Admin / Võ sư / HLV / Võ sinh) | Implementation | Tests (all green) | Status |
|---|---|---|---|---|---|
| 1 | Dashboard | V / V / V / V | Frontend concern; backend exposes every needed read (classes, invoices, notifications, reports) | domain suites | **OK** (backend provides data; UI = React project) |
| 2 | Quản lý User | V/C/E/D | `GET/POST /users`, `PATCH/DELETE /users/:id` (ADMIN) — role change / password reset / deactivation revoke all sessions + bump pwd_version; self-deactivation refused | matrix-completion e2e ×4, admin-users.service.spec ×8 | **OK** |
| 3 | Phân quyền Role/Permission | V/C/E/D | Deliberate fixed 4-role RBAC (plan §4.2); roles change per user via row 2 | roles.guard.spec | **OK — by design** (no dynamic roles; documented decision) |
| 4 | Hồ sơ võ sinh | V/C/E/D / V/C/E / V / V/E* | students module (ADMIN full); STUDENT self-edit `PATCH /students/me` (contact fields only — identity stays admin-managed) | students-roles e2e, matrix-completion e2e (self-edit, identity rejection) | **OK** |
| 5 | Quản lý Võ sư | V/C/E/D / V/C/E | Võ sư = ADMIN persona (AD-02); master accounts created via row 2 (role ADMIN) | admin-users suites | **OK — via ADMIN persona** |
| 6 | Quản lý Huấn luyện viên | V/C/E/D / V/C/E | INSTRUCTOR accounts creatable via `POST /users` (no longer seed-only) | matrix-completion e2e (create + login) | **OK** |
| 7 | Quản lý lớp học | V/C/E/D / V/C/E / V | classes module (ADMIN writes incl. capacity-shrink guard; any-authenticated reads) | classes-attendance e2e | **OK** |
| 8 | Phân lớp võ sinh | V/C/E/D / V/C/E / V | enrollments (ADMIN; capacity + same-day + duplicate guards; soft-leave) | classes-attendance e2e, db-integrity-races e2e | **OK** |
| 9 | Lịch tập | V/C/E/D / V/C/E / V/C/E / V | class_schedules (ADMIN writes; all roles read). HLV schedule writes remain ADMIN-only (plan §8) — instructor authority covers attendance, not timetable | classes-attendance e2e | **OK** (HLV C/E cell intentionally admin-only; documented) |
| 10 | Điểm danh | V/C/E/D / V/C/E / V/C/E / V | attendance sessions + bulk upsert (ADMIN + own-INSTRUCTOR); võ sinh reads own history/summary via guard 7.3 | classes-attendance e2e, S-04 | **OK** |
| 11 | Xin nghỉ | V/C/E/D / V/A / V/A / C | **NEW** `leave_requests` module: `POST /leave-requests` (STUDENT self / PARENT for child / ADMIN), `GET /leave-requests` (role-scoped), `POST /:id/review` (ADMIN + own-INSTRUCTOR), `POST /:id/cancel` (owner while PENDING), `DELETE /:id` (ADMIN); UQ(student, class, date) blocks duplicates | matrix-workflows e2e (create/duplicate/past-date/not-enrolled/approve/cancel/scope ×8), leaves.service.spec ×8 | **OK** |
| 12 | Đánh giá võ sinh | V/C/E/D / V/C/E / V/C/E / V | **NEW** `student_evaluations` module: `POST /evaluations` (ADMIN + own-INSTRUCTOR, rating 1–10 + period), `GET /evaluations?studentId=` (guard 7.3), `PATCH/DELETE` (author or ADMIN); UQ(student, author, period) | matrix-workflows e2e ×4, evaluations.service.spec ×6 | **OK** |
| 13 | Quản lý cấp đai | V/C/E/D / V/C/E / V/C/E / V | belts module (catalog CRUD ADMIN, all-role read). HLV C/E on ranks intentionally admin-only (catalog integrity, plan §8) | belts-exams e2e | **OK** (HLV C/E cell documented deviation) |
| 14 | Đề xuất thăng đai | V/C/E/D / V/C/E/A / V/C / V | **NEW** `promotion_proposals` module: `POST` (ADMIN + own-INSTRUCTOR, rank must be above current, one open proposal per student), `GET` (role-scoped), `PATCH` note (author, PENDING), `POST /:id/review` (ADMIN only). Approval is advisory — belts change only via exam RESULT_PASS | matrix-workflows e2e ×4, promotions.service.spec ×6 | **OK** |
| 15 | Kỳ thi thăng đai | V/C/E/D / V/C/E/A / V / V | exams module (lifecycle DRAFT→OPEN, deadline/capacity/rank checks; ADMIN manages, all roles browse) | belts-exams e2e | **OK** |
| 16 | Kết quả thi | V/C/E/D / V/C/E/A / V / V | result entry (ADMIN + INSTRUCTOR — wider than the matrix cell; PASS promotes rank with re-validation) | belts-exams e2e, db-integrity-races e2e | **OK** |
| 17 | Lịch sử cấp đai | V / V / V / V | **NEW** `GET /exam-registrations?studentId=` — full per-student exam/rank timeline (rank at registration, target, result), guard 7.3, paginated | matrix-completion e2e, matrix-workflows e2e | **OK** |
| 18 | Quản lý học phí | V/C/E/D / V / V / V | invoices role-scoped reads (ADMIN all; STUDENT own; PARENT children). HLV cell (V) deviates by design — instructors have zero financial surface (AD-06) | billing e2e | **OK** (HLV read intentionally excluded) |
| 19 | Tạo hóa đơn học phí | V/C/E/D / V/C / V | `POST /invoices` ADMIN (VND ints, discount ≤ subtotal), monthly close idempotent; võ sinh V = own invoices | billing e2e | **OK** |
| 20 | Thanh toán online | V / V / — / C/P | QR initiation (ADMIN/STUDENT/PARENT + guard 7.3), payOS adapter behind `PaymentGatewayPort`, webhook (Bank = external use case, HMAC) | billing e2e (S-03/S-11/DD-04), payos.gateway.spec ×11 | **OK** (real-rails demo pending owner payOS credentials) |
| 21 | Lịch sử giao dịch | V / V / — / V | `GET /payments?invoiceId=` role-scoped | billing e2e | **OK** |
| 22 | Xác nhận thanh toán | V/A / V/A / V/A | ADMIN confirm-cash (claim-first, audited) + auto webhook settlement. HLV cell deviates by design (AD-06: zero financial surface) | billing e2e | **OK** (HLV exclusion intentional) |
| 23 | Quản lý khuyến mãi | V/C/E/D / V | **NEW** `discount_codes` module: `GET/POST/PATCH/DELETE /discounts` (ADMIN) + application at invoice creation (`discountCode` → percent/amount, window + active checks, discount ≤ subtotal) | matrix-workflows e2e ×4 | **OK** |
| 24 | Thông báo | V/C/E/D / V/C/P / V/C/P / V | notifications outbox + INAPP feed (system-generated, admin flush) + announcements. **Updated:** INSTRUCTOR may now post/patch/delete CLASS-audience announcements for own classes (403 on club-wide, 404 foreign class); ADMIN full | announcements e2e, matrix-completion e2e, notifications-consent e2e | **OK** |
| 25 | Báo cáo võ sinh | V / V / V | student list/detail + per-student evaluations + belt history (guard 7.3) | students-roles e2e, matrix suites | **OK** |
| 26 | Báo cáo điểm danh | V / V / V / V | **NEW** `GET /admin/reports/attendance?month=` (ADMIN whole club; INSTRUCTOR own classes only; võ sinh V = own summary via `GET /attendance/summary`) | matrix-workflows e2e ×3 | **OK** |
| 27 | Báo cáo học phí | V / V / V / V | **NEW** `GET /admin/reports/tuition?month=&year=` (ADMIN: status totals + collected VND; võ sinh V = own invoices; HLV excluded per AD-06) | matrix-workflows e2e | **OK** (HLV read excluded by design) |
| 28 | Báo cáo thăng đai | V / V / V / V | **NEW** `GET /admin/reports/belts` (ADMIN club-wide; INSTRUCTOR own-class students; võ sinh V = own belt via profile/history) | matrix-workflows e2e ×3 | **OK** |
| 29 | Quản lý hệ thống | V/C/E/D | **NEW** `GET /admin/billing/settings`, `PUT …/tuition-rates` (class-id validated), `PUT …/bank-account` (owner_type BUSINESS enforced per plan §10) — no more direct-DB edits | matrix-completion e2e ×2 | **OK** |
| 30 | Audit Log | V / V / V | **NEW** `GET /admin/audit-log` (ADMIN, paginated, filter userId/event) + existing per-user `GET /auth/me/audit-log`. HLV cell deviates by design: audit rows contain other users' security data — ADMIN-only view | matrix-completion e2e | **OK** (HLV view excluded deliberately) |

External use case "Ngân hàng" (matrix note): implemented as the inbound HMAC-signed
webhook (`POST /payments/webhook/:provider`) + claim-first idempotent settlement — the
bank/gateway is outside the system boundary exactly as the matrix notes.

## 2. Thesis objective coverage (final)

- **Tra cứu nhanh lịch học / học phí / hoạt động CLB** — catalog reads (any role),
  role-scoped invoices, audience-scoped announcements: all green.
- **Phân tích nghiệp vụ / thiết kế hệ thống / CSDL** — PLAN.md + the four approved
  baselines + this reconciliation; 29 tables, replay-verified migrations.
- **Xây dựng chức năng** — matrix rows 1–30 above; 88 paths / 111 operations.
- **Thanh toán QR** — code-complete on payOS adapter (unit-verified vs SDK vectors);
  real-sandbox demo pending owner credentials.
- **Kiểm thử / triển khai thử nghiệm** — unit 359/359 (71 suites), e2e+security
  100/100 (17 suites), contract gate 0 errors, npm audit 0; deployment runbook
  `docs/DEPLOY_RENDER.md` (trial = owner action).
- **Sản phẩm:** mã nguồn ✓; backend API ✓; test reports ✓ (`FINAL_QA_REPORT.md`,
  `RELEASE_READINESS.md`, this file); website/giao diện quản trị = React project
  (separate); user guide to be authored from the API baseline (owner).
- **Phân quyền** — 4-role RBAC + ownership guard + serializer + ADMIN MFA enforcement;
  every route carries explicit `@Roles` or a documented self-scoped/service-guarded
  justification.

## 3. Contract and data changes in this increment

- Migration `20260924232722_add_matrix_completion_tables` (additive): `leave_requests`,
  `promotion_proposals`, `student_evaluations`, `discount_codes` + 2 enums → **29 tables**;
  CI assertion updated.
- OpenAPI: **88 paths / 111 operations** (was 67/81), regenerated, spectral 0 errors.
- New audit events: user_*, settings_updated, discount_code_*, leave_request_*,
  proposal_*, evaluation_*, student_profile_self_updated.
- Demo dataset: `SEED_DEMO_DATA=true npm run seed` — all-or-nothing idempotent block
  (accounts demo-admin/demo-instructor/demo-parent/demo-student @example.com, password
  `Demo#2026`, classes/schedules/enrollments/attendance/invoices/exam/evaluation/leave
  request/announcements/discount code). Never enable against a real club database.

## 4. Deliberate deviations from the matrix cells (documented, approved postures)

1. Võ sư has no dedicated role — ADMIN persona (AD-02); every "Võ sư V/C/E(A)" cell is
   satisfied through ADMIN.
2. HLV has zero financial surface (rows 18/22/27) and no rank-catalog/schedule/timetable
   writes (rows 9/13) — plan §7.4/§8, AD-06.
3. Row 3 dynamic roles/permissions are replaced by the fixed 4-role model (plan §4.2).
4. Row 30 audit view is ADMIN-only (HLV cell excluded — security data).
5. Minors act through PARENT accounts (column added to the matrix interpretation).
