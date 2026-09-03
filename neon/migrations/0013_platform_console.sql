-- =============================================================================
-- Neon 0013 — The platform console
--
-- A super admin belongs to no company, so app_company_id() is null for them and
-- every tenant policy matches nothing. That is the right default — platform
-- staff should not browse customer records by accident — but it also means they
-- currently see an empty HRMS and can do nothing at all.
--
-- This gives them the two things the role actually needs:
--
--   1. An overview of every company: headcount, activity, plan, status. Counts
--      and status, not employee records — enough to run the business and to
--      know which customer is in trouble, without reading anyone's payroll.
--
--   2. Support sessions. Entering a company is a deliberate, recorded act with
--      a start, an end, and a reason. While one is open app_company_id()
--      resolves to that company and the super admin sees exactly what a user
--      there would see — no more.
--
-- Every function re-checks app_is_super_admin(). SECURITY DEFINER bypasses row
-- level security, so a function that trusted its caller would hand the whole
-- platform to anyone who could reach it.
-- =============================================================================

-- --------------------------------------------------------------- overview
-- Aggregates only. A super admin can see that a company has 7 employees and 56
-- payslips; reading who they are or what they earn requires a support session,
-- which leaves a record.
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
  if not public.app_is_super_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'code', c.code,
      'status', c.status,
      'onboarding_status', c.onboarding_status,
      'email', c.email,
      'country', c.country,
      'industry', c.industry,
      'logo_url', c.logo_url,
      'primary_color', c.primary_color,
      'registered_on', c.registered_on,
      'employee_limit', c.employee_limit,
      'created_at', c.created_at,
      'employees', (select count(*) from employees e where e.company_id = c.id and e.status = 'active'),
      'users', (select count(*) from users u where u.company_id = c.id and u.is_active),
      'payslips', (select count(*) from payslips p where p.company_id = c.id),
      'pending_leave', (select count(*) from leave_requests l
                         where l.company_id = c.id and l.status = 'pending'),
      'modules', (select count(*) from company_modules m
                   where m.company_id = c.id and m.is_enabled),
      'plan', (select p.name from company_subscriptions s
                 join subscription_plans p on p.id = s.plan_id
                where s.company_id = c.id and s.status in ('trialing','active','past_due')
                limit 1),
      -- Null means nobody there has ever signed in, which is the single most
      -- useful signal that an onboarding has stalled.
      'last_sign_in', (select max(u.last_sign_in_at) from users u where u.company_id = c.id),
      'support_open', exists (select 1 from support_sessions s
                               where s.company_id = c.id and s.ended_at is null)
    ) as row
    from companies c
  ) rows;

  return v_result;
end;
$$;


-- ------------------------------------------------------- platform totals
create or replace function public.platform_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_is_super_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'companies',        (select count(*) from companies),
    'active_companies', (select count(*) from companies where status = 'active'),
    'inactive_companies', (select count(*) from companies where status <> 'active'),
    'employees',        (select count(*) from employees where status = 'active'),
    'subscriptions',    (select count(*) from company_subscriptions
                          where status in ('trialing','active','past_due')),
    'open_support',     (select count(*) from support_sessions where ended_at is null)
  );
end;
$$;


-- ------------------------------------------------------- support sessions
-- Opening one is what lets a super admin see inside a tenant. It is a row, so
-- it is queryable, auditable, and visible to the customer — support_sessions
-- has a read policy letting a company see when it was accessed.
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
  if not public.app_is_super_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  -- One at a time. Two open sessions would make app_company_id() depend on
  -- which sorted first, so the super admin would not reliably know which
  -- company they were acting inside.
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
  if not public.app_is_super_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  update support_sessions set ended_at = now()
   where super_admin_user_id = v_user and ended_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


grant execute on function public.platform_company_overview()             to hrms_app;
grant execute on function public.platform_summary()                      to hrms_app;
grant execute on function public.start_support_session(integer, text)    to hrms_app;
grant execute on function public.end_support_session()                   to hrms_app;


-- ------------------------------------------------------------- diagnostics
select p.proname, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('platform_company_overview','platform_summary',
                    'start_support_session','end_support_session')
order by p.proname;
