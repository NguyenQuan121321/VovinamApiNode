# TASK-02 — Notifications and Consent

## Objective

Implement and verify reliable notification delivery and purpose-specific consent handling (P5).

## Starting point (verify first)

The Prisma schema already defines the `notifications` outbox table and `consent_logs`. Current email sending is a logging stand-in (`LoggingMailSender`); replacing it with a real delivery path via the outbox is a known P5 item. Inspect the actual code before planning; do not assume either more or less exists than this note says.

## Scope — implement or complete

- notification outbox: persisted `QUEUED` rows written atomically with the business state change that triggers them
- in-process worker: poll + bounded retry with backoff; no Redis, no external queue
- email adapter (SMTP via nodemailer or the existing mail port)
- ZNS adapter when configured (Zalo OA); SMS fallback when configured — each fails fast when unconfigured, never fabricated
- in-app notifications: list endpoint and read marking for the owning user only
- notification templates: minimum data per template, no sensitive payload leakage
- consent: purpose-specific creation (e.g., DATA_PROCESSING, MEDIA_USAGE, MARKETING_NOTICE)
- consent revocation and full consent history; revocation never erases the original record
- minor consent: a verified linked PARENT may consent on behalf of the minor; the acting user is recorded
- privacy-related audit events: consent granted, consent revoked, notification-relevant account events

## Rules

- Business state changes and outbox writes must be atomic in one transaction.
- External delivery must never occur inside the main business transaction.
- Workers must be retry-safe; a permanently failing message must not block unrelated messages.
- Sensitive data must not be placed in generic logs; notifications carry only the minimum data required.
- Consent must be purpose-specific and historically traceable; revocation must stop future sends for that purpose without deleting evidence.
- Every notification endpoint enforces ownership: a user sees and marks only their own notifications.

## Legal handling

Do not assume the plan's privacy citations are the current legal baseline. Verify the currently effective Vietnamese data-protection framework before encoding requirements, and record for each requirement whether it is: technically enforceable in code, an organizational/business process, a legal/accounting responsibility, or unresolved. Do not claim legal compliance from code alone.

## Required tests

- successful delivery (adapter faked at the port; no real provider in tests)
- retry with backoff and eventual success
- max-retry exhaustion -> FAILED without blocking other messages
- provider outage behavior
- fallback chain (ZNS -> SMS -> email) when configured
- duplicate/simultaneous worker execution sends at most once
- consent creation, revocation, and history
- minor consent through a verified parent link
- unauthorized consent or notification access (404 posture, no disclosure)
- audit trail for consent events
- business transaction unaffected by delivery failure (outbox row still written)

## Acceptance criteria

1. Notification delivery is asynchronous, retry-safe, observable (status/retries/error visible in the outbox), and does not compromise business transactions.
2. Consent is purpose-specific, auditable, access-controlled, and revocable without data loss.
3. Unconfigured providers fail fast with explicit messages; no fabricated credentials or fake success.
4. All relevant quality gates pass: format, lint, typecheck, unit with coverage, E2E, build, contract gate.
5. `openapi.json` current (regenerated + contract lint clean) if any API shape changed.
