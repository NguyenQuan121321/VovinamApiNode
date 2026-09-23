# TASK-05 — Security, Reliability and Production Hardening

## Objective

Harden the VovinamApiNode system after functional implementation is complete.

This task focuses on:

- security
- reliability
- data integrity
- financial integrity
- abuse resistance
- observability
- performance
- production configuration
- operational safety

Do not add unrelated business features.

Hardening must be evidence-driven.

---

# 1. Preconditions

Read:

- `.agents/AGENTS.md`
- global engineering contract
- launcher
- `docs/CURRENT_STATE_AUDIT.md`
- `docs/SYSTEM_ARCHITECTURE_BASELINE.md`
- `docs/DATABASE_BASELINE.md`
- API baseline
- `docs/PLAN.md`
- `IMPLEMENTATION_PROGRESS.md`

Inspect the complete current repository before modifying anything.

---

# 2. Security Review

Review:

## Authentication

- password policy
- login protection
- account lockout
- anti-enumeration
- session lifecycle
- refresh-token rotation
- reuse detection
- password reset
- email verification
- MFA

## Authorization

- role enforcement
- ownership enforcement
- student data access
- parent-child access
- instructor-class access
- admin financial access
- privilege escalation

## Input Security

- DTO validation
- whitelist
- unknown-field rejection
- malformed IDs
- payload limits
- injection resistance

## Web/API Security

- CORS
- security headers
- HTTPS/proxy assumptions
- Swagger exposure
- metrics exposure
- error leakage

## Secrets

- environment validation
- log redaction
- secret storage
- webhook secret handling
- encryption keys

---

# 3. Financial Hardening

Review:

- invoice totals
- discount rules
- payment amount validation
- QR payment creation
- webhook signature verification
- webhook idempotency
- duplicate webhook handling
- parallel webhook handling
- payment state transitions
- refund/dispute transitions
- cash confirmation
- revenue reporting

Verify that a malicious or duplicated request cannot create false successful payment states.

---

# 4. Database Integrity Hardening

Review:

- FK behavior
- unique constraints
- important CHECK constraints
- transaction boundaries
- concurrent writes
- historical-data protection
- soft-delete behavior
- idempotency constraints

Identify whether important business invariants are enforced at:

- application
- database
- both

Do not add constraints based solely on preference.

---

# 5. Abuse Protection

Review:

- IP rate limiting
- account-level rate limiting
- login abuse
- password-reset abuse
- verification-email abuse
- TOTP brute force
- large request payloads
- expensive endpoints

Clearly distinguish:

APPLICATION-LAYER ABUSE PROTECTION

from:

INFRASTRUCTURE-LAYER DDoS PROTECTION

Never claim application middleware provides full volumetric DDoS protection.

---

# 6. Reliability Review

Inspect:

- database connection handling
- graceful shutdown
- request timeouts
- background jobs
- failed job behavior
- retry behavior
- idempotency
- partial failure handling
- external gateway failure
- email failure
- configuration failure

Verify that failure does not silently corrupt business state.

---

# 7. Observability

Review:

- structured logs
- request IDs
- audit logs
- health checks
- readiness checks
- metrics
- error visibility

Ensure logs do not contain:

- passwords
- tokens
- secrets
- MFA codes
- excessive personal/minor information
- sensitive payment data

---

# 8. Performance

Performance changes require measurement.

Establish or verify a baseline using the existing load tooling.

Measure where applicable:

- throughput
- p50
- p95
- p99
- error rate
- database latency
- DB connections
- CPU/memory

Inspect:

- N+1 queries
- unbounded queries
- missing pagination
- expensive joins
- obvious hot paths

Do not invent enterprise performance targets.

Use thesis/system workload assumptions and record them explicitly.

---

# 9. Configuration and Deployment

Review:

- environment validation
- production configuration
- Docker image
- startup behavior
- migration deployment
- health/readiness
- Swagger policy
- metrics authentication
- secrets
- graceful shutdown

Verify that unsafe development defaults do not silently become production behavior.

---

# 10. Backup and Recovery

Determine the actual backup/restore posture.

Document only what is verified.

Do not claim:

- backup success
- restore success
- RPO
- RTO

unless demonstrated or provider-verified.

At minimum identify:

- backup responsibility
- restore procedure
- migration recovery consideration
- data-loss risks

---

# 11. Privacy and Legal Boundary

Review technical handling of:

- student data
- minor data
- parent relationships
- medical notes
- attendance
- payment history
- IP addresses
- audit logs

Separate:

TECHNICAL CONTROL
BUSINESS PROCESS
LEGAL REQUIREMENT
ACCOUNTING REQUIREMENT
UNVERIFIED

Never claim legal compliance solely because a technical feature exists.

Where current law affects implementation, verify the currently effective Vietnamese legal framework before asserting requirements.

---

# 12. Testing

Every hardening fix requires regression coverage.

Add tests for:

- authentication abuse
- authorization/IDOR
- financial integrity
- concurrency-sensitive logic
- webhook replay/idempotency
- input validation
- failure handling
- configuration failures

Run relevant:

- unit
- E2E
- security
- build
- lint
- typecheck
- format
- OpenAPI/contract
- migration verification

Never weaken existing tests.

---

# 13. Documentation

Update documentation with verified hardening results.

Document:

- security controls
- measured performance
- operational assumptions
- known limitations
- unresolved risks
- infrastructure responsibilities

Do not convert assumptions into guarantees.

---

# 14. Implementation Rules

Fix P0/P1 technical findings discovered in this task.

P2 findings may be fixed when within scope and evidence supports the change.

P3 findings should normally be documented for later unless they are trivial and directly related.

Do not introduce unrelated business features.

Do not add Redis, queues, microservices, or other infrastructure without measured necessity and explicit justification.

Do not perform blind rewrites.

---

# 15. Acceptance Criteria

- P0 technical hardening findings are resolved.
- P1 technical findings are resolved or explicitly blocked with evidence.
- Security-sensitive changes have regression tests.
- Financial integrity has regression coverage.
- Relevant concurrency/idempotency behavior is verified.
- Performance changes have before/after evidence.
- Configuration and deployment behavior is verified.
- No unsupported security or production-readiness claim is made.
- Required quality gates pass.
- Documentation records actual evidence.

---

# 16. Required Closing Output

RESULT:
<COMPLETE or BLOCKED>

P0 FIXES:
<list>

P1 FIXES:
<list>

P2 FIXES:
<list>

SECURITY STATUS:
<summary>

FINANCIAL STATUS:
<summary>

RELIABILITY STATUS:
<summary>

PERFORMANCE BASELINE:
<actual measurements>

PERFORMANCE AFTER HARDENING:
<actual measurements>

DATABASE CHANGES:
<summary>

API CHANGES:
<summary>

TEST EVIDENCE:
<actual results>

OPENAPI STATUS:
<actual status>

PRODUCTION LIMITATIONS:
<list>

REMAINING RISKS:
<list>

NEXT ELIGIBLE TASK:
<TASK-06>

STOP.