-- =============================================================================
-- Neon 0003 — Break the RLS recursion in the helper functions
--
-- THE BUG
--
-- 0001 defined the app_* helpers as SECURITY INVOKER, on the reasoning that
-- they read a transaction setting and so need no elevation. That is true of
-- app_user_id() and app_company_id(). It is false of every other one, because
-- they read `users` — and `users` is protected by a policy that calls them.
--
--   read users
--     -> policy users_read
--        -> app_is_super_admin()
--           -> app_role()
--              -> read users
--                 -> policy users_read
--                    -> ... until "stack depth limit exceeded"
--
-- Any query touching `users` recursed forever. Sign-in survived only because it
-- goes through authenticate(), which is SECURITY DEFINER and so never evaluates
-- the policy; /auth/me failed immediately.
--
-- THE FIX
--
-- Restore SECURITY DEFINER on every helper that reads a table, which is what
-- Supabase's originals were. A DEFINER function does not evaluate the caller's
-- policies, so the cycle is cut at the first step.
--
-- This corrects a claim made when 0001 was written — that the port would leave
-- fewer privileged functions behind. It does not. Functions consulted BY a
-- policy cannot themselves be subject to that policy, on Neon exactly as on
-- Supabase. Only the two that read nothing but the session can stay INVOKER.
-- =============================================================================

-- Unchanged: pure reads of a transaction setting, no table access, no recursion.
--   app_user_id()
--   app_company_id()

create or replace function public.app_employee_id()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id from employees e where e.user_id = public.app_user_id()
$$;

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
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
security definer
set search_path = public, pg_temp
as $$
  select public.app_role() = 'super_admin'
     and current_setting('app.company_id', true) is null
$$;

create or replace function public.app_is_hr()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin')
$$;

create or replace function public.app_is_founder()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_role() in ('founder', 'company_admin')
$$;

create or replace function public.app_manages_projects()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin', 'project_manager')
$$;

create or replace function public.app_manages_tasks()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin', 'project_manager', 'team_lead')
$$;

create or replace function public.app_module_enabled(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_modules m
    where m.company_id = public.app_company_id()
      and m.module = p_module
      and m.is_enabled
  )
$$;

-- current_user_profile() reads users, employees and companies directly, so it
-- meets the policies head-on and needs the same treatment. It is safe because
-- it resolves only the caller — app_user_id() comes from the session, which
-- only the API server sets.
create or replace function public.current_user_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
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


-- ------------------------------------------------------------- diagnostics
-- Every app_* helper, and whether it runs as its definer. The two that read
-- only the session should be false; every other one must be true, or the
-- recursion is still there.
select
  p.proname   as function_name,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'app\_%' or p.proname = 'current_user_profile')
order by p.prosecdef, p.proname;
