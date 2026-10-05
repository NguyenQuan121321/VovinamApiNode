# Backup and recovery

Use the same major PostgreSQL client as the server or a supported newer client. Supply SOURCE_DATABASE_URL and RESTORE_DATABASE_URL only at runtime. Connection URLs are secrets and must not enter command transcripts or Git.

`scripts/backup-restore-drill.sh` dumps the source in custom format, restores to a fresh empty database and compares counts for every public table. It refuses identical URLs and any populated restore target. It never uses `--clean` or deletes target tables. The temporary dump is private and removed after the run; PostgreSQL dumps contain sensitive data even when passwords are hashed.

```sh
bash scripts/backup-restore-drill.sh
```

Run against a synthetic database first. For an operational backup, preserve an encrypted dump separately under the owner's retention/access policy; this drill is a verification tool, not scheduled backup storage. Stop source writers during the count comparison or compare a fixed snapshot, otherwise legitimate writes can change counts between the dump and comparison.

The original acceptance evidence includes a local synthetic restore. New remediation drill results belong in `docs/evidence/backend-remediation-20261005/`. Row-count equality does not establish byte-for-byte equality, actual production PITR, offsite copies, retention, RPO or RTO. Actual Render backup entitlements and an owner-operated recovery must be verified before real users are onboarded.

For a VPS, configure an encrypted offsite backup destination and restricted restore credentials, monitor successful backup creation, and run recurring restore drills on isolated targets. A local Docker volume is not an offsite backup. Do not automate destructive live restores.

Record the PostgreSQL version, backup timestamp, source quiescence, restore duration, per-table counts, integrity checks and responsible operator. Declare operational RPO/RTO only after a representative measured drill. See [OPERATIONS.md](OPERATIONS.md) for release rollback, key rotation and incident handling.
