-- =============================================================================
-- Neon 0001 — Session context: the replacement for Supabase Auth
--
-- This is the linchpin of the whole re-platform. Everything else is mechanical;
-- this is the part that decides whether the security model survives the move.
--
-- THE PROBLEM
--
-- On Supabase, every RLS policy resolves the caller through auth.uid(), a
-- function GoTrue provides that reads the verified JWT out of the request. Neon
-- is Postgres and nothing else: there is no auth schema, no GoTrue, no
-- auth.uid(). Ported unchanged, every policy would evaluate to null and the
-- database would deny everything to everyone.
--
-- THE REPLACEMENT
--
-- The backend authenticates the request, then tells the database who is calling
-- by setting a transaction-local setting before running any query:
--
--     begin;
--     set local app.user_id    = '42';
--     set local app.company_id = '1';
--     -- ... the actual query, with RLS now able to see the caller ...
--     commit;
--
-- app_user_id() reads that setting instead of auth.uid(). Every policy and
-- every helper above it is then unchanged — which is the point. The isolation
-- model in 0012 keeps working line for line.
--
-- WHY `SET LOCAL` AND NOT `SET`
--
-- `set local` is scoped to the transaction and is discarded on commit or
-- rollback. Plain `set` persists for the whole session, and with a connection
-- pool a session is reused by the next request — so a plain `set` would leak
-- one user's identity into another user's query. That is a cross-tenant breach
-- with a very ordinary-looking cause, and it is the single easiest way to get
-- this migration wrong.
--
-- WHY THE APPLICATION MUST NOT CONNECT AS THE TABLE OWNER
--
-- Postgres exempts a table's owner from its own RLS unless FORCE ROW LEVEL
-- SECURITY is set. Connecting the app as the owner would silently disable every
-- policy in this database. The `hrms_app` role below is deliberately not the
-- owner, and the backend must use it — never the Neon default role, which is.
-- =============================================================================


-- ---------------------------------------------------------- application role
-- The role the backend connects as. It owns nothing, so RLS always applies.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hrms_app') then
    create role hrms_app nologin;
  end if;
end $$;

comment on role hrms_app is
  'The role the API server connects as. Deliberately owns no tables, so row level security is never bypassed.';

-- Every policy is declared `to authenticated`, carried over unchanged from
-- Supabase. A policy only applies to roles it names, so without this membership
-- hrms_app would match no policy at all — and a table with RLS enabled and no
-- applicable policy denies everything. The symptom would be an app that
-- authenticates fine and then shows empty screens everywhere.
grant authenticated to hrms_app;


-- ------------------------------------------------------------ session getters
-- The `true` second argument makes current_setting() return null instead of
-- raising when the setting is absent — an unauthenticated request must read as
-- "nobody", not as an error.

create or replace function public.app_user_id()
returns integer
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::integer
$$;

-- Read straight from the session rather than looked up from users, because the
-- backend has already resolved it while authenticating. One less query per
-- policy evaluation, and it is the value the request was authorised against.
create or replace function public.app_company_id()
returns integer
language sql
stable
as $$
  select nullif(current_setting('app.company_id', true), '')::integer
$$;

create or replace function public.app_employee_id()
returns integer
language sql
stable
as $$
  select e.id from employees e where e.user_id = public.app_user_id()
$$;

create or replace function public.app_role()
returns text
language sql
stable
as $$
  select r.name
  from users u
  join roles r on r.id = u.role_id
  where u.id = public.app_user_id() and u.is_active
$$;

create or replace function public.app_is_super_admin()
returns boolean
language sql
stable
as $$
  select public.app_role() = 'super_admin' and current_setting('app.company_id', true) is null
$$;

create or replace function public.app_is_hr()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin')
$$;

create or replace function public.app_is_founder()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin')
$$;

create or replace function public.app_manages_projects()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin', 'project_manager')
$$;

create or replace function public.app_manages_tasks()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin', 'project_manager', 'team_lead')
$$;

create or replace function public.app_module_enabled(p_module text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from company_modules m
    where m.company_id = public.app_company_id()
      and m.module = p_module
      and m.is_enabled
  )
$$;


-- ------------------------------------------------------- the session profile
-- current_user_profile() also resolved the caller through auth.uid(), so it
-- needs the same treatment as the helpers above — without this it survives the
-- port still calling a function that does not exist, and sign-in returns null
-- for everybody.
--
-- The shape of the returned object is unchanged, because AuthContext.tsx reads
-- it field by field and the brief is explicit that the frontend does not change.
create or replace function public.current_user_profile()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'role', r.name,
    'full_name', coalesce(e.full_name, u.email),
    'employee_id', e.id,
    'photo_url', e.photo_url,
    'company_id', u.company_id,
    'company_name', c.name,
    'company_code', c.code,
    'company_logo_url', c.logo_url,
    'is_super_admin', (u.company_id is null and r.name = 'super_admin'),
    'modules', coalesce(
      (select jsonb_agg(m.module order by m.module)
       from company_modules m
       where m.company_id = u.company_id and m.is_enabled),
      '[]'::jsonb
    ),
    'support_company_id', (
      select s.company_id from support_sessions s
      where s.super_admin_user_id = u.id and s.ended_at is null
      order by s.started_at desc limit 1
    )
  )
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  left join companies c on c.id = u.company_id
  where u.id = public.app_user_id() and u.is_active
$$;


-- ------------------------------------------------------------------- grants
-- SECURITY INVOKER, not DEFINER. On Supabase these helpers had to be DEFINER to
-- read users while its own policies were being evaluated; here they read a
-- session setting, so there is nothing to elevate for. Fewer privileged
-- functions is strictly better.
grant usage on schema public to hrms_app;
grant select, insert, update, delete on all tables in schema public to hrms_app;
grant usage, select on all sequences in schema public to hrms_app;
grant execute on all functions in schema public to hrms_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to hrms_app;
alter default privileges in schema public
  grant usage, select on sequences to hrms_app;


-- ------------------------------------------------------------- credentials
-- Supabase kept password hashes in auth.users, which does not exist here. They
-- move onto the app's own users table — this is the one schema change the
-- re-platform genuinely requires, and it is why authentication cannot be left
-- untouched as your brief hoped.
--
-- bcrypt via pgcrypto, matching what GoTrue produced, so existing hashes can be
-- copied across and every current password keeps working.
create extension if not exists pgcrypto;

alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists email_confirmed_at timestamptz;
alter table public.users add column if not exists last_sign_in_at timestamptz;

-- auth_id becomes vestigial: it pointed into auth.users, which is not here. It
-- is kept, nullable and without its foreign key, purely so rows can still be
-- matched back to the Supabase project during the data migration.
alter table public.users alter column auth_id drop not null;
comment on column public.users.auth_id is
  'Vestigial. Was a foreign key into Supabase auth.users; retained only to correlate rows during migration.';


-- ------------------------------------------------------------- diagnostics
-- With no session set, every getter must return null and app_is_hr() must be
-- false. If any of them returns a value here, the policies are not actually
-- reading the session and isolation is not being enforced.
select
  public.app_user_id()    as user_id_unset,
  public.app_company_id() as company_id_unset,
  public.app_role()       as role_unset,
  public.app_is_hr()      as is_hr_unset;

-- And with one set, they must resolve. Run inside a transaction so the setting
-- is discarded afterwards.
begin;
  set local app.user_id = '1';
  set local app.company_id = '1';
  select
    public.app_user_id()    as user_id_set,
    public.app_company_id() as company_id_set,
    public.app_role()       as role_set;
rollback;
