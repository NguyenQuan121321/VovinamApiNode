#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

if [[ "$SOURCE_DATABASE_URL" == "$RESTORE_DATABASE_URL" ]]; then
  echo 'Source and restore target must be different' >&2
  exit 1
fi

target_tables=$(psql --dbname="$RESTORE_DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if [[ "$target_tables" != 0 ]]; then
  echo 'Restore target must be a fresh empty database; existing data is never overwritten' >&2
  exit 1
fi

dump_file=$(mktemp)
trap 'rm -f -- "$dump_file"' EXIT
started=$SECONDS
pg_dump --dbname="$SOURCE_DATABASE_URL" --format=custom --no-owner --no-privileges --file="$dump_file"
pg_restore --dbname="$RESTORE_DATABASE_URL" --exit-on-error --no-owner --no-privileges "$dump_file"

count_sql='CREATE FUNCTION pg_temp.row_counts() RETURNS TABLE(table_name text, row_count bigint) LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = '\''public'\'' ORDER BY tablename LOOP
    RETURN QUERY EXECUTE format('\''SELECT %L::text, count(*)::bigint FROM public.%I'\'', t.tablename, t.tablename);
  END LOOP;
END $$;
SELECT json_agg(x ORDER BY table_name) FROM pg_temp.row_counts() x;'
source_counts=$(psql --dbname="$SOURCE_DATABASE_URL" -XAt -q -v ON_ERROR_STOP=1 -c "$count_sql")
restored_counts=$(psql --dbname="$RESTORE_DATABASE_URL" -XAt -q -v ON_ERROR_STOP=1 -c "$count_sql")
if [[ "$source_counts" != "$restored_counts" ]]; then
  echo 'Restore row-count comparison failed; investigate the isolated target' >&2
  exit 1
fi
printf 'Restore drill passed in %s seconds; per-table counts match.\n' "$((SECONDS-started))"
printf '%s\n' "$restored_counts"
