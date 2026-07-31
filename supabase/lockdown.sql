-- =============================================================================
-- EMERGENCY LOCKDOWN — run this first, before anything else
--
-- The project currently holds the old FastAPI schema, which was built on the
-- assumption that only a trusted backend could reach it. Nothing in it has row
-- level security. Now that a browser talks to Postgres directly with a
-- publishable key — a key that ships inside the JavaScript bundle and is
-- readable by anyone who opens the deployed site — every table is world
-- readable and world writable. Verified against the live project: an anonymous
-- caller can read users.hashed_password and can insert rows.
--
-- This file shuts that off in one statement. It enables RLS on every table in
-- `public` and withdraws the blanket grants. With no policies attached, the
-- effect is deny-everything for anon and authenticated.
--
-- It deletes nothing and is safe to re-run. The app will not work until the
-- real migrations are applied — but right now, nothing working is the point.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('alter table public.%I force row level security', r.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Confirm: every table should now report rls_enabled = true.
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;
