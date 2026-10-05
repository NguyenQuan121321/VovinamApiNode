# Backend security controls and limits

Updated 2026-10-05 for acceptance remediation. Earlier QA reports describe their dated source trees; they do not establish the safety of the current deployment. See `BACKEND_REMEDIATION.md` for new verification and `DEPLOY_RENDER.md` for privileged provisioning.

## Authentication and authorization

Password policy, uniform authentication failures, rotating opaque refresh tokens, database-backed session revocation, password-version invalidation, single-use email tokens and AES-256-GCM sealed TOTP remain enforced. ADMIN business routes require MFA enrollment. Normal self-service MFA setup remains reachable so an administrator can enroll; no bypass endpoint was added.

Public registration admits STUDENT and PARENT. An authorized operator provisions the initial verified ADMIN through the existing runtime-credential seed. The seed leaves existing accounts unchanged. INSTRUCTOR and further administrator creation use the normal MFA-protected administration APIs. Credentials remain outside Git and reports.

JWT verification precedes role and ownership checks. Foreign student/business IDs return the established uniform error posture. Serializers continue limiting fields by role. Synthetic local security suites cover both roles and ownership; authenticated testing on Render requires legitimate privileged provisioning access and normal MFA authentication.

## Abuse controls and deployment topology

The application enforces global and auth-surface IP limits, per-account lockouts and mail budgets, shared MFA failure budgets, a one-megabyte JSON body cap and strict DTO validation. Proxy trust is configurable through TRUST_PROXY_HOPS, defaulting to one. The trusted edge must discard untrusted forwarded headers; confirm the actual chain before configuring a different hop count.

SharedStore counters and some replay caches remain process-local. Keep one API instance until a distributed store is implemented and verified. Database-backed sessions, refresh revocation and password versions survive restarts. Process-local limits reset on restart; do not represent them as durable or cluster-wide. TLS, WAF/CDN, network controls and volumetric abuse protection belong to the deployment infrastructure.

## Financial integrity

All QR replacement, signed settlement, cash confirmation and refund/dispute transitions lock the same invoice row before changing money state. Parallel replacement leaves one current pending QR; history remains available. Distinct successful callbacks are serialized and an excess receipt becomes DISPUTED instead of silently overpaying an invoice.

Webhook signatures are checked before parsing. Duplicate, unknown and malformed signed events receive the documented no-op response. Database failures remain retryable errors. Expired or superseded receipts, amount mismatches and receipts for non-payable invoices require reconciliation and cannot automatically mark an invoice paid. Late callbacks cannot overwrite terminal SUCCESS, DISPUTED or REFUNDED states.

The refund endpoint records an externally completed refund, including previously disputed receipts. It does not perform a money transfer. Financial rows and audit history are retained. Invoice line products and aggregate amounts are checked against PostgreSQL integer bounds and return 400 on overflow. Monetary validation uses integers throughout.

## Audit and message delivery

Student mutations now include the authenticated actor's structured audit user ID. Audit writes retain stable event IDs on failure, log a sanitized failure and retry with duplicate suppression. The process-local buffer is bounded to 10000 events. Abrupt process termination or prolonged database failure can still lose queued audit events; this is an explicit operational limit. Shutdown reports unresolved buffered records.

SMTP errors are propagated to the outbox, which retries with bounded exponential backoff instead of marking failures SENT. SMTP connection/greeting/socket timeouts bound transport waits. Logs omit recipients, bodies and raw transport errors. Authentication's mail boundary retains uniform public responses.

Notification claims use PostgreSQL row locks and lease timestamps, one eligible message at a time. Shutdown stops new claims and waits for the active send before database disconnection. Stale leases recover after ten minutes. Provider delivery is at-least-once; acceptance followed by a crash before recording SENT can cause a retry. The provider's idempotency support must be evaluated for stronger guarantees. Actual fallback channel metadata is recorded. ZNS and SMS have no live adapters and remain explicitly unconfigured.

Logging mail is metadata-only and does not deliver mail. The token-bearing MAIL_LOG_FILE is a local/test capture facility and is forbidden in production. Render free services block common SMTP ports; actual delivery must be verified on a supported provider/hosting path before real users depend on account verification or resets.

## CI and supply chain

Semgrep fails on findings, scanner errors, malformed/missing reports and nonzero scanner exit codes. Its scanner image is pinned; documented existing false-positive exclusions were preserved. CI continues requiring secret scans, dependency audit, licenses, static analysis, tests, migration replay, OpenAPI quality/staleness and container scanning before deployment.

The dependency tree was refreshed, Jest migrated to version 30 and vulnerable Spectral CLI transitive dependencies removed by using the official Spectral JavaScript SDK with the existing rules. Dependency checks must be rerun for each release; a dated zero-advisory result is not a permanent guarantee. Patched transitive overrides require tool smoke checks. No advisory suppression or lower security threshold was added.

CI requests an exact deployment commit and accepts success only when /version reports that commit and both health probes succeed. It cannot pass using an older healthy deployment. Missing deployment secrets or identity cause failure. Swagger remains disabled by default; committed openapi.json is the frontend contract.

## Recovery and production acceptance

The repository provides a non-destructive synthetic restore drill and release/rollback runbooks. See BACKUP_RECOVERY.md and OPERATIONS.md. A successful local drill verifies that exercise, not actual Render PITR, retention, offsite copies or operational RPO/RTO. An authorized owner must configure and test those before real-user onboarding.

Real payOS sandbox acceptance, live email delivery, authenticated hosted UAT and infrastructure monitoring remain separate evidence requirements. Legal/privacy, consent, retention, banking and accounting obligations need qualified owner verification. Technical controls do not constitute legal certification. Earlier benchmark figures are historical local measurements, not capacity guarantees for Render or a future VPS.
