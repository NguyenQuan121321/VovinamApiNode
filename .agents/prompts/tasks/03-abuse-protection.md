# TASK-03 — Abuse Protection

## Objective

Implement application-layer abuse protection against automation, scraping, spam, enumeration, and abusive resource consumption.

## Starting point (verify first, then extend)

Existing controls already in the codebase: global per-IP throttling with IPv6 /64 bucket normalization, per-account lockout on failed logins, per-account mail budgets on forgot-password and resend-verification, uniform anti-enumeration responses, and the `@nestjs/throttler` setup. Preserve them. Add controls only where you have verified a real gap against the current API surface.

## Threats to cover

- credential stuffing and login abuse
- registration spam
- forgot-password (password-reset) spam
- verification-email spam
- invite-code brute force
- excessive pagination (deep/expensive page requests)
- excessive polling (e.g., payment status)
- scripted endpoint enumeration and scraping
- low-volume application-layer flooding
- honeypot-triggering automation

## Controls (where justified by the current API)

- global rate limiting (exists — verify configuration and coverage)
- endpoint-specific throttling for expensive or sensitive endpoints
- per-account limits in addition to per-IP limits
- IP controls with safe forwarded-header handling (trust the proxy chain explicitly, never raw `X-Forwarded-For` blindly)
- IPv6 normalization to /64 buckets (exists — verify it applies to every new per-IP counter)
- progressive throttling (increasing cost/latency for repeat offenders) where simpler flat limits are provably insufficient
- temporary deny/block state for repeated abuse signals
- honeypot handling on suitable public inputs
- abuse detection signals recorded to logs/audit for diagnosis
- pagination caps (existing limit<=100 cap preserved; verify no endpoint bypasses it)
- response-size and resource controls on heavy endpoints

## Anti-scraping principles

- Sensitive student data remains authenticated; ownership and role checks stay mandatory.
- Do not expose unnecessary internal metadata.
- Do not allow unrestricted bulk enumeration of students, invoices, or payments.
- Consider cursor pagination for high-value collections only when measurement shows it is useful.

## Do not implement

- User-Agent strings as a security boundary.
- Permanent IP bans from a single signal.
- CAPTCHA as a mandatory dependency unless evidence requires it (the env-toggled NoOp default stays).
- Any claim that these controls stop volumetric DDoS attacks.

## DDoS boundary (mandatory wording)

Explicitly distinguish:

1. Application-layer abuse protection (this task): rate limiting, throttling, budgets, honeypots — mitigates abuse and resource exhaustion.
2. Infrastructure-layer DDoS mitigation: provider/CDN/WAF/network capabilities — a deployment responsibility, documented in TASK-04, not achievable in NestJS middleware.

Documentation produced by this task must state both layers and never conflate them.

## Required tests

- burst requests hit the throttle (429) and recover
- login abuse (repeated failures) is blocked per account
- forgot-password and verification spam budgets hold per account
- registration spam is throttled
- invite-code guessing is throttled and never discloses validity
- pagination beyond the cap is rejected
- unauthorized object enumeration answers uniformly (no existence disclosure)
- honeypot request is handled without side effects
- IPv6 addresses in the same /64 share one bucket (S-10)
- forwarded-IP spoofing cannot reset the bucket
- legitimate shared-NAT users are not locked out by neighbors' traffic

## Acceptance criteria

1. Application-layer abuse controls work without breaking normal authenticated usage (legitimate flows still pass E2E).
2. The abuse-layer vs. infrastructure-DDoS distinction is documented where these controls are described.
3. Existing anti-abuse behavior (S-05, S-07, S-09, S-10 semantics) still passes.
4. All relevant quality gates pass with real output.
