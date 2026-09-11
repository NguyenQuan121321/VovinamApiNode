# Business Logic Review

Review domain behavior for logic holes: invalid states, race conditions, duplicate operations, and missing invariants. Do not rewrite correct behavior merely because an alternative design is possible.

## Focus areas

- student lifecycle: PENDING -> ACTIVE approval, PAUSED/LEFT transitions, soft-delete effects on accounts and links
- parent/student relationships: invite-code single use, verified vs. unverified links, unlink rules, one parent acting for multiple children
- enrollment: capacity, duplicate enrollment, leave/re-enroll, enrollment vs. class status
- attendance: session uniqueness per class/date, record upsert semantics, corrections after the fact, records for non-enrolled students
- belt progression: rank ordering, no rank regression, promotion only via verified exam results
- exams: DRAFT -> OPEN -> CLOSED -> COMPLETED/CANCELLED gating, registration deadline and capacity, duplicate registration, result finality, invoice linkage
- billing: invoice totals (subtotal/discount/total), period uniqueness for tuition, overdue derivation, cancellation vs. paid states
- payment state transitions: PENDING -> SUCCESS/FAILED, SUCCESS -> REFUNDED/DISPUTED, invoice re-derivation, no transition that bypasses a payment record, settlement exactly when SUCCESS sum >= total
- notifications: side effects of business events (e.g., payment confirmation), no duplicate sends
- consent: purpose-specific grants, revocation honored by senders, parent consent recorded for minors
- soft-delete behavior: financial chain intact (RESTRICT), default queries exclude deleted rows, no orphans

## What to look for

- invalid state transitions (states reachable that should not be)
- duplicate operations (double submit, parallel requests creating two rows)
- race conditions (check-then-act without a constraint or transaction)
- missing authorization on a state-changing path
- stale state (denormalized fields drifting from their source)
- orphan records (children without parents after deletes)
- incorrect totals or derived amounts
- impossible combinations (e.g., refunded payment on a paid invoice that stays paid)
- missing database constraints (invariants enforced only in code)

## Method

For each suspicion: name the invariant, cite the code path, and demonstrate the violating sequence (concrete request order or concurrent scenario). Confirm with a failing test before fixing.

## Rules

- Fix confirmed defects with the minimal change plus a regression test; add a database constraint when the invariant must be unconditional.
- Report design-level concerns (valid but fragile) as findings instead of re-architecting.
- Run the relevant suites and gates and report real output.
