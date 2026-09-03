-- =============================================================================
-- Neon 0015 — Separate platform identity from session scope
--
-- THE BUG
--
-- app_is_super_admin() means "this session can see across tenants", and after
-- 0014 it is derived from app_company_id() being null. That is right for the
-- RLS policies: inside a support session a platform admin should see one
-- company's data and no more.
--
-- But the platform functions guarded on the same thing. Opening a session sets
-- a company, which makes app_is_super_admin() false, which makes
-- end_support_session() refuse the very person who opened it. The admin could
-- enter a customer's account and had no way back out — the worst possible
-- direction for that failure to go.
--
-- THE FIX
--
-- Two functions, because there are two questions:
--
--   app_is_super_admin()   is this SESSION unscoped?   — for policies
--   app_is_platform_user() is this PERSON platform staff? — for the console
--
-- The second reads the user's own row, so it stays true regardless of which
-- company the session is currently pointed at.
-- =============================================================================

create or replace function public.app_is_platform_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from users u
    join roles r on r.id = u.role_id
    where u.id = public.app_user_id()
      and u.is_active
      -- Owning no company is what makes an account the platform's. Checked on
      -- the row, not the session, so an open support session does not hide it.
      and u.company_id is null
      and r.name = 'super_admin'
  )
$$;

grant execute on function public.app_is_platform_user() to hrms_app;


-- The console and the session controls all move to the identity check, so they
-- keep working while a session is open — which is what lets the admin see where
-- they are and get back out.
create or replace function public.platform_company_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'code', c.code, 'status', c.status,
      'onboarding_status', c.onboarding_status, 'email', c.email,
      'country', c.country, 'industry', c.industry, 'logo_url', c.logo_url,
      'primary_color', c.primary_color, 'registered_on', c.registered_on,
      'employee_limit', c.employee_limit, 'created_at', c.created_at,
      'employees', (select count(*) from employees e where e.company_id = c.id and e.status = 'active'),
      'users', (select count(*) from users u where u.company_id = c.id and u.is_active),
      'payslips', (select count(*) from payslips p where p.company_id = c.id),
      'pending_leave', (select count(*) from leave_requests l
                         where l.company_id = c.id and l.status = 'pending'),
      'modules', (select count(*) from company_modules m
                   where m.company_id = c.id and m.is_enabled),
      'plan', (select p.name from company_subscriptions s
                 join subscription_plans p on p.id = s.plan_id
                where s.company_id = c.id and s.status in ('trialing','active','past_due') limit 1),
      'last_sign_in', (select max(u.last_sign_in_at) from users u where u.company_id = c.id),
      'support_open', exists (select 1 from support_sessions s
                               where s.company_id = c.id and s.ended_at is null)
    ) as row
    from companies c
  ) rows;

  return v_result;
end;
$$;


create or replace function public.platform_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'companies',          (select count(*) from companies),
    'active_companies',   (select count(*) from companies where status = 'active'),
    'inactive_companies', (select count(*) from companies where status <> 'active'),
    'employees',          (select count(*) from employees where status = 'active'),
    'subscriptions',      (select count(*) from company_subscriptions
                            where status in ('trialing','active','past_due')),
    'open_support',       (select count(*) from support_sessions where ended_at is null)
  );
end;
$$;


create or replace function public.start_support_session(p_company_id integer, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user integer := public.app_user_id();
  v_id integer;
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  -- Switching companies closes the previous session rather than stacking, so
  -- app_company_id() is never ambiguous about where the admin is.
  update support_sessions set ended_at = now()
   where super_admin_user_id = v_user and ended_at is null;

  insert into support_sessions (super_admin_user_id, company_id, reason)
  values (v_user, p_company_id, p_reason)
  returning id into v_id;

  return v_id;
end;
$$;


create or replace function public.end_support_session()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user integer := public.app_user_id();
  v_count integer;
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  update support_sessions set ended_at = now()
   where super_admin_user_id = v_user and ended_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ------------------------------------------------------------- diagnostics
-- No transaction here: a `rollback` in a migration's diagnostics discards the
-- migration itself, which is how 0014 silently applied nothing the first time.
select
  p.proname,
  pg_get_functiondef(p.oid) ilike '%app_is_platform_user%' as uses_identity_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('platform_company_overview', 'platform_summary',
                    'start_support_session', 'end_support_session',
                    'app_is_platform_user')
order by p.proname;
