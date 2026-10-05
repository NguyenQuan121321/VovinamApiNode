# Backend operations

This runbook covers the current Render staging service and a future single-instance VPS. The frontend is owned separately. Real payment-provider selection and final browser origins remain owner decisions. An operational procedure is not evidence that a provider feature has been enabled.

## Deployment and identity

Run the complete CI gates before release. Apply committed migrations with `npx prisma migrate deploy` using a privileged deployment connection; never use `db push`, `migrate dev` or `migrate reset` against hosted data. The new reliability migration is additive: it assigns audit event identifiers and adds notification worker leases. It does not delete financial or audit history.

Render automatically supplies `RENDER_GIT_COMMIT`. `/version` returns only the configured commit in the normal envelope; `BUILD_SHA` takes precedence for immutable container images. CI deploys its exact SHA through the configured secret deploy hook and then requires `/version`, `/healthz` and `/readyz` to agree with that SHA. Healthy responses from an older instance cannot pass the gate. Missing identity fails verification.

The Docker entrypoint runs `prisma migrate deploy` before starting Node, so Docker services apply this additive migration even when their Render plan has no pre-deploy command. Prisma serializes deployment migrations; a migration failure prevents the replacement instance from serving traffic. An existing pre-deploy migration remains safe and idempotent. Native Node services must retain an explicit pre-start/pre-deploy migration step. Do not expose a migration or administrator-bootstrap endpoint.

Use the documented seed only through an authorized database connection or deployment shell. Supply unique ADMIN_EMAIL and ADMIN_PASSWORD at runtime, confirm a new identity, and enroll MFA normally. The seed must not be used to reset or take over an existing identity. A missing privileged connection blocks authenticated staging UAT; it is never solved by changing RBAC or disabling MFA.

## Configuration and email

Keep secrets in the provider environment or an untracked secret file. Preserve the encryption key across releases; replacing it makes existing TOTP credentials unreadable. Rotate JWT keys by adding the previous key temporarily and revoke sessions where the incident requires it. Never copy tokens or connection strings into reports.

The current thesis staging environment may use simulated payments and intentionally enabled Swagger. Production refuses simulated payments. Deliverable verification/reset/notification mail needs `MAIL_DRIVER=smtp` and validated SMTP settings; `logging` does not deliver mail. Render free web services block common outbound SMTP ports. Use a supported paid SMTP-capable service or an owner-selected HTTPS mail integration before serving real users; credentials and provider selection cannot be invented by this repository.

SMTP failures propagate to the notification outbox and are retried with bounded backoff. Authentication's notification boundary keeps its anti-enumeration response posture. Logs omit recipients, bodies and raw transport errors. Delivery acceptance by SMTP does not prove inbox delivery.

## Monitoring and incidents

Probe `/healthz` for process liveness and `/readyz` for database readiness. Collect `/metrics` only with the runtime bearer credential over HTTPS. External uptime alerts and an actual monitored destination must be configured by the owner; no alert destination is implied by this code.

Investigate `audit_flush_failed`, `audit_queue_capacity_exceeded`, `audit_shutdown_pending`, `mail_send_failed` and `notification_worker_pass_failed` in structured logs. Audit batches retain stable event identifiers and retry without duplicating already committed events. Buffering is bounded to 10000 events; an extended outage or abrupt process loss can still lose process-local queued events. Capacity and shutdown failures emit explicit signals. Do not describe this bounded buffer as an unlimited durable queue.

The notification worker atomically claims one eligible message with PostgreSQL row locks. A crashed lease becomes eligible after ten minutes. Provider delivery is at-least-once: a process can fail after a provider accepts mail but before the database records SENT. This is distinct from application double-claim protection. Use provider idempotency when the selected delivery provider supports it.

For database loss, liveness remains available and readiness returns 503. Restore connectivity, verify readiness, observe worker retries and review financial reconciliation. Never delete failed financial rows to hide an outage. Restart through the platform or `docker compose -f compose.production.yml restart api`; shutdown waits for the active notification send and flushes audit before disconnecting Prisma.

## Payment reconciliation

Per-invoice database locks serialize QR replacement, settlement, cash confirmation and refunds. One application-created pending QR remains current. Duplicate receipts cannot overwrite terminal SUCCESS, DISPUTED or REFUNDED states. Expired receipts, amount mismatches, non-payable invoices and excess payments are retained as DISPUTED for review. QR expiry is an acceptance deadline, not proof that an actual bank transfer never happened.

The administrator refund endpoint records an externally completed refund; it does not initiate a transfer of money. Verify the actual bank/provider refund first, then record the reason. Never select a real provider or use real money for synthetic UAT. The API does not constitute a tax invoice or legal/accounting certification.

## VPS cutover

Use `compose.production.yml` only after supplying an immutable tested image in VOVINAM_IMAGE and a protected `.env.production`. Its DATABASE_URL must resolve to the internal `db` service. Keep PostgreSQL off public ports. The API is bound to loopback on the host; place a TLS reverse proxy in front of it, strip client-supplied forwarded headers and set TRUST_PROXY_HOPS to the measured trusted chain. Use zero for direct local access. Do not expose the origin in a way that bypasses the trusted proxy.

Start the database, take a verified backup, run the migration service, then start the API:

```sh
docker compose -f compose.production.yml up -d db
docker compose -f compose.production.yml run --rm migrate
docker compose -f compose.production.yml up -d api
```

Verify source identity, readiness, HTTPS, exact CORS origins and an authenticated synthetic workflow before switching traffic. Keep one API instance while SharedStore remains process-local; multiple API replicas require shared throttle/MFA replay budgets. Do not introduce horizontal scaling merely because database-backed business locks are safe.

Application throttling and body limits mitigate application abuse. Provider/CDN/WAF/network controls must address volumetric DDoS. Backups, retention, TLS renewal, security updates and alerts require actual owner-operated infrastructure.

## Rollback

Record the previous tested image/commit before deploying. On Render redeploy that exact earlier commit; on a VPS restore VOVINAM_IMAGE to the previous immutable image and recreate the API. The additive reliability migration remains compatible with the old application; do not delete its columns or audit history. For future destructive schema changes, prepare a separate data-compatible rollback plan. Verify `/version` and readiness after rollback. A live rollback is not claimed tested unless recorded in the remediation evidence.

Provider references checked on 2026-10-05: [Render environment variables](https://render.com/docs/environment-variables), [deploy hooks](https://render.com/docs/deploy-hooks), [free-service limitations](https://render.com/docs/free), [deployment lifecycle](https://render.com/docs/deploys).
