-- =============================================================================
-- Neon 0006 — Tenant-scope the remaining payroll and document functions
--
-- Closes four of the eight functions 0013 left unscoped. They were harmless
-- while `company_id` was nullable; now that it is NOT NULL, the first of them
-- fails outright:
--
--   null value in column "company_id" of relation "payslips"
--
-- which is a useful accident — the constraint caught a function that would
-- otherwise have written rows belonging to no tenant, or read across all of
-- them. The others do not error; they simply see too much, which is worse
-- because nothing reports it.
--
-- Also adds the joining-date rule: a payslip for a month before someone was
-- employed is not a payslip, it is a fabrication. The original had no such
-- check because with one company and one seeded joining date it never came up.
--
-- Still unscoped after this, for a later pass:
--   get_calendar, update_task, assign_asset, return_asset, upsert_company_settings
-- =============================================================================

create or replace function public.generate_payslips_bulk(p_month integer, p_year integer)
returns integer[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_ids integer[];
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if v_company is null then
    raise exception 'No company in this session';
  end if;

  with eligible as (
    select e.id
    from employees e
    join salary_structures s on s.employee_id = e.id and s.company_id = v_company
    where e.status = 'active'
      and e.company_id = v_company
      -- Nobody is paid for a month they had not joined. `joining_date is null`
      -- is treated as "already employed", which is how the seeded rows behave.
      and (
        e.joining_date is null
        or e.joining_date <= (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
      )
      and not exists (
        select 1 from payslips p
        where p.employee_id = e.id and p.month = p_month and p.year = p_year
          and p.company_id = v_company
      )
  ),
  inserted as (
    insert into payslips (
      company_id, employee_id, month, year, basic, hra, special_allowance, gross_pay,
      pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
    )
    select
      v_company, e.id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
      c.pf_deduction, c.esi_deduction, c.professional_tax, c.net_pay, public.app_user_id()
    from eligible e
    cross join lateral public.compute_payslip(e.id) c
    returning id
  )
  select array_agg(id) into v_ids from inserted;

  return coalesce(v_ids, '{}');
end;
$$;


create or replace function public.payroll_summary(p_month integer, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_gross numeric;
  v_net numeric;
  v_count integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(sum(gross_pay), 0), coalesce(sum(net_pay), 0), count(*)
  into v_gross, v_net, v_count
  from payslips
  where month = p_month and year = p_year and company_id = v_company;

  return jsonb_build_object(
    'month', p_month,
    'year', p_year,
    'employee_count', v_count,
    'total_gross', round(v_gross, 2),
    'total_deductions', round(v_gross - v_net, 2),
    'total_net', round(v_net, 2)
  );
end;
$$;


-- letter_payload() is already scoped; this is the wrapper the Documents screen
-- calls to view a saved letter, and it had no check of its own.
create or replace function public.get_letter_view(p_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- An employee may read their own letters; HR may read the company's.
  if not exists (
    select 1 from generated_letters l
    where l.id = p_id
      and l.company_id = public.app_company_id()
      and (l.employee_id = public.app_employee_id() or public.app_is_hr())
  ) then
    raise exception 'Letter not found' using errcode = 'P0002';
  end if;

  v_result := public.letter_payload(p_id);
  return v_result;
end;
$$;


-- ------------------------------------------------------------- diagnostics
select
  p.proname,
  pg_get_functiondef(p.oid) ilike '%app_company_id%'
    or pg_get_functiondef(p.oid) ilike '%company_id%' as tenant_aware
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.proname in (
    'generate_payslips_bulk', 'payroll_summary', 'get_letter_view',
    'get_calendar', 'update_task', 'assign_asset', 'return_asset',
    'upsert_company_settings'
  )
order by tenant_aware, p.proname;
