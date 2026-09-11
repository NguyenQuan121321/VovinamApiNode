# TASK-05 — Security and Legal Review

## Objective

Perform the final security and data-protection review of the implemented system and fix technical findings. Organizational, legal, and accounting gaps are documented for human verification — never "fixed" by pretending code satisfies them.

## Security review checklist

Review the implemented system against the project's security baseline (plan sections 4–5, 7.3–7.5):

- broken access control: every route's guard stack and role restrictions
- IDOR: every `:id`/`:studentId` route through the ownership guard, uniform-404 posture intact
- authentication: login flow, lockout, uniform 401 anti-enumeration, timing equalization
- tokens: JWT kid rotation, `pwd_version` enforcement, jti denylist, opaque refresh tokens with rotation and reuse detection
- sessions: listing, revocation, logout-all, stale-session rejection
- MFA: TOTP sealing, shared failure bucket, replay guard, recovery codes, ADMIN enforcement
- enumeration: register/login/forgot-password/resend uniformity
- injection: Prisma parameterization, class-validator whitelist, no raw query interpolation
- SSRF: no user-controlled outbound fetch; webhooks inbound-only
- payment integrity: server-derived amounts, exact-match settlement, idempotency constraints
- webhook integrity: raw-body HMAC, signature-first processing, replay/idempotency safety
- secrets: env validation, no secret in logs/errors/repo, redaction rules
- logs: no sensitive payloads, request IDs present, audit events complete
- backups: encryption at rest / access control where the provider supports it (verify, don't assume)
- minor data: profile visibility, parent-link verification, serializer matrix adherence
- medical data, addresses, phone numbers, emergency contacts: exposure paths and protections
- audit logs: coverage of security-relevant events, retention, access restriction
- data retention: what is kept, for how long, and the published policy vs. actual behavior
- consent: purpose-specific records, revocation honored by notification sending

## Data review

For every personal-data field, document: purpose, necessity, access roles, protection, retention, logging restrictions, export restrictions, consent/legal-basis dependency, and minor-related implications.

## Legal review

Verify the currently effective Vietnamese legal instruments relevant to personal data protection, minors' rights, accounting/financial record retention, fee-collecting payment accounts, and electronic invoicing where applicable. Do not rely on citations in `docs/PLAN.md` without checking they are still current; record the verification date and source for each instrument.

Build a matrix that distinguishes exactly these five categories:

1. technical implementation (done in code, with pointer)
2. organizational requirement (business process the club must operate)
3. legal requirement (verified current law; cite instrument and date)
4. accounting/tax requirement (accountant/tax advisor territory)
5. unresolved item (needs verification or a human decision)

Do not claim the software guarantees legal compliance.

## Deliverables

- `docs/SECURITY_REVIEW.md` — findings with P0–P3 classification and fix/deferral status
- `docs/DATA_PROTECTION.md` — the per-field data review
- `docs/LEGAL_COMPLIANCE_MATRIX.md` — the five-category matrix with verification dates

## Fixes and tests

- Fix P0/P1 technical findings within this task, each with a regression test.
- Classify P2/P3 findings with a remediation owner (task number) — fixing them is allowed but must not displace the review itself.
- Document anything requiring a product, legal, accounting, or infrastructure decision instead of implementing a guess.

## Acceptance criteria

1. No unresolved P0/P1 security defect remains in technical scope.
2. Every legal/accounting item is either verified with a dated source or explicitly marked as requiring human confirmation.
3. The three documents match the actual implementation (every claim has a code/config pointer).
4. All relevant quality gates pass with real output.
