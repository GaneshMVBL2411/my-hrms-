#!/usr/bin/env bash
# Generates neon/schema.sql — the whole HRMS schema, adapted for Neon.
#
# Derived from the existing supabase/migrations rather than re-authored, so the
# two cannot drift: change a migration, re-run this, and Neon follows. Written
# in the same shape as supabase/build-apply-all.sh for the same reason.
#
# What the adaptation actually consists of. Neon is Postgres and nothing more,
# so three Supabase-specific things have to go:
#
#   1. auth.users        — GoTrue's table. users.auth_id referenced it; the
#                          column stays (to correlate rows during the data
#                          migration) but the foreign key cannot.
#   2. auth.uid()        — GoTrue's session function, used by every policy.
#                          Replaced wholesale by 0001_session_context.sql, which
#                          redefines the app_* helpers to read a transaction
#                          setting instead. The policies themselves are
#                          untouched, which is the point: they are the
#                          multi-tenant isolation model.
#   3. storage.*         — Supabase Storage stays where it is, so 0005 is
#                          skipped entirely rather than ported.
#
# Everything else — 28 tables, 19 views, the functions, every policy — is copied
# verbatim.
#
# Run from anywhere:  ./neon/build-schema.sh
set -euo pipefail

cd "$(dirname "$0")/.."

OUT=neon/schema.sql

{
  cat <<'HEADER'
-- =============================================================================
-- schema.sql — GENERATED, do not edit
--
-- The complete HRMS schema for Neon PostgreSQL. Regenerate with
-- neon/build-schema.sh; edit the source migrations, never this file.
--
-- Apply to an empty Neon database:
--   psql "$DATABASE_URL" -f neon/schema.sql
--
-- Order matters. 0001_session_context.sql comes last on purpose: it redefines
-- the app_* helper functions that every policy calls, replacing the versions
-- that read auth.uid() with versions that read a transaction-local setting. Run
-- earlier, the migrations that follow would overwrite it and every policy would
-- deny everything.
--
-- This file creates structure only. It contains no data — the rows come across
-- separately, after you have verified the schema landed.
-- =============================================================================

-- Postgres validates the body of a `language sql` function when it is created.
-- The helpers arrive from 0002 still calling auth.uid(), which does not exist
-- here, so validation would abort the load before 0001_session_context.sql gets
-- a chance to replace them at the end. Turning the check off lets those
-- definitions land unvalidated; they are overwritten before anything calls
-- them, and the verification queries at the bottom prove none survived.
--
-- Scoped to this load only — it is a session setting, not a database one.
set check_function_bodies = off;

-- Supabase ships three roles that Postgres does not. Every policy is declared
-- `to authenticated`, so without that role the very first `create policy` fails
-- with `role "authenticated" does not exist`.
--
-- They are created here as empty, login-less groups rather than editing the
-- policies to name a different role. The policies are the multi-tenant
-- isolation model and the brief says not to change it — porting them verbatim
-- means there is nothing to re-review. `hrms_app` is made a member of
-- `authenticated` further down, which is what makes the policies apply to it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

HEADER

  # ---------------------------------------------------------------- migrations
  # 0005 is storage and is deliberately absent: Supabase Storage is staying.
  # 0006 repairs a grant that only matters on Supabase's service_role.
  for f in \
    supabase/migrations/0001_schema.sql \
    supabase/migrations/0002_security.sql \
    supabase/migrations/0003_views_and_logic.sql \
    supabase/migrations/0004_reference_data.sql \
    supabase/migrations/0010_tenancy_schema.sql \
    supabase/migrations/0011_tenancy_backfill.sql \
    supabase/migrations/0012_tenancy_security.sql \
    supabase/migrations/0013_tenancy_functions.sql
  do
    [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }

    printf '\n\n-- ###########################################################################\n'
    printf -- '-- %s\n' "$f"
    printf -- '-- ###########################################################################\n\n'

    # The three Supabase couplings, removed in order:
    #
    #   * the auth.users foreign key on users.auth_id — the column survives
    #   * `grant ... to anon` / `service_role` — Supabase-only roles
    #   * the trailing diagnostic SELECTs, which would otherwise be the only
    #     visible output of a psql run and bury anything useful
    #
    # The standalone `begin;` / `commit;` in 0012 and 0013 are stripped too.
    # They were right for a paste into the Supabase SQL editor, where each file
    # runs alone. Here the files are concatenated and the applier wraps the whole
    # load in one transaction — leaving them in would commit partway through, so
    # a later failure would leave the schema half-applied instead of rolling all
    # of it back. That is exactly what happened on the first attempt.
    sed -E \
      -e 's/ references auth\.users \(id\) on delete set null//' \
      -e 's/ references auth\.users \(id\)//' \
      -e '/^(revoke|grant) .*(anon|service_role)/d' \
      -e 's/, (anon|service_role)//g' \
      -e 's/(anon|service_role), //g' \
      -e '/^(begin|commit);[[:space:]]*$/d' \
      "$f" \
    | sed '/^-- ---* diagnostics/,$d'
  done

  # ------------------------------------------------------- session context last
  printf '\n\n-- ###########################################################################\n'
  printf -- '-- neon/migrations/0001_session_context.sql  (MUST BE LAST)\n'
  printf -- '-- ###########################################################################\n\n'
  sed '/^-- ---* diagnostics/,$d' neon/migrations/0001_session_context.sql

  cat <<'FOOTER'


-- ------------------------------------------------------------- verification
-- Table count. Expect 35: the original 28 plus the seven tenancy tables.
select count(*) as tables from pg_tables where schemaname = 'public';

-- No policy may still reference auth.uid(): each one that does is a policy that
-- can never match, and a screen that will silently show nothing.
select
  c.relname as table_name,
  p.polname as policy
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (pg_get_expr(p.polqual, p.polrelid) ilike '%auth.uid%'
       or pg_get_expr(p.polwithcheck, p.polrelid) ilike '%auth.uid%');

-- Nothing may still depend on the auth schema.
--
-- prokind = 'f' restricts this to ordinary functions. pg_proc also holds
-- aggregates and window functions, and pg_get_functiondef() raises on those
-- ("array_agg" is an aggregate function) rather than returning null — so
-- without the filter this check aborts instead of reporting.
select
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%auth.uid%';
FOOTER
} > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT") lines)"
echo
echo "Next:"
echo "  1. Review it — particularly that no policy still mentions auth.uid()"
echo "  2. psql \"\$DATABASE_URL\" -f $OUT"
echo "  3. Run the verification queries at the end; all three must come back empty or as expected"
