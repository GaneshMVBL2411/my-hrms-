-- =============================================================================
-- 0011 — Multi-tenancy: backfill
--
-- Turns the existing single-company data into tenant #1 and makes `company_id`
-- mandatory. 0010 added the column and left it empty; this file fills it in.
--
-- THIS IS THE POINT OF NO RETURN. Everything before it was additive and could
-- be dropped; after it, `company_id` is NOT NULL on 23 tables and reverting
-- means dropping the constraint again. Take a database backup first —
-- Supabase dashboard -> Database -> Backups — and verify it restores.
--
-- Behaviour still does not change. The policies do not read `company_id` until
-- 0012, so the app keeps working identically while this lands. That is the
-- point of the split: if something is wrong here, it is visible in the
-- diagnostics below before any policy depends on it.
--
-- Safe to re-run: the company is created only if absent, the updates only touch
-- rows where company_id is null, and the constraints are guarded.
-- =============================================================================

do $$
declare
  v_company_id integer;
  v_plan_id    integer;
  v_name       text;
  v_address    text;
  v_logo       text;
  v_rows       integer;
  v_total      integer := 0;
  t            text;

  -- The same list as 0010, minus the two that stay nullable by design:
  --   users        — a super admin has no company
  --   leave_types  — null means a platform-wide default
  tenant_tables text[] := array[
    'employees', 'departments', 'designations',
    'attendance_records', 'leave_balances', 'leave_requests',
    'projects', 'project_members', 'tasks', 'task_checklist_items',
    'task_comments', 'assets', 'asset_assignments',
    'candidates', 'interviews',
    'salary_structures', 'payslips',
    'policies', 'generated_letters',
    'announcements', 'company_events',
    'company_settings', 'audit_logs'
  ];
begin
  -- ------------------------------------------------------- 1. the first tenant
  -- Identity comes from company_settings, which is where the single-company
  -- build kept it. Falling back to the seeded name keeps this runnable on a
  -- database where settings were never filled in.
  select company_name, address, logo_url
    into v_name, v_address, v_logo
  from public.company_settings
  order by id
  limit 1;

  v_name := coalesce(v_name, 'Whhohh Path LLP');

  select id into v_company_id from public.companies where upper(code) = 'WPL';

  if v_company_id is null then
    insert into public.companies (
      name, code, address, logo_url,
      status, onboarding_status, employee_limit, notes
    )
    values (
      v_name, 'WPL', v_address, v_logo,
      'active', 'active', null,
      'The original tenant. Every row that existed before multi-tenancy belongs here.'
    )
    returning id into v_company_id;

    raise notice 'Created company #% — %', v_company_id, v_name;
  else
    raise notice 'Company WPL already exists as #%; reusing it.', v_company_id;
  end if;

  -- --------------------------------------------------- 2. plans and services
  -- Minimal catalogue so the first tenant has a subscription to point at. The
  -- super admin edits these later; they are starting points, not fixtures.
  insert into public.subscription_plans (name, description, employee_limit, storage_mb, price_amount, default_modules)
  values
    ('Starter',      'Core HR for small teams.',              25,   1024,  0,     array['employees','attendance','leaves','documents']),
    ('Professional', 'Full HR with payroll and projects.',    150,  10240, 4999,  array['employees','attendance','leaves','payroll','projects','tasks','assets','documents','reports','calendar','announcements']),
    ('Enterprise',   'Everything, with recruitment.',         null, 51200, 14999, array['employees','attendance','leaves','payroll','projects','tasks','assets','recruitment','documents','reports','calendar','announcements','settings']),
    ('Internal',     'The platform owner''s own company.',    null, null,  0,     array['employees','attendance','leaves','payroll','projects','tasks','assets','recruitment','documents','reports','calendar','announcements','settings'])
  on conflict (name) do nothing;

  insert into public.platform_services (name, description)
  values
    ('HRMS Setup',              'Initial configuration of a new company.'),
    ('Payroll Support',         'Assistance running and verifying payroll.'),
    ('HR Consulting',           'Advisory on policy and process.'),
    ('Employee Data Migration', 'Importing records from a previous system.'),
    ('Attendance Configuration','Working hours, shifts and rules.'),
    ('Leave Policy Configuration', 'Leave types, balances and approval flow.'),
    ('Custom Reports',          'Reports beyond the standard set.'),
    ('Technical Support',       'Break-fix and troubleshooting.'),
    ('Training',                'Onboarding sessions for company staff.'),
    ('System Customization',    'Bespoke changes to the platform.')
  on conflict (name) do nothing;

  select id into v_plan_id from public.subscription_plans where name = 'Internal';

  insert into public.company_subscriptions (company_id, plan_id, status, billing_cycle, start_date)
  select v_company_id, v_plan_id, 'active', 'annual', current_date
  where not exists (
    select 1 from public.company_subscriptions
    where company_id = v_company_id and status in ('trialing', 'active', 'past_due')
  );

  -- ----------------------------------------------------------- 3. modules on
  -- Everything the first tenant already uses stays on. `banking` is absent on
  -- purpose: the module's tables do not exist on this database, so enabling it
  -- would put a link in the sidebar that leads to a broken page.
  insert into public.company_modules (company_id, module, is_enabled)
  select v_company_id, m, true
  from unnest(array[
    'employees', 'attendance', 'leaves', 'projects', 'tasks',
    'payroll', 'assets', 'recruitment', 'documents',
    'calendar', 'announcements', 'reports', 'settings'
  ]) as m
  on conflict (company_id, module) do nothing;

  -- --------------------------------------------------------- 4. the backfill
  -- Only rows still unassigned, so a re-run is a no-op rather than a rewrite.
  foreach t in array tenant_tables loop
    execute format('update public.%I set company_id = $1 where company_id is null', t)
      using v_company_id;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    if v_rows > 0 then
      raise notice '  % — % rows', t, v_rows;
    end if;
  end loop;

  -- Existing users all belong to the first tenant. Super admins created later
  -- are the only rows that stay null.
  update public.users set company_id = v_company_id where company_id is null;
  get diagnostics v_rows = row_count;
  raise notice '  users — % rows', v_rows;

  raise notice 'Backfilled % rows into company #%', v_total + v_rows, v_company_id;

  -- ------------------------------------------------------- 5. make it required
  -- Applied only once every row is assigned, so the constraint cannot fail
  -- halfway and leave the schema inconsistent with the data.
  foreach t in array tenant_tables loop
    execute format('alter table public.%I alter column company_id set not null', t);
  end loop;

  raise notice 'company_id is now NOT NULL on % tables', array_length(tenant_tables, 1);
end $$;


-- ---------------------------------------------------- employee code per tenant
-- next_employee_code() counted every employee in the database, which was right
-- for one company and wrong the moment there are two: the next company's first
-- hire would be numbered WP-1008. It now counts within a company and takes its
-- prefix from that company's code, so each tenant numbers from its own 1001.
--
-- Replaced here rather than in 0013 because the old version is actively wrong
-- as soon as a second company exists, and 0012 may sit between the two.
create or replace function public.next_employee_code(p_company_id integer)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(c.code, 'EMP') || '-' ||
         ((select count(*) from employees e where e.company_id = p_company_id) + 1001)::text
  from companies c
  where c.id = p_company_id
$$;

revoke execute on function public.next_employee_code(integer) from public, anon, authenticated;
grant execute on function public.next_employee_code(integer) to service_role;


-- ------------------------------------------------------------- diagnostics
-- 1. The tenant, and how much now belongs to it.
select
  c.id,
  c.name,
  c.code,
  c.status,
  (select count(*) from public.employees e where e.company_id = c.id) as employees,
  (select count(*) from public.users u    where u.company_id = c.id)  as users,
  (select count(*) from public.payslips p where p.company_id = c.id)  as payslips,
  (select count(*) from public.company_modules m where m.company_id = c.id and m.is_enabled) as modules_on
from public.companies c
order by c.id;

-- 2. Anything still unassigned. Expect zero rows: a table listed here means the
--    backfill missed it and its NOT NULL would have failed.
select 'users' as table_name, count(*) as unassigned from public.users where company_id is null
union all select 'employees',       count(*) from public.employees       where company_id is null
union all select 'attendance',      count(*) from public.attendance_records where company_id is null
union all select 'leave_requests',  count(*) from public.leave_requests  where company_id is null
union all select 'payslips',        count(*) from public.payslips        where company_id is null
union all select 'audit_logs',      count(*) from public.audit_logs      where company_id is null;
