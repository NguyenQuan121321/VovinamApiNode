# Frontend integration

The frontend is developed separately. Use committed openapi.json as the API contract; runtime Swagger at /docs is available only when intentionally enabled. The contract currently contains 89 paths and 112 operations. Existing API routes keep the /api/v1 prefix; /version, /healthz, /readyz and /metrics are root operational routes.

## Acceptance remediation changes

| API | Frontend behavior |
|---|---|
| GET /version | Public normal envelope with data.commit (full Git SHA or null); useful for matching a deployed backend release |
| POST /api/v1/payments/qr/{invoiceId} | A new request supersedes the previous pending QR; display the newest returned paymentId, orderRef and expiry |
| POST /api/v1/invoices | Item products, subtotal and final amounts must fit 0..2147483647 VND; overflow is a validation error (400), not 500 |
| PATCH /api/v1/payments/{id} | ADMIN only, with normal MFA; SUCCESS may become DISPUTED or REFUNDED, and DISPUTED may become REFUNDED; incompatible transitions return 409 |
| GET /api/v1/payments?invoiceId=... | Show retained payment history and reconciliation notes; DISPUTED is not successful settlement |

A QR's expiry is enforced for automatic settlement. A late or superseded real receipt is retained as DISPUTED for administrator reconciliation. A provider redirect is never proof that an invoice is paid; fetch invoice/payment state from the backend after the provider callback. The refund mutation records an external refund and does not transfer money.

## Authentication and permissions

Keep access/refresh tokens out of URLs, logs and committed files. Follow the documented MFA-required login response and verify MFA through the normal endpoints. An ADMIN needs TOTP enrollment before administrative business endpoints. Do not treat a 403 as permission to fall back to a weaker route.

Only adults in the permitted STUDENT/PARENT roles self-register; instructors are managed by administrators. Use normal email verification/reset workflows. Production onboarding requires actual deliverable email. Uniform auth responses intentionally do not reveal whether an email exists. Handle 400, 401, 403, 404, 409 and 429 using their documented envelopes.

Configure exact browser origins through CORS_ALLOWED_ORIGINS after the frontend URLs are known. Role-scoped serializers and ownership checks determine the fields/resources visible to each actor; the frontend must not infer missing sensitive fields from another role. Do not hard-code club bank details, tuition rates or provider credentials: use authorized settings/read APIs.

Notification status SENT means the delivery adapter accepted the message, not that a user read an email. INAPP read state is separate. Failed email delivery is retried by the backend. No frontend polling endpoint was added for internal worker leases or secret transport configuration.
