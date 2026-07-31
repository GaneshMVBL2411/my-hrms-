#!/usr/bin/env bash
# Regenerates supabase/apply-all.sql from the individual files. Run from the
# repo root after changing lockdown.sql, reset-database.sql or any migration.
set -euo pipefail

cd "$(dirname "$0")/.."

{
  cat <<'HEADER'
-- =============================================================================
-- apply-all.sql — GENERATED, do not edit
--
-- Everything needed to take this project from the old FastAPI schema to the
-- current one, as a single paste for the Supabase SQL Editor. The editor runs
-- it as one transaction, so it either all lands or nothing does.
--
-- Regenerate with supabase/build-apply-all.sh after changing any migration.
-- Edit the source files, never this one.
--
-- DESTRUCTIVE: drops every app table in `public` and its data. Nothing outside
-- `public` is touched — the auth and storage schemas survive.
--
-- Afterwards, create the logins:
--   node supabase/seed.mjs        (needs SUPABASE_URL + SUPABASE_SERVICE_KEY)
-- =============================================================================

HEADER

  for f in supabase/lockdown.sql supabase/reset-database.sql supabase/migrations/*.sql; do
    printf '\n\n-- ###########################################################################\n'
    printf -- '-- %s\n' "$f"
    printf -- '-- ###########################################################################\n\n'
    # Strip the trailing verification SELECTs; they would be the only visible
    # result of the run and hide anything more useful.
    sed '/^select tablename, rowsecurity as rls_enabled$/,$d; /^select .left behind: /d' "$f"
  done
} > supabase/apply-all.sql

echo "wrote supabase/apply-all.sql ($(wc -l < supabase/apply-all.sql) lines)"
