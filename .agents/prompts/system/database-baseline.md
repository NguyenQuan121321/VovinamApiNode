Using the approved SYSTEM BASELINE and AUTHORIZATION BASELINE,
audit and redesign the VovinamApiNode database architecture.

DO NOT IMPLEMENT MIGRATIONS YET.

The current database already contains production-oriented tables.
Do not assume they should be replaced.

For every existing table:

- business purpose
- ownership
- relationships
- cardinality
- primary key
- foreign keys
- nullable fields
- unique constraints
- indexes
- enum usage
- historical requirements
- soft-delete requirements
- audit requirements
- financial integrity requirements

Then classify every table:

KEEP
KEEP + MODIFY
MERGE
SPLIT
DEFER
REMOVE

Then evaluate missing entities.

Evaluate whether PostgreSQL should enforce:
- UNIQUE
- FOREIGN KEY
- CHECK
- NOT NULL
- indexes
- database-level idempotency

Evaluate concurrency-sensitive operations:
- enrollment
- attendance
- invoice generation
- QR payment
- webhook processing
- exam result

Do not blindly add constraints where the rule is fundamentally application/business logic.

OUTPUT:

1. Canonical ER model
2. Table inventory
3. Relationship inventory
4. Data dictionary
5. Constraints
6. Index strategy
7. Historical-data strategy
8. Transaction boundaries
9. Idempotency strategy
10. Migration plan

FINAL DECISION MUST BE ONE OF:

A. KEEP CURRENT DATABASE
B. KEEP + TARGETED MIGRATIONS
C. MAJOR REDESIGN REQUIRED

For every proposed schema change explain:
- reason
- business requirement
- affected table
- affected API
- affected code
- migration strategy
- test strategy

DO NOT MODIFY schema.prisma.
DO NOT CREATE MIGRATIONS.