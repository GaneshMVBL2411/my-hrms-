-- =============================================================================
-- Onboard a new client company: Prozonic
--
-- Run this whole file in the Supabase SQL Editor, as the `postgres` role.
--
-- REQUIRES 0010, 0011 AND 0012 TO BE APPLIED FIRST. Without them there is no
-- `companies` table and this file fails on its first statement. Check with:
--
--     select count(*) from public.companies;
--
-- This is the SQL form of the Add Company workflow — the same steps the Super
-- Admin screen will perform once it exists. Keep it as the template for every
-- client after Prozonic: change the block of values at the top and re-run.
--
-- What a new tenant needs, and what this creates:
--   1. the company row
--   2. a subscription, which decides the headcount ceiling
--   3. enabled modules, which decide the sidebar and what RLS will allow
--   4. its own departments and designations — these are tenant-owned, so a new
--      company starts with none and cannot borrow another company's
--   5. a company admin: auth login + users row + employees row
--
-- Idempotent: re-running reports what already exists and changes nothing.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  -- ------------------------------------------------------ company details
  -- EDIT THIS BLOCK. Everything below is derived from it.
  v_name        text := 'Prozonic';
  v_code        text := 'PRZ';          -- becomes the employee code prefix: PRZ-1001
  v_email       text := 'hr@prozonic.com';
  v_phone       text := null;
  v_website     text := null;
  v_address     text := null;
  v_city        text := null;
  v_state       text := null;
  v_country     text := 'India';
  v_industry    text := 'Technology';
  v_logo_url    text := '/prozonic-logo.png';
  v_plan        text := 'Professional';

  -- The first person who can sign in and run their HRMS.
  v_admin_email    text := 'admin@prozonic.com';
  v_admin_password text := encode(extensions.gen_random_bytes(16), 'base64');
  v_admin_first    text := 'Prozonic';
  v_admin_last     text := 'Admin';

  -- Modules this company may use. Anything omitted is invisible in the sidebar
  -- AND refused by row level security, so leaving one out is a real restriction
  -- rather than a cosmetic one.
  v_modules text[] := array[
    'employees', 'attendance', 'leaves', 'payroll',
    'documents', 'reports', 'calendar', 'announcements', 'settings'
  ];

  -- Each tenant starts with its own org structure. Prozonic's, not Whhohh's.
  v_departments  text[] := array['Engineering', 'Operations', 'Sales'];
  v_designations text[] := array['Software Engineer', 'Operations Executive', 'Sales Executive'];

  -- ---------------------------------------------------------------- working
  v_company_id integer;
  v_plan_id    integer;
  v_limit      integer;
  v_auth_id    uuid;
  v_role_id    integer;
  v_user_id    integer;
  v_emp_id     integer;
  v_dept_id    integer;
  v_desig_id   integer;
  v_item       text;
begin
  -- ------------------------------------------------------------ 1. company
  select id into v_company_id from public.companies where upper(code) = upper(v_code);

  if v_company_id is not null then
    raise notice 'Company % already exists as #%. Nothing changed.', v_code, v_company_id;
    return;
  end if;

  select id, employee_limit into v_plan_id, v_limit
  from public.subscription_plans where name = v_plan;

  if v_plan_id is null then
    raise exception 'No subscription plan named %. Check public.subscription_plans.', v_plan;
  end if;

  insert into public.companies (
    name, code, email, phone, website, address, city, state, country,
    industry, logo_url, status, onboarding_status, employee_limit
  )
  values (
    v_name, upper(v_code), v_email, v_phone, v_website, v_address, v_city, v_state, v_country,
    v_industry, v_logo_url, 'active', 'setup_in_progress', v_limit
  )
  returning id into v_company_id;

  raise notice 'Created company #% — % (%)', v_company_id, v_name, upper(v_code);

  -- ------------------------------------------------------- 2. subscription
  insert into public.company_subscriptions (
    company_id, plan_id, status, billing_cycle, start_date, employee_limit)
  values (v_company_id, v_plan_id, 'active', 'monthly', current_date, v_limit);

  -- ----------------------------------------------------------- 3. modules
  insert into public.company_modules (company_id, module, is_enabled)
  select v_company_id, m, true from unnest(v_modules) as m
  on conflict (company_id, module) do nothing;

  raise notice '  % modules enabled', array_length(v_modules, 1);

  -- ------------------------------------------------- 4. org structure
  foreach v_item in array v_departments loop
    insert into public.departments (company_id, name) values (v_company_id, v_item);
  end loop;

  foreach v_item in array v_designations loop
    insert into public.designations (company_id, title) values (v_company_id, v_item);
  end loop;

  select id into v_dept_id  from public.departments  where company_id = v_company_id order by id limit 1;
  select id into v_desig_id from public.designations where company_id = v_company_id order by id limit 1;

  -- ------------------------------------------------------ 5. company admin
  -- What auth.admin.createUser({email_confirm: true}) writes, by hand. GoTrue
  -- verifies encrypted_password as bcrypt, and an unconfirmed address is
  -- refused at sign-in, so both are set here.
  if exists (select 1 from auth.users where lower(email) = lower(v_admin_email)) then
    raise exception 'A login already exists for %. Use a different address or delete it first.', v_admin_email;
  end if;

  v_auth_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    '00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated',
    lower(v_admin_email), extensions.crypt(v_admin_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  -- provider_id for the email provider is the user's uuid — GoTrue reads it
  -- back out of identity_data->>'sub', so the two must agree.
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_auth_id,
    jsonb_build_object('sub', v_auth_id::text, 'email', lower(v_admin_email), 'email_verified', true),
    'email', v_auth_id::text, now(), now(), now());

  -- company_admin runs their own company; it is not the platform super admin.
  select id into v_role_id from public.roles where name = 'company_admin';
  if v_role_id is null then
    select id into v_role_id from public.roles where name = 'founder';
  end if;
  if v_role_id is null then
    raise exception 'Neither company_admin nor founder exists in public.roles.';
  end if;

  insert into public.users (company_id, auth_id, email, role_id, is_active)
  values (v_company_id, v_auth_id, lower(v_admin_email), v_role_id, true)
  returning id into v_user_id;

  insert into public.employees (
    company_id, user_id, employee_code, first_name, last_name,
    department_id, designation_id, joining_date, status)
  values (
    v_company_id, v_user_id, public.next_employee_code(v_company_id),
    v_admin_first, v_admin_last, v_dept_id, v_desig_id, current_date, 'active')
  returning id into v_emp_id;

  -- Leave balances come from the platform's default leave types (company_id
  -- null); the company can add its own types later.
  insert into public.leave_balances (company_id, employee_id, leave_type_id, year, allocated_days, used_days)
  select v_company_id, v_emp_id, lt.id, extract(year from current_date), lt.default_days_per_year, 0
  from public.leave_types lt
  where lt.company_id is null or lt.company_id = v_company_id;

  update public.companies set onboarding_status = 'ready' where id = v_company_id;

  raise notice '  admin % created as employee #%', v_admin_email, v_emp_id;
  raise notice 'Done. % is ready — sign in as % / %', v_name, v_admin_email, v_admin_password;
end $$;


-- ------------------------------------------------------------- diagnostics
-- Every tenant, with what it owns. Whhohh Path's counts must be unchanged —
-- if they moved, something crossed the tenant boundary.
select
  c.id,
  c.name,
  c.code,
  c.status,
  c.onboarding_status,
  (select count(*) from public.employees   e where e.company_id = c.id) as employees,
  (select count(*) from public.departments d where d.company_id = c.id) as departments,
  (select count(*) from public.company_modules m where m.company_id = c.id and m.is_enabled) as modules,
  (select p.name from public.company_subscriptions s
     join public.subscription_plans p on p.id = s.plan_id
    where s.company_id = c.id and s.status = 'active' limit 1) as plan
from public.companies c
order by c.id;
