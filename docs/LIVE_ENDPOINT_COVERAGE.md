# Live OpenAPI Endpoint & Operation Coverage

**Target Base URL**: `https://vovinamapinode.onrender.com`  
**Run ID**: `uat-mukgjip5-568eb4`  
**Execution Timestamp**: `2026-09-27T23:36:30.005Z`  
**Run Lifecycle Status**: `RUN ABORTED`  
**Cleanup Status**: `CLEANUP COMPLETED`  

## 1. Coverage Accounting Summary

| Metric | Count | Percentage |
|---|---|---|
| **Total OpenAPI Operations** | 111 | 100.0% |
| **Executed HTTP Requests** | 3 | 2.7% |
| **PASS (Executed + Successful Assertion)** | 3 | 2.7% |
| **FAIL (Executed + Failed Assertion)** | 0 | 0.0% |
| **BLOCKED (Cannot Safely Execute on Target)** | 0 | 0.0% |
| **MANUAL_REQUIRED (Requires External Actor / Fixture)** | 0 | 0.0% |
| **NOT_SAFE_TO_AUTOMATE (Protected Global Config)** | 0 | 0.0% |
| **UNCOVERED (No Workflow Defined)** | 108 | 97.3% |

## 2. Operations Traceability Matrix

| Method | Endpoint | Operation ID | Executed | Result | Status | Workflow / Notes |
|---|---|---|---|---|---|---|
| GET | `/api/v1/admin/audit-log` | `AdminUsersController_auditLog` | NO | **UNCOVERED** | N/A | System-wide audit log (ADMIN) |
| POST | `/api/v1/admin/billing/generate-monthly` | `BillingController_generateMonthly` | NO | **UNCOVERED** | N/A | Monthly tuition close (ADMIN) |
| GET | `/api/v1/admin/billing/settings` | `BillingController_getSettings` | NO | **UNCOVERED** | N/A | Read billing settings (ADMIN) |
| PUT | `/api/v1/admin/billing/settings/bank-account` | `BillingController_updateBankAccount` | NO | **UNCOVERED** | N/A | Set the receiving bank account (ADMIN) |
| PUT | `/api/v1/admin/billing/settings/tuition-rates` | `BillingController_updateTuitionRates` | NO | **UNCOVERED** | N/A | Replace tuition rates (ADMIN) |
| POST | `/api/v1/admin/notifications/flush` | `NotificationsController_flush` | NO | **UNCOVERED** | N/A | Flush the outbox (ADMIN) |
| GET | `/api/v1/admin/reports/attendance` | `AttendanceController_monthlyReport` | NO | **UNCOVERED** | N/A | Monthly attendance report |
| GET | `/api/v1/admin/reports/belts` | `BeltReportsController_distribution` | NO | **UNCOVERED** | N/A | Belt distribution report |
| GET | `/api/v1/admin/reports/revenue` | `BillingController_revenue` | NO | **UNCOVERED** | N/A | Revenue report (ADMIN) |
| GET | `/api/v1/admin/reports/tuition` | `BillingController_tuitionReport` | NO | **UNCOVERED** | N/A | Tuition close report (ADMIN) |
| GET | `/api/v1/announcements` | `AnnouncementsController_list` | NO | **UNCOVERED** | N/A | Announcement feed |
| POST | `/api/v1/announcements` | `AnnouncementsController_create` | NO | **UNCOVERED** | N/A | Publish an announcement |
| DELETE | `/api/v1/announcements/{id}` | `AnnouncementsController_remove` | NO | **UNCOVERED** | N/A | Delete an announcement |
| PATCH | `/api/v1/announcements/{id}` | `AnnouncementsController_update` | NO | **UNCOVERED** | N/A | Update an announcement |
| POST | `/api/v1/attendance-sessions` | `AttendanceController_createSession` | NO | **UNCOVERED** | N/A | Create an attendance session |
| GET | `/api/v1/attendance-sessions/{id}/records` | `AttendanceController_listRecords` | NO | **UNCOVERED** | N/A | List records of a session |
| POST | `/api/v1/attendance-sessions/{id}/records` | `AttendanceController_upsertRecords` | NO | **UNCOVERED** | N/A | Bulk-upsert attendance records |
| GET | `/api/v1/attendance/summary` | `AttendanceController_summary` | NO | **UNCOVERED** | N/A | Monthly attendance summary of a student |
| POST | `/api/v1/auth/change-email/confirm` | `AuthController_confirmChangeEmail` | NO | **UNCOVERED** | N/A | Confirm the email change |
| POST | `/api/v1/auth/change-email/request` | `AuthController_requestChangeEmail` | NO | **UNCOVERED** | N/A | Request an email change |
| POST | `/api/v1/auth/change-password` | `AuthController_changePassword` | NO | **UNCOVERED** | N/A | Change own password |
| POST | `/api/v1/auth/deactivate` | `AuthController_deactivate` | NO | **UNCOVERED** | N/A | Deactivate own account |
| POST | `/api/v1/auth/forgot-password` | `AuthController_forgotPassword` | NO | **UNCOVERED** | N/A | Request a password reset |
| POST | `/api/v1/auth/login` | `AuthController_login` | NO | **UNCOVERED** | N/A | Log in (password, optional MFA) |
| POST | `/api/v1/auth/logout` | `AuthController_logout` | NO | **UNCOVERED** | N/A | Log out the current device |
| POST | `/api/v1/auth/logout-all` | `AuthController_logoutAll` | NO | **UNCOVERED** | N/A | Log out every device |
| DELETE | `/api/v1/auth/me` | `AuthController_deactivateViaDelete` | NO | **UNCOVERED** | N/A | Delete own account (alias of deactivate) |
| GET | `/api/v1/auth/me` | `AuthController_me` | NO | **UNCOVERED** | N/A | Current account |
| GET | `/api/v1/auth/me/audit-log` | `AuthController_auditLog` | NO | **UNCOVERED** | N/A | Own security audit log |
| POST | `/api/v1/auth/mfa/login-verify` | `AuthController_mfaLoginVerify` | NO | **UNCOVERED** | N/A | Complete MFA login |
| GET | `/api/v1/auth/mfa/methods` | `AuthController_mfaMethods` | NO | **UNCOVERED** | N/A | List enrolled MFA methods |
| POST | `/api/v1/auth/mfa/totp/disable` | `AuthController_totpDisable` | NO | **UNCOVERED** | N/A | Disable TOTP MFA |
| POST | `/api/v1/auth/mfa/totp/enable` | `AuthController_totpEnable` | NO | **UNCOVERED** | N/A | Start TOTP enrollment |
| GET | `/api/v1/auth/mfa/totp/recovery-codes` | `AuthController_recoveryCodes` | NO | **UNCOVERED** | N/A | Recovery codes remaining |
| POST | `/api/v1/auth/mfa/totp/validate` | `AuthController_totpValidate` | NO | **UNCOVERED** | N/A | Validate a TOTP code |
| POST | `/api/v1/auth/mfa/totp/verify` | `AuthController_totpVerify` | NO | **UNCOVERED** | N/A | Confirm TOTP enrollment |
| POST | `/api/v1/auth/refresh-token` | `AuthController_refreshToken` | NO | **UNCOVERED** | N/A | Rotate the refresh token |
| POST | `/api/v1/auth/register` | `AuthController_register` | NO | **UNCOVERED** | N/A | Register a STUDENT or PARENT account |
| POST | `/api/v1/auth/resend-verification` | `AuthController_resendVerification` | NO | **UNCOVERED** | N/A | Resend the verification email |
| POST | `/api/v1/auth/reset-password` | `AuthController_resetPassword` | NO | **UNCOVERED** | N/A | Reset the password with the emailed token |
| GET | `/api/v1/auth/sessions` | `AuthController_sessions` | NO | **UNCOVERED** | N/A | List active sessions |
| DELETE | `/api/v1/auth/sessions/{id}` | `AuthController_revokeSession` | NO | **UNCOVERED** | N/A | Revoke one session |
| POST | `/api/v1/auth/verify-email` | `AuthController_verifyEmail` | NO | **UNCOVERED** | N/A | Verify the email address |
| GET | `/api/v1/belt-exams` | `ExamsController_list` | NO | **UNCOVERED** | N/A | List belt exams |
| POST | `/api/v1/belt-exams` | `ExamsController_create` | NO | **UNCOVERED** | N/A | Create a belt exam (ADMIN) |
| GET | `/api/v1/belt-exams/{id}` | `ExamsController_getById` | NO | **UNCOVERED** | N/A | Belt exam detail |
| PATCH | `/api/v1/belt-exams/{id}` | `ExamsController_update` | NO | **UNCOVERED** | N/A | Update a belt exam (ADMIN) |
| POST | `/api/v1/belt-exams/{id}/register` | `ExamsController_register` | NO | **UNCOVERED** | N/A | Register a student for an exam |
| GET | `/api/v1/belt-ranks` | `BeltsController_list` | NO | **UNCOVERED** | N/A | List belt ranks |
| POST | `/api/v1/belt-ranks` | `BeltsController_create` | NO | **UNCOVERED** | N/A | Create a belt rank (ADMIN) |
| PATCH | `/api/v1/belt-ranks/{id}` | `BeltsController_update` | NO | **UNCOVERED** | N/A | Update a belt rank (ADMIN) |
| GET | `/api/v1/classes` | `ClassesController_list` | NO | **UNCOVERED** | N/A | List classes |
| POST | `/api/v1/classes` | `ClassesController_create` | NO | **UNCOVERED** | N/A | Create a class (ADMIN) |
| GET | `/api/v1/classes/{id}` | `ClassesController_getById` | NO | **UNCOVERED** | N/A | Class detail |
| PATCH | `/api/v1/classes/{id}` | `ClassesController_update` | NO | **UNCOVERED** | N/A | Update a class (ADMIN) |
| POST | `/api/v1/classes/{id}/schedules` | `ClassesController_addSchedule` | NO | **UNCOVERED** | N/A | Add a weekly schedule slot (ADMIN) |
| DELETE | `/api/v1/classes/{id}/schedules/{scheduleId}` | `ClassesController_removeSchedule` | NO | **UNCOVERED** | N/A | Remove a schedule slot (ADMIN) |
| POST | `/api/v1/consent` | `ConsentController_grant` | NO | **UNCOVERED** | N/A | Grant a consent purpose |
| GET | `/api/v1/consent/me` | `ConsentController_history` | NO | **UNCOVERED** | N/A | Own consent history |
| POST | `/api/v1/consent/revoke` | `ConsentController_revoke` | NO | **UNCOVERED** | N/A | Revoke a consent purpose |
| GET | `/api/v1/discounts` | `BillingController_listDiscounts` | NO | **UNCOVERED** | N/A | List discount codes (ADMIN) |
| POST | `/api/v1/discounts` | `BillingController_createDiscount` | NO | **UNCOVERED** | N/A | Create a discount code (ADMIN) |
| DELETE | `/api/v1/discounts/{id}` | `BillingController_deleteDiscount` | NO | **UNCOVERED** | N/A | Delete a discount code (ADMIN) |
| PATCH | `/api/v1/discounts/{id}` | `BillingController_updateDiscount` | NO | **UNCOVERED** | N/A | Update a discount code (ADMIN) |
| GET | `/api/v1/enrollments` | `EnrollmentsController_list` | NO | **UNCOVERED** | N/A | List enrollments (ADMIN) |
| POST | `/api/v1/enrollments` | `EnrollmentsController_create` | NO | **UNCOVERED** | N/A | Enroll a student (ADMIN) |
| DELETE | `/api/v1/enrollments/{id}` | `EnrollmentsController_remove` | NO | **UNCOVERED** | N/A | Remove an enrollment (ADMIN) |
| GET | `/api/v1/evaluations` | `EvaluationsController_listForStudent` | NO | **UNCOVERED** | N/A | List evaluations of a student |
| POST | `/api/v1/evaluations` | `EvaluationsController_create` | NO | **UNCOVERED** | N/A | Record a student evaluation |
| DELETE | `/api/v1/evaluations/{id}` | `EvaluationsController_delete` | NO | **UNCOVERED** | N/A | Delete an evaluation |
| PATCH | `/api/v1/evaluations/{id}` | `EvaluationsController_update` | NO | **UNCOVERED** | N/A | Update an evaluation |
| GET | `/api/v1/exam-registrations` | `ExamsController_listStudentRegistrations` | NO | **UNCOVERED** | N/A | Exam history of a student |
| POST | `/api/v1/exam-registrations/{id}/result` | `ExamsController_recordResult` | NO | **UNCOVERED** | N/A | Record an exam result |
| GET | `/api/v1/invoices` | `BillingController_list` | NO | **UNCOVERED** | N/A | List invoices |
| POST | `/api/v1/invoices` | `BillingController_create` | NO | **UNCOVERED** | N/A | Issue a manual invoice (ADMIN) |
| GET | `/api/v1/invoices/{id}` | `BillingController_getById` | NO | **UNCOVERED** | N/A | Invoice detail |
| GET | `/api/v1/leave-requests` | `LeavesController_list` | NO | **UNCOVERED** | N/A | List leave requests |
| POST | `/api/v1/leave-requests` | `LeavesController_create` | NO | **UNCOVERED** | N/A | Request an absence |
| DELETE | `/api/v1/leave-requests/{id}` | `LeavesController_delete` | NO | **UNCOVERED** | N/A | Delete a leave request (ADMIN) |
| POST | `/api/v1/leave-requests/{id}/cancel` | `LeavesController_cancel` | NO | **UNCOVERED** | N/A | Cancel a leave request |
| POST | `/api/v1/leave-requests/{id}/review` | `LeavesController_review` | NO | **UNCOVERED** | N/A | Review a leave request |
| PATCH | `/api/v1/notifications/{id}/read` | `NotificationsController_markRead` | NO | **UNCOVERED** | N/A | Mark a notification read |
| GET | `/api/v1/notifications/me` | `NotificationsController_feed` | NO | **UNCOVERED** | N/A | Own notification feed |
| POST | `/api/v1/parents/link` | `ParentsController_linkChild` | NO | **UNCOVERED** | N/A | Link a child by invite code (PARENT) |
| DELETE | `/api/v1/parents/links/{studentId}` | `ParentsController_unlink` | NO | **UNCOVERED** | N/A | Unlink a child (PARENT) |
| GET | `/api/v1/parents/me/children` | `ParentsController_myChildren` | NO | **UNCOVERED** | N/A | List linked children (PARENT) |
| GET | `/api/v1/payments` | `PaymentsController_listForInvoice` | NO | **UNCOVERED** | N/A | Payment history of an invoice |
| PATCH | `/api/v1/payments/{id}` | `PaymentsController_setOutcome` | NO | **UNCOVERED** | N/A | Refund or dispute a payment (ADMIN) |
| POST | `/api/v1/payments/{invoiceId}/confirm-cash` | `PaymentsController_confirmCash` | NO | **UNCOVERED** | N/A | Confirm a cash payment (ADMIN) |
| POST | `/api/v1/payments/qr/{invoiceId}` | `PaymentsController_createQrPayment` | NO | **UNCOVERED** | N/A | Start a QR payment for an invoice |
| POST | `/api/v1/payments/webhook/{provider}` | `PaymentsController_webhook` | NO | **UNCOVERED** | N/A | Payment gateway webhook (public, HMAC-signed) |
| GET | `/api/v1/promotion-proposals` | `PromotionsController_list` | NO | **UNCOVERED** | N/A | List promotion proposals |
| POST | `/api/v1/promotion-proposals` | `PromotionsController_create` | NO | **UNCOVERED** | N/A | Propose a promotion |
| PATCH | `/api/v1/promotion-proposals/{id}` | `PromotionsController_updateNote` | NO | **UNCOVERED** | N/A | Edit a proposal note |
| POST | `/api/v1/promotion-proposals/{id}/review` | `PromotionsController_review` | NO | **UNCOVERED** | N/A | Review a promotion proposal (ADMIN) |
| GET | `/api/v1/students` | `StudentsController_list` | NO | **UNCOVERED** | N/A | List student profiles |
| POST | `/api/v1/students` | `StudentsController_create` | NO | **UNCOVERED** | N/A | Create a student profile (ADMIN) |
| DELETE | `/api/v1/students/{id}` | `StudentsController_softDelete` | NO | **UNCOVERED** | N/A | Soft-delete a student profile (ADMIN) |
| GET | `/api/v1/students/{id}` | `StudentsController_getById` | NO | **UNCOVERED** | N/A | Student profile detail |
| PATCH | `/api/v1/students/{id}` | `StudentsController_update` | NO | **UNCOVERED** | N/A | Update a student profile (ADMIN) |
| GET | `/api/v1/students/{id}/attendance` | `AttendanceController_history` | NO | **UNCOVERED** | N/A | Attendance history of a student |
| POST | `/api/v1/students/{id}/invite-code` | `StudentsController_regenerateInviteCode` | NO | **UNCOVERED** | N/A | Regenerate the parent invite code (ADMIN) |
| GET | `/api/v1/students/me` | `StudentsController_me` | NO | **UNCOVERED** | N/A | Own student profile (STUDENT) |
| PATCH | `/api/v1/students/me` | `StudentsController_updateOwn` | NO | **UNCOVERED** | N/A | Edit own contact details (STUDENT) |
| GET | `/api/v1/users` | `AdminUsersController_list` | NO | **UNCOVERED** | N/A | List user accounts (ADMIN) |
| POST | `/api/v1/users` | `AdminUsersController_create` | NO | **UNCOVERED** | N/A | Create a user account (ADMIN) |
| DELETE | `/api/v1/users/{id}` | `AdminUsersController_deactivate` | NO | **UNCOVERED** | N/A | Deactivate a user account (ADMIN) |
| PATCH | `/api/v1/users/{id}` | `AdminUsersController_update` | NO | **UNCOVERED** | N/A | Update a user account (ADMIN) |
| GET | `/healthz` | `HealthController_getLiveness` | YES | **PASS** | 200 | GET /healthz liveness probe |
| GET | `/metrics` | `MetricsController_getMetrics` | YES | **PASS** | 401 | GET /metrics without token returns 401 |
| GET | `/readyz` | `HealthController_getReadiness` | YES | **PASS** | 200 | GET /readyz readiness probe |
