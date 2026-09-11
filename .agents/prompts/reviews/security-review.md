# Security Review

Perform a focused security review of the implemented system against the project's security baseline (plan sections 4–5, 7.3–7.5, and the twelve mandatory cases S-01..S-12).

## Checklist

- broken access control: guard stack completeness on every route; role restrictions explicit
- IDOR: every `:id`/`:studentId` route passes the ownership guard; violations answer uniform 404 without existence disclosure
- authentication: lockout, timing-equalized dummy compare, uniform 401 semantics across wrong-password/locked/disabled/unverified
- tokens: JWT kid rotation, `pwd_version` rejection of stale tokens, jti denylist on logout, opaque hashed refresh tokens with rotation and reuse detection (replay revokes all sessions + alert)
- sessions: list/revoke/logout-all scoped to the owner; stale sessions rejected
- MFA: AES-256-GCM sealed secrets, shared failure bucket across verify/validate/login-verify, replay guard, hashed single-use recovery codes, ADMIN enforcement
- rate limiting: global per-IP throttling with IPv6 /64 buckets, per-account budgets, endpoint-specific limits where needed
- enumeration: register/forgot-password/resend identical responses regardless of account existence
- secrets: fail-fast env validation, no secrets in code/logs/errors/repo, log redaction active
- payment security: webhook raw-body HMAC verified before processing, claim-first idempotency via `gateway_txn_id`, exact-amount settlement, server-derived amounts only
- data exposure: serializer matrix adherence (contact fields hidden from INSTRUCTOR, medical notes handling), no sensitive data in logs or error payloads
- logging: audit events present for security-relevant actions; no secrets or personal payloads in logs

## Method

For each checklist item, cite the code location that implements the control and the test that proves it. A control without either is a finding.

## Classification

- P0 critical — exploitable now, money/data/children at risk
- P1 high — exploitable with effort or defense-in-depth gap
- P2 medium — hardening gap
- P3 low — hygiene

## Rules

- Do not call a design a vulnerability without concrete evidence (reproduction, traceable scenario, or failing test).
- Do not claim a vulnerability is fixed without a regression test where practical.
- Fix P0/P1 technical issues within the current task's scope; document anything requiring a product, legal, or infrastructure decision instead of implementing a guess.

## Completion

Run the security and E2E suites plus the relevant gates and report real output. Summarize findings fixed vs. reported-only.
