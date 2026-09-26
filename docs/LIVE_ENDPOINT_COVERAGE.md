# Live Endpoint Coverage (111 Operations)

Base URL: https://vovinamapinode.onrender.com
Execution Timestamp: 2026-09-26T08:30:06.699Z
Run ID: live-uat-1790411258051
Total OpenAPI Operations: 111
Covered Operations: 111 / 111 (100%)

| Method | Endpoint | Workflow | Result | Status | Notes |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/audit-log` | Admin audit log GET /admin/audit-log | **PASS** | 200 | Audit total: 451 |
| POST | `/api/v1/admin/billing/generate-monthly` | Generate monthly invoices POST /admin/billing/generate-monthly | **PASS** | 200 | Generated: 0, Skipped: 2 |
| GET | `/api/v1/admin/billing/settings` | Get billing settings GET /admin/billing/settings | **PASS** | 200 | Settings retrieved |
| PUT | `/api/v1/admin/billing/settings/bank-account` | Update bank account PUT /admin/billing/settings/bank-account | **PASS** | 200 | Bank account updated |
| PUT | `/api/v1/admin/billing/settings/tuition-rates` | Update tuition rates PUT /admin/billing/settings/tuition-rates | **PASS** | 200 | Tuition rates updated |
| POST | `/api/v1/admin/notifications/flush` | Admin flushes notifications outbox POST /admin/notifications/flush | **PASS** | 200 | Flushed: true |
| GET | `/api/v1/admin/reports/attendance` | Attendance monthly report GET /admin/reports/attendance | **PASS** | 200 | Classes reported: 6 |
| GET | `/api/v1/admin/reports/belts` | Belt distribution report GET /admin/reports/belts | **PASS** | 200 | Distribution items: 18 |
| GET | `/api/v1/admin/reports/revenue` | Revenue report GET /admin/reports/revenue | **PASS** | 200 | Revenue report generated |
| GET | `/api/v1/admin/reports/tuition` | Tuition report GET /admin/reports/tuition | **PASS** | 200 | Tuition report generated |
| GET | `/api/v1/announcements` | Student feed shows announcement GET /announcements | **PASS** | 200 | Club-wide announcement visible in feed |
| POST | `/api/v1/announcements` | Admin posts club-wide announcement POST /announcements | **PASS** | 201 | Announcement ID: b32b86bb-d0f3-497e-9d2d-6fef321d4cb2 |
| DELETE | `/api/v1/announcements/{id}` | Delete announcement DELETE /announcements/:id | **PASS** | 200 | Announcement deleted |
| PATCH | `/api/v1/announcements/{id}` | Update announcement PATCH /announcements/:id | **PASS** | 200 | Title updated |
| POST | `/api/v1/attendance-sessions` | Create attendance session POST /attendance-sessions | **PASS** | 201 | Session ID: 36b2bc5b-78c1-491b-b71f-8427e5f07bed |
| GET | `/api/v1/attendance-sessions/{id}/records` | List attendance records GET /attendance-sessions/:id/records | **PASS** | 200 | Records count: undefined |
| POST | `/api/v1/attendance-sessions/{id}/records` | Bulk upsert attendance records POST /attendance-sessions/:id/records | **PASS** | 200 | Upserted records |
| GET | `/api/v1/attendance/summary` | Attendance summary GET /attendance/summary | **PASS** | 200 | Total: undefined |
| POST | `/api/v1/auth/change-email/confirm` | Change email confirm invalid token | **PASS** | 400 | Invalid token rejected |
| POST | `/api/v1/auth/change-email/request` | 13. Change email request | **PASS** | 201 | Change email requested (201) |
| POST | `/api/v1/auth/change-password` | 11. Change password wrong current password rejected (401) | **PASS** | 401 | Current password check verified 401 |
| POST | `/api/v1/auth/deactivate` | Deactivate account POST /auth/deactivate | **PASS** | 200 | Account deactivated |
| POST | `/api/v1/auth/forgot-password` | 12. Password reset request anti-enumeration | **PASS** | 200 | {sent: true} returned |
| POST | `/api/v1/auth/login` | Student login | **PASS** | 200 | Student session created |
| POST | `/api/v1/auth/logout` | 8. Logout POST /auth/logout | **PASS** | 200 | Session logged out |
| POST | `/api/v1/auth/logout-all` | 10. Logout all sessions POST /auth/logout-all | **PASS** | 200 | All parent sessions revoked |
| DELETE | `/api/v1/auth/me` | DELETE /auth/me self-deactivation | **PASS** | 200 | User soft deleted via DELETE /me |
| GET | `/api/v1/auth/me` | 4. Authenticated GET /auth/me | **PASS** | 200 | Role: STUDENT |
| GET | `/api/v1/auth/me/audit-log` | GET /auth/me/audit-log | **PASS** | 200 | Audit entries: 20 |
| POST | `/api/v1/auth/mfa/login-verify` | 16. MFA Login with recovery code POST /auth/mfa/login-verify | **PASS** | 200 | Authenticated via recovery code |
| GET | `/api/v1/auth/mfa/methods` | GET /auth/mfa/methods | **PASS** | 200 | TOTP enabled=true |
| POST | `/api/v1/auth/mfa/totp/disable` | POST /auth/mfa/totp/disable | **PASS** | 201 | TOTP disabled |
| POST | `/api/v1/auth/mfa/totp/enable` | 15. MFA Enable TOTP POST /auth/mfa/totp/enable | **PASS** | 201 | Secret generated |
| GET | `/api/v1/auth/mfa/totp/recovery-codes` | 18. GET /auth/mfa/totp/recovery-codes | **PASS** | 200 | Remaining: 10 |
| POST | `/api/v1/auth/mfa/totp/validate` | POST /auth/mfa/totp/validate | **PASS** | 200 | TOTP validated |
| POST | `/api/v1/auth/mfa/totp/verify` | Verify valid TOTP code POST /auth/mfa/totp/verify | **PASS** | 201 | 10 recovery codes generated |
| POST | `/api/v1/auth/refresh-token` | 6. Refresh token rotation POST /auth/refresh-token | **PASS** | 200 | Rotated refresh token returned |
| POST | `/api/v1/auth/register` | 1. Register new student account | **PASS** | 201 | Requires verification returned |
| POST | `/api/v1/auth/resend-verification` | Resend email verification | **PASS** | 200 | Anti-enumeration 200 returned |
| POST | `/api/v1/auth/reset-password` | Reset password invalid token rejection | **PASS** | 400 | Rejected bad reset token |
| GET | `/api/v1/auth/sessions` | 5. Session listing GET /auth/sessions | **PASS** | 200 | Active sessions: 2 |
| DELETE | `/api/v1/auth/sessions/{id}` | Revoke single session DELETE /auth/sessions/:id | **PASS** | 200 | Session revoked |
| POST | `/api/v1/auth/verify-email` | 14. Email verification with invalid token | **PASS** | 400 | Invalid token rejected (Real inbox consumption is MANUAL_REQUIRED) |
| GET | `/api/v1/belt-exams` | List exams GET /belt-exams | **PASS** | 200 | Total exams: 5 |
| POST | `/api/v1/belt-exams` | Admin creates exam POST /belt-exams | **PASS** | 201 | Exam ID: f31f9384-17db-4ad0-9e32-6ba1eea790f5 |
| GET | `/api/v1/belt-exams/{id}` | Get exam detail GET /belt-exams/:id | **PASS** | 200 | Exam detail verified |
| PATCH | `/api/v1/belt-exams/{id}` | Open exam for registration PATCH /belt-exams/:id | **PASS** | 200 | Status=OPEN |
| POST | `/api/v1/belt-exams/{id}/register` | Student registers for exam POST /belt-exams/:id/register (Atomic invoice created) | **PASS** | 201 | Reg ID: 4fdf0d98-ab7e-413e-bb35-6f60e5bb38f0, Invoice ID: 1bad0341-1714-4a22-b1b8-cf0de20d1788 |
| GET | `/api/v1/belt-ranks` | Belt rank catalog GET /belt-ranks | **PASS** | 200 | Ranks: 17 |
| POST | `/api/v1/belt-ranks` | Admin creates belt rank POST /belt-ranks | **PASS** | 201 | Rank ID: 20 |
| PATCH | `/api/v1/belt-ranks/{id}` | Admin updates belt rank PATCH /belt-ranks/:id | **PASS** | 200 | Rank updated |
| GET | `/api/v1/classes` | List classes GET /classes | **PASS** | 200 | Classes total: 6 |
| POST | `/api/v1/classes` | Admin creates class POST /classes | **PASS** | 201 | Class ID: 35fb1206-dd79-4cb1-886f-842b4b43277c |
| GET | `/api/v1/classes/{id}` | Read class detail GET /classes/:id | **PASS** | 200 | Class detail verified |
| PATCH | `/api/v1/classes/{id}` | Update class PATCH /classes/:id | **PASS** | 200 | Capacity updated to 15 |
| POST | `/api/v1/classes/{id}/schedules` | Add class schedule POST /classes/:id/schedules | **PASS** | 201 | Schedule ID: 43e770bd-2496-462b-b3de-c731fab9a1ec |
| DELETE | `/api/v1/classes/{id}/schedules/{scheduleId}` | Remove class schedule DELETE /classes/:id/schedules/:scheduleId | **PASS** | 200 | Schedule removed |
| POST | `/api/v1/consent` | Student grants consent POST /consent | **PASS** | 201 | Consent granted |
| GET | `/api/v1/consent/me` | Consent history GET /consent/me | **PASS** | 200 | Active consents: 3 |
| POST | `/api/v1/consent/revoke` | Revoke consent POST /consent/revoke | **PASS** | 200 | Consent revoked |
| GET | `/api/v1/discounts` | List discounts GET /discounts | **PASS** | 200 | Discounts count: 2 |
| POST | `/api/v1/discounts` | Admin creates discount code POST /discounts | **PASS** | 201 | Code: UAT395600, ID: 1180f29d-0d97-4f54-b3ef-5c7227b93348 |
| DELETE | `/api/v1/discounts/{id}` | Delete discount code DELETE /discounts/:id | **PASS** | 200 | Discount deleted |
| PATCH | `/api/v1/discounts/{id}` | Update discount code PATCH /discounts/:id | **PASS** | 200 | Discount deactivated |
| GET | `/api/v1/enrollments` | List enrollments GET /enrollments | **PASS** | 200 | Enrolled count: 1 |
| POST | `/api/v1/enrollments` | Enroll student in class POST /enrollments | **PASS** | 201 | Enrollment ID: 93b01792-8cb9-4f69-b503-04dd9d96a6db |
| DELETE | `/api/v1/enrollments/{id}` | Soft leave enrollment DELETE /enrollments/:id | **PASS** | 200 | Left class (soft leave) |
| GET | `/api/v1/evaluations` | List evaluations for student GET /evaluations | **PASS** | 200 | Evaluations count: 2 |
| POST | `/api/v1/evaluations` | Instructor creates evaluation POST /evaluations | **PASS** | 201 | Eval ID: 1de79bcf-baae-4d66-88e0-18e794117f99 |
| DELETE | `/api/v1/evaluations/{id}` | Author deletes evaluation DELETE /evaluations/:id | **PASS** | 200 | Evaluation deleted |
| PATCH | `/api/v1/evaluations/{id}` | Author updates evaluation PATCH /evaluations/:id | **PASS** | 200 | Comment updated |
| GET | `/api/v1/exam-registrations` | List student exam registrations GET /exam-registrations | **PASS** | 200 | Registrations: 4 |
| POST | `/api/v1/exam-registrations/{id}/result` | Record exam result PASS POST /exam-registrations/:id/result | **PASS** | 200 | Result PASS recorded and rank promoted |
| GET | `/api/v1/invoices` | List invoices GET /invoices | **PASS** | 200 | Invoices total: 9 |
| POST | `/api/v1/invoices` | Admin creates invoice POST /invoices | **PASS** | 201 | Invoice ID: d7b10780-b9c5-4ea1-9639-8afbcca67268, No: INV-2026-0009 |
| GET | `/api/v1/invoices/{id}` | Get invoice detail GET /invoices/:id | **PASS** | 200 | Total: 450000 |
| GET | `/api/v1/leave-requests` | List leave requests GET /leave-requests | **PASS** | 200 | Leaves count: 3 |
| POST | `/api/v1/leave-requests` | Student creates leave request POST /leave-requests | **PASS** | 201 | Leave ID: 6925346f-45fb-4902-9031-c3c85fa3def6 |
| DELETE | `/api/v1/leave-requests/{id}` | Admin deletes leave request DELETE /leave-requests/:id | **PASS** | 200 | Deleted |
| POST | `/api/v1/leave-requests/{id}/cancel` | Requester cancels pending leave POST /leave-requests/:id/cancel | **PASS** | 200 | Leave CANCELLED |
| POST | `/api/v1/leave-requests/{id}/review` | Instructor reviews leave request POST /leave-requests/:id/review | **PASS** | 200 | Leave APPROVED |
| PATCH | `/api/v1/notifications/{id}/read` | Mark notification read PATCH /notifications/:id/read | **PASS** | 200 | Marked read |
| GET | `/api/v1/notifications/me` | Notifications feed GET /notifications/me | **PASS** | 200 | Notifications: 8 |
| POST | `/api/v1/parents/link` | Parent claims child invite code POST /parents/link | **PASS** | 201 | Child linked |
| DELETE | `/api/v1/parents/links/{studentId}` | Unlinking verified child requires club (409 Conflict) | **PASS** | 409 | Verified child link protected by club policy |
| GET | `/api/v1/parents/me/children` | Parent child listing GET /parents/me/children | **PASS** | 200 | Children count: 3 |
| GET | `/api/v1/payments` | List payments for invoice GET /payments | **PASS** | 200 | Payments count: 1 |
| PATCH | `/api/v1/payments/{id}` | Admin refunds payment PATCH /payments/:id | **PASS** | 200 | Payment REFUNDED, invoice re-derives to UNPAID |
| POST | `/api/v1/payments/{invoiceId}/confirm-cash` | Confirm cash payment POST /payments/:invoiceId/confirm-cash | **PASS** | 200 | Payment created with status SUCCESS |
| POST | `/api/v1/payments/qr/{invoiceId}` | Create QR payment POST /payments/qr/:invoiceId | **PASS** | 201 | Order ref: VVC74YKLQQ |
| POST | `/api/v1/payments/webhook/{provider}` | Webhook invalid signature rejected 401 | **PASS** | 401 | Unauthorized on bad HMAC signature |
| GET | `/api/v1/promotion-proposals` | List promotion proposals GET /promotion-proposals | **PASS** | 200 | Proposals total: 5 |
| POST | `/api/v1/promotion-proposals` | Instructor proposes next rank POST /promotion-proposals | **PASS** | 201 | Proposal ID: fcf34cbb-5a95-4ab3-8df5-b9c5ff73dca7 |
| PATCH | `/api/v1/promotion-proposals/{id}` | Author edits proposal note PATCH /promotion-proposals/:id | **PASS** | 200 | Note updated |
| POST | `/api/v1/promotion-proposals/{id}/review` | Master approves proposal POST /promotion-proposals/:id/review | **PASS** | 200 | Proposal APPROVED |
| GET | `/api/v1/students` | Admin lists students | **PASS** | 200 | Total students: 8 |
| POST | `/api/v1/students` | Admin creates synthetic student | **PASS** | 201 | ID: 45b55921-2fc5-464f-9eb5-2cf39bf77bdb |
| DELETE | `/api/v1/students/{id}` | Admin soft-deletes synthetic student | **PASS** | 200 | Soft-deleted |
| GET | `/api/v1/students/{id}` | Admin reads student detail | **PASS** | 200 | Detail matches created data |
| PATCH | `/api/v1/students/{id}` | Admin updates student fields | **PASS** | 200 | Updated medical notes verified |
| GET | `/api/v1/students/{id}/attendance` | Student attendance history GET /students/:id/attendance | **PASS** | 200 | History records: 4 |
| POST | `/api/v1/students/{id}/invite-code` | Admin generates invite-code for student | **PASS** | 200 | Invite code: VYNVKPBS |
| GET | `/api/v1/students/me` | Student views self GET /students/me | **PASS** | 200 | Student name: Le Van Tuan |
| PATCH | `/api/v1/students/me` | Student edits allowed contact fields PATCH /students/me | **PASS** | 200 | Self-contact update verified |
| GET | `/api/v1/users` | Admin lists users GET /users | **PASS** | 200 | Total users: 22 |
| POST | `/api/v1/users` | Admin creates user POST /users | **PASS** | 201 | User ID: 9cd153d3-0bcd-4d76-96a4-f969b7e66dbb |
| DELETE | `/api/v1/users/{id}` | Admin deactivates user DELETE /users/:id | **PASS** | 200 | User deactivated |
| PATCH | `/api/v1/users/{id}` | Admin updates user role PATCH /users/:id | **PASS** | 200 | Role changed to STUDENT |
| GET | `/healthz` | GET /healthz liveness | **PASS** | 200 | Latency: 85ms |
| GET | `/metrics` | GET /metrics without token returns 401 | **PASS** | 401 | Protected metrics endpoint |
| GET | `/readyz` | GET /readyz readiness | **PASS** | 200 | Latency: 84ms, DB: up |
