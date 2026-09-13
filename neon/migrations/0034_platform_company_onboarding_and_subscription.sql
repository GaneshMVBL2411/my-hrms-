-- =============================================================================
-- Neon 0034 — Platform Company Onboarding, Subscription Pricing & Payment Verification
--
-- Enables Super Admin to:
--   1. Register new client companies on the HRMS portal.
--   2. Configure dynamic subscription fees (e.g. customized monthly fee), billing cycle,
--      and verify payments (UTR reference, payment status, verification notes).
--   3. Selectively grant/revoke functional modules (Attendance, Leaves, Payroll, etc.) per tenant.
--   4. Generate initial Company Admin credentials to hand off to the client company HR.
--   5. Maintain complete tenant sovereignty: once onboarded, the client company HR
--      creates their own employees and manages internal operations.
-- =============================================================================

-- --------------------------------------------------------------- 1. Subscriptions schema update
alter table public.company_subscriptions
  add column if not exists monthly_price numeric(10, 2),
  add column if not exists payment_status varchar(30) not null default 'pending',
  add column if not exists payment_reference varchar(100),
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_notes text;

comment on column public.company_subscriptions.monthly_price is
  'Custom negotiated or plan-based monthly subscription amount in INR or local currency.';
comment on column public.company_subscriptions.payment_status is
  'Current payment verification status: verified, pending, waived, or failed.';


-- --------------------------------------------------------------- 2. Enriched platform_company_overview
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
      'id', c.id,
      'name', c.name,
      'code', c.code,
      'status', c.status,
      'onboarding_status', c.onboarding_status,
      'email', c.email,
      'phone', c.phone,
      'country', c.country,
      'industry', c.industry,
      'logo_url', c.logo_url,
      'primary_color', c.primary_color,
      'registered_on', c.registered_on,
      'employee_limit', c.employee_limit,
      'created_at', c.created_at,
      'employees', (select count(*) from public.employees e where e.company_id = c.id and e.status = 'active'),
      'users', (select count(*) from public.users u where u.company_id = c.id and u.is_active),
      'payslips', (select count(*) from public.payslips p where p.company_id = c.id),
      'pending_leave', (select count(*) from public.leave_requests l
                         where l.company_id = c.id and l.status = 'pending'),
      'modules', (select count(*) from public.company_modules m
                   where m.company_id = c.id and m.is_enabled),
      'enabled_modules', coalesce((
        select jsonb_agg(m.module order by m.module)
        from public.company_modules m
        where m.company_id = c.id and m.is_enabled
      ), '[]'::jsonb),
      'plan', (
        select p.name
        from public.company_subscriptions s
        join public.subscription_plans p on p.id = s.plan_id
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'subscription_id', (
        select s.id
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'monthly_price', (
        select s.monthly_price
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'billing_cycle', (
        select s.billing_cycle::text
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'payment_status', (
        select s.payment_status
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'payment_reference', (
        select s.payment_reference
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'payment_notes', (
        select s.payment_notes
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'start_date', (
        select s.start_date
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'end_date', (
        select s.end_date
        from public.company_subscriptions s
        where s.company_id = c.id and s.status in ('trialing','active','past_due')
        order by s.id desc limit 1
      ),
      'admin_email', (
        select u.email
        from public.users u
        join public.roles r on r.id = u.role_id
        where u.company_id = c.id and r.name = 'company_admin' and u.is_active
        order by u.id limit 1
      ),
      'last_sign_in', (select max(u.last_sign_in_at) from public.users u where u.company_id = c.id),
      'support_open', exists (select 1 from public.support_sessions s
                               where s.company_id = c.id and s.ended_at is null)
    ) as row
    from public.companies c
  ) rows;

  return v_result;
end;
$$;


-- --------------------------------------------------------------- 3. Enriched platform_summary
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
    'companies',           (select count(*) from public.companies),
    'active_companies',    (select count(*) from public.companies where status = 'active'),
    'inactive_companies',  (select count(*) from public.companies where status <> 'active'),
    'employees',           (select count(*) from public.employees where status = 'active'),
    'subscriptions',       (select count(*) from public.company_subscriptions
                             where status in ('trialing','active','past_due')),
    'open_support',        (select count(*) from public.support_sessions where ended_at is null),
    'total_mrr',           coalesce((select sum(monthly_price) from public.company_subscriptions
                                      where status = 'active' and payment_status in ('verified', 'waived')), 0),
    'pending_payments',    (select count(*) from public.company_subscriptions
                             where status in ('trialing', 'active', 'past_due') and payment_status = 'pending')
  );
end;
$$;


-- --------------------------------------------------------------- 4. Platform subscription plans listing
create or replace function public.platform_subscription_plans()
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

  return (
    select coalesce(jsonb_agg(row_to_json(p) order by p.id), '[]'::jsonb)
    from (
      select id, name, description, employee_limit, storage_mb, price_amount, price_currency, default_modules
      from public.subscription_plans
      where is_active
    ) p
  );
end;
$$;


-- --------------------------------------------------------------- 5. platform_create_company RPC
create or replace function public.platform_create_company(
  p_name text,
  p_code text,
  p_admin_email text,
  p_admin_name text,
  p_admin_password text,
  p_plan_id integer default null,
  p_monthly_price numeric default null,
  p_billing_cycle text default 'monthly',
  p_payment_status text default 'verified',
  p_payment_reference text default null,
  p_payment_notes text default null,
  p_modules text[] default null,
  p_phone text default null,
  p_country text default 'India',
  p_primary_color text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id integer;
  v_plan_id integer := p_plan_id;
  v_role_id integer;
  v_user_id integer;
  v_emp_id integer;
  v_dept_id integer;
  v_desig_id integer;
  v_name_parts text[];
  v_first_name text;
  v_last_name text;
  v_code text := upper(trim(p_code));
  v_cycle billing_cycle_enum := coalesce(p_billing_cycle::billing_cycle_enum, 'monthly'::billing_cycle_enum);
  v_emp_limit integer;
  v_mod text;
  v_all_mods text[] := array[
    'employees', 'attendance', 'leaves', 'payroll',
    'projects', 'tasks', 'company_bank', 'assets',
    'recruitment', 'documents', 'calendar', 'announcements',
    'messages', 'reports', 'settings'
  ];
  v_selected_mods text[];
  v_company_status company_status_enum;
  v_sub_status subscription_status_enum;
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  if trim(p_name) = '' or v_code = '' or trim(p_admin_email) = '' or trim(p_admin_name) = '' then
    raise exception 'Company name, code, admin email, and admin name are required' using errcode = '22023';
  end if;

  if exists (select 1 from public.companies where upper(code) = v_code) then
    raise exception 'Company code % is already taken. Please choose a unique code.', v_code using errcode = '23505';
  end if;

  if exists (select 1 from public.users where lower(email) = lower(trim(p_admin_email))) then
    raise exception 'Email % is already registered to another account.', trim(p_admin_email) using errcode = '23505';
  end if;

  perform public.assert_password_policy(p_admin_password);

  -- Resolve subscription plan
  if v_plan_id is null then
    select id into v_plan_id from public.subscription_plans where name = 'Professional';
    if v_plan_id is null then
      select id into v_plan_id from public.subscription_plans order by id limit 1;
    end if;
  end if;

  select employee_limit into v_emp_limit from public.subscription_plans where id = v_plan_id;

  -- Lifecycle status determined by payment verification
  if p_payment_status in ('verified', 'waived') then
    v_company_status := 'active';
    v_sub_status := 'active';
  else
    v_company_status := 'trial';
    v_sub_status := 'trialing';
  end if;

  -- 1. Create Tenant Company
  insert into public.companies (
    name, code, email, phone, country, status, onboarding_status,
    employee_limit, primary_color, created_at, updated_at
  )
  values (
    trim(p_name), v_code, lower(trim(p_admin_email)), p_phone, coalesce(p_country, 'India'),
    v_company_status, 'ready', v_emp_limit, coalesce(p_primary_color, '#0F4C34'),
    now(), now()
  )
  returning id into v_company_id;

  -- 2. Create Company Subscription with dynamic price & payment verification
  insert into public.company_subscriptions (
    company_id, plan_id, status, billing_cycle, start_date, employee_limit,
    monthly_price, payment_status, payment_reference, payment_verified_at, payment_notes,
    created_at, updated_at
  )
  values (
    v_company_id, v_plan_id, v_sub_status, v_cycle, current_date, v_emp_limit,
    p_monthly_price, coalesce(p_payment_status, 'pending'), p_payment_reference,
    case when p_payment_status in ('verified', 'waived') then now() else null end,
    p_payment_notes, now(), now()
  );

  -- 3. Configure Module Access
  if p_modules is not null and array_length(p_modules, 1) > 0 then
    v_selected_mods := p_modules;
  else
    select default_modules into v_selected_mods from public.subscription_plans where id = v_plan_id;
    if v_selected_mods is null or array_length(v_selected_mods, 1) = 0 then
      v_selected_mods := v_all_mods;
    end if;
  end if;

  foreach v_mod in array v_all_mods loop
    insert into public.company_modules (company_id, module, is_enabled)
    values (v_company_id, v_mod, v_mod = any(v_selected_mods))
    on conflict (company_id, module) do update set is_enabled = EXCLUDED.is_enabled;
  end loop;

  -- 4. Initial Organization Structure (tenant-owned)
  insert into public.departments (company_id, name) values (v_company_id, 'Management') returning id into v_dept_id;
  insert into public.departments (company_id, name) values (v_company_id, 'Operations');
  insert into public.departments (company_id, name) values (v_company_id, 'Human Resources');

  insert into public.designations (company_id, title) values (v_company_id, 'Director') returning id into v_desig_id;
  insert into public.designations (company_id, title) values (v_company_id, 'HR Manager');
  insert into public.designations (company_id, title) values (v_company_id, 'Operations Executive');

  -- 5. Create Initial Company Admin User Account
  select id into v_role_id from public.roles where name = 'company_admin';
  if v_role_id is null then
    insert into public.roles (name, description)
    values ('company_admin', 'Owns one company. Full access inside it, none outside.')
    returning id into v_role_id;
  end if;

  insert into public.users (
    company_id, email, role_id, password_hash, email_confirmed_at, is_active, created_at, updated_at
  )
  values (
    v_company_id, lower(trim(p_admin_email)), v_role_id,
    crypt(p_admin_password, gen_salt('bf', 12)),
    now(), true, now(), now()
  )
  returning id into v_user_id;

  -- 6. Name splitting & Primary Employee profile
  v_name_parts := string_to_array(trim(p_admin_name), ' ');
  v_first_name := v_name_parts[1];
  if array_length(v_name_parts, 1) > 1 then
    v_last_name := array_to_string(v_name_parts[2:], ' ');
  else
    v_last_name := 'Admin';
  end if;

  insert into public.employees (
    company_id, user_id, employee_code, first_name, last_name,
    department_id, designation_id, joining_date, status, created_at, updated_at
  )
  values (
    v_company_id, v_user_id, public.next_employee_code(v_company_id),
    v_first_name, v_last_name, v_dept_id, v_desig_id, current_date, 'active', now(), now()
  )
  returning id into v_emp_id;

  -- 7. Initial Leave Balances
  insert into public.leave_balances (company_id, employee_id, leave_type_id, year, allocated_days, used_days)
  select v_company_id, v_emp_id, lt.id, extract(year from current_date), lt.default_days_per_year, 0
  from public.leave_types lt
  where lt.company_id is null or lt.company_id = v_company_id;

  -- 8. Audited Event
  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, meta, created_at
  )
  values (
    v_company_id, public.app_user_id(), 'company.created', 'companies', v_company_id,
    jsonb_build_object(
      'company_name', p_name,
      'code', v_code,
      'admin_email', p_admin_email,
      'plan_id', v_plan_id,
      'payment_status', p_payment_status,
      'monthly_price', p_monthly_price
    ),
    now()
  );

  return jsonb_build_object(
    'company_id', v_company_id,
    'code', v_code,
    'name', p_name,
    'status', v_company_status,
    'admin_email', lower(trim(p_admin_email)),
    'admin_name', p_admin_name,
    'employee_id', v_emp_id
  );
end;
$$;


-- --------------------------------------------------------------- 6. platform_update_subscription RPC
create or replace function public.platform_update_subscription(
  p_company_id integer,
  p_plan_id integer default null,
  p_status text default null,
  p_monthly_price numeric default null,
  p_billing_cycle text default null,
  p_payment_status text default null,
  p_payment_reference text default null,
  p_payment_notes text default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub_id integer;
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  select id into v_sub_id
  from public.company_subscriptions
  where company_id = p_company_id and status in ('trialing', 'active', 'past_due')
  order by id desc limit 1;

  if v_sub_id is null then
    insert into public.company_subscriptions (
      company_id, plan_id, status, billing_cycle, start_date,
      monthly_price, payment_status, payment_reference, payment_notes, end_date
    )
    values (
      p_company_id, coalesce(p_plan_id, 1),
      coalesce(p_status::subscription_status_enum, 'active'::subscription_status_enum),
      coalesce(p_billing_cycle::billing_cycle_enum, 'monthly'::billing_cycle_enum),
      current_date, p_monthly_price,
      coalesce(p_payment_status, 'pending'), p_payment_reference, p_payment_notes, p_end_date
    )
    returning id into v_sub_id;
  else
    update public.company_subscriptions
    set
      plan_id = coalesce(p_plan_id, plan_id),
      status = case when p_status is not null then p_status::subscription_status_enum else status end,
      monthly_price = coalesce(p_monthly_price, monthly_price),
      billing_cycle = case when p_billing_cycle is not null then p_billing_cycle::billing_cycle_enum else billing_cycle end,
      payment_status = coalesce(p_payment_status, payment_status),
      payment_reference = coalesce(p_payment_reference, payment_reference),
      payment_notes = coalesce(p_payment_notes, payment_notes),
      payment_verified_at = case when p_payment_status in ('verified', 'waived') then now() else payment_verified_at end,
      end_date = coalesce(p_end_date, end_date),
      updated_at = now()
    where id = v_sub_id;
  end if;

  -- Synchronize company status
  if p_status is not null then
    if p_status in ('active', 'trial', 'suspended', 'inactive') then
      update public.companies set status = p_status::company_status_enum, updated_at = now() where id = p_company_id;
    elsif p_status = 'trialing' then
      update public.companies set status = 'trial', updated_at = now() where id = p_company_id;
    end if;
  elsif p_payment_status in ('verified', 'waived') then
    update public.companies set status = 'active', updated_at = now() where id = p_company_id;
  end if;

  return jsonb_build_object('success', true, 'subscription_id', v_sub_id);
end;
$$;


-- --------------------------------------------------------------- 7. platform_update_company_modules RPC
create or replace function public.platform_update_company_modules(
  p_company_id integer,
  p_modules text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mod text;
  v_all_mods text[] := array[
    'employees', 'attendance', 'leaves', 'payroll',
    'projects', 'tasks', 'company_bank', 'assets',
    'recruitment', 'documents', 'calendar', 'announcements',
    'messages', 'reports', 'settings'
  ];
begin
  if not public.app_is_platform_user() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  foreach v_mod in array v_all_mods loop
    insert into public.company_modules (company_id, module, is_enabled, updated_at)
    values (p_company_id, v_mod, v_mod = any(p_modules), now())
    on conflict (company_id, module)
    do update set is_enabled = EXCLUDED.is_enabled, updated_at = now();
  end loop;

  return jsonb_build_object('success', true, 'company_id', p_company_id, 'modules', p_modules);
end;
$$;


-- --------------------------------------------------------------- 8. Grants
grant execute on function public.platform_company_overview()             to hrms_app;
grant execute on function public.platform_summary()                      to hrms_app;
grant execute on function public.platform_subscription_plans()          to hrms_app;
grant execute on function public.platform_create_company(text, text, text, text, text, integer, numeric, text, text, text, text, text[], text, text, text) to hrms_app;
grant execute on function public.platform_update_subscription(integer, integer, text, numeric, text, text, text, text, date) to hrms_app;
grant execute on function public.platform_update_company_modules(integer, text[]) to hrms_app;
