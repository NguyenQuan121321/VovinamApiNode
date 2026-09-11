# TASK-01 — Billing and Payments

## Objective

Verify and complete the billing/payment subsystem (P4). This phase is largely implemented; the task is completion of verified gaps and repair of verified defects — not a rebuild.

## Preserve the existing implementation

The repository already contains a working P4 implementation: role-scoped invoice CRUD, idempotent monthly tuition generation, a `PaymentGatewayPort` with a simulated adapter, HMAC webhook verification over the raw body with claim-first idempotency, the exact-amount rule, CASH confirmation, refund/dispute outcomes, a revenue report, and the overdue-aging job.

You MUST preserve this implementation. Repair only defects you have verified by reading the code and proving them with a failing test or a concrete traceable scenario. Do not redesign, rename, or re-implement working parts without evidence of a defect.

Known pending item: `PAYMENTS_GATEWAY=payos|sepay` adapters fail fast at boot until real credentials exist. Implement a real adapter only when verified credentials and the provider's current API documentation are available; otherwise leave the fail-fast behavior intact. Never fabricate credentials.

## Scope — verify, complete, or repair

- invoices: issue, list (role-scoped), detail (ownership guard), items, totals in VND integers
- monthly tuition: `POST /admin/billing/generate-monthly` idempotency via the period unique key; per-class rates from `app_settings.tuition_rates`; skipped-class reporting
- QR payment: initiation with ownership and payable-status checks, unique `order_ref`, expiry handling, payment status lookup
- payment gateway abstraction: `PaymentGatewayPort` respected; adapters isolated and swappable
- webhook signature verification: constant-time HMAC over the exact raw body; 401 only on bad signature
- idempotency: claim-first processing backed by the `gateway_txn_id` unique constraint; duplicate and parallel webhooks process exactly once, all answering 200
- exact amount validation: mismatch never marks paid; flags for manual review (DISPUTED) with an audit event
- CASH: ADMIN-only confirmation, idempotent, audited
- refund/dispute: outcome transitions re-derive invoice state correctly
- revenue reporting: SUCCESS payments grouped by month/channel, access-controlled
- overdue state: UNPAID -> OVERDUE daily job correctness
- financial audit events: issuance, confirmation, settlement, refund, dispute, flags
- financial data integrity: FK RESTRICT on the financial chain, no hard deletes, invoice state derived from persisted transactions
- billing OpenAPI documentation: decorators current, `openapi.json` regenerated and linted

## Financial invariants (must hold after this task)

- Amounts come from persisted invoice/payment data, never from client-provided values.
- Webhook authenticity is verified before any business processing.
- A payment is marked successful only on an exact amount match.
- Duplicate and concurrent webhook deliveries result in exactly one processing.
- Every payment/invoice state transition is explicit, tested, and cannot bypass payment records.
- Financial records are never hard-deleted; soft-delete of a student leaves invoices and transactions intact and queryable for audit.
- Database unique constraints are the final idempotency layer behind application checks.
- Monthly invoice generation is idempotent.

## Integration rules

- Do not hold a database transaction open around slow external calls unless the design provably requires it.
- Never log gateway credentials, signatures, or payloads containing secrets.
- Keep gateway code behind the port interface so the provider can be replaced.

## Required tests

Verify existing coverage and add missing cases for at minimum: successful QR creation; invalid/foreign invoice; expired payment attempt; invalid signature; unknown order reference; incorrect amount; duplicate webhook; concurrent duplicate webhook; already-paid invoice; refund; disputed payment; authorized and unauthorized CASH confirmation; repeated monthly invoice generation; financial history intact after student soft-delete.

## Acceptance criteria

1. The full lifecycle works end to end: invoice -> QR creation -> simulated gateway payment -> signed webhook -> exactly-once transaction persistence -> invoice PAID -> audit event.
2. The payment-related mandatory security cases (plan S-03, S-11) pass with real output.
3. All relevant quality gates pass: format, lint, typecheck, unit with coverage, E2E, build, contract gate.
4. `openapi.json` is current (regenerated + `npm run contract:lint` clean) if any API shape changed.
5. No verified defect remains unreported; any deferred item is listed with its reason.
