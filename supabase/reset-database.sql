-- =============================================================================
-- Reset `public` so the migrations can be applied to a clean project
--
-- DESTRUCTIVE. Drops every table, view, function and enum this app owns in the
-- `public` schema, along with all their data. Objects owned by an extension are
-- left alone, and nothing outside `public` is touched — Supabase's own `auth`
-- and `storage` schemas, and the logins inside them, survive.
--
-- Why this is needed: the project was set up with the old FastAPI schema
-- (Alembic + seed.py), which the current app cannot use. `users` still carries
-- `hashed_password` instead of `auth_id`, and none of the views or functions the
-- frontend calls exist. Migration 0001 cannot run over it because the table
-- names collide.
--
-- Run order:
--   1. lockdown.sql          (close the public access first)
--   2. reset-database.sql    (this file)
--   3. migrations/0001 … 0006, in order
--   4. node supabase/seed.mjs
--
-- If any of the data in there matters, export it from the Table Editor before
-- running this. Everything under Authentication -> Users is unaffected, so
-- delete those logins too if you want a genuinely fresh start — the seed will
-- skip any email that already has one.
-- =============================================================================

do $$
declare
  r record;
begin
  -- Views before tables: a view over a dropped table is already gone, but
  -- dropping them first keeps the cascade noise down.
  for r in
    select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('drop view if exists public.%I cascade', r.table_name);
  end loop;

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      -- Skip anything an extension owns; dropping those fails outright.
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('drop table if exists public.%I cascade', r.relname);
  end loop;

  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.signature);
  end loop;

  for r in
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype = 'e'
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;

-- Should return no rows.
select 'left behind: ' || tablename as leftovers from pg_tables where schemaname = 'public';
