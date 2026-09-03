-- =============================================================================
-- Neon 0014 — Fix super-admin detection
--
-- THE BUG
--
-- app_is_super_admin() tested the session setting directly:
--
--     current_setting('app.company_id', true) is null
--
-- but the API sets that setting to an EMPTY STRING for a user with no company,
-- because set_config() takes text and there is no way to set a true NULL. So
-- the test was false for exactly the person it was meant to identify, and the
-- platform admin was refused by every function guarding on it — including the
-- console built for them.
--
-- app_company_id() never had the problem because it wraps the read in
-- nullif(..., ''). Two functions reading the same setting disagreed about what
-- "unset" looks like, and only one of them was right.
--
-- THE FIX
--
-- Derive it from app_company_id() rather than re-reading the setting, so there
-- is one definition of "no company" and it cannot drift again.
-- =============================================================================

create or replace function public.app_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_role() = 'super_admin'
     and public.app_company_id() is null
$$;


-- ------------------------------------------------------------- diagnostics
-- Read back what actually landed, rather than a transactional experiment.
--
-- The first version of this file ended with `begin; set local …; rollback;` to
-- demonstrate the fix. The whole file runs as one implicit transaction, so that
-- rollback discarded the CREATE OR REPLACE above it — the migration reported
-- success and changed nothing. Diagnostics in a migration must never open a
-- transaction of their own.
select
  p.proname,
  pg_get_functiondef(p.oid) ilike '%app_company_id()%'  as uses_app_company_id,
  pg_get_functiondef(p.oid) ilike '%current_setting%'   as still_reads_setting_directly
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'app_is_super_admin';
