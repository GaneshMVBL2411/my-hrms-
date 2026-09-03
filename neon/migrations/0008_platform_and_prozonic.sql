-- =============================================================================
-- Neon 0008 — The platform tier, per-company branding, and Prozonic
--
-- Three things, in the order they depend on each other:
--
--   1. The two roles the platform model needs but the single-company build
--      never had — super_admin (owns the platform, belongs to no company) and
--      company_admin (owns one company).
--   2. Brand colours on `companies`, so each tenant's HRMS carries its own
--      identity instead of the platform's.
--   3. Prozonic, as the first client tenant, with its own admin, org structure,
--      modules and subscription.
--
-- No new application, no second codebase. A tenant is rows.
--
-- Safe to re-run: every insert is guarded.
-- =============================================================================

-- ------------------------------------------------------------------- roles
-- super_admin is defined by having no company: app_is_super_admin() checks both
-- the role name and a null company_id, so the two must always agree.
insert into public.roles (name, description)
values
  ('super_admin',   'Platform owner. Belongs to no company; reaches a tenant only through an audited support session.'),
  ('company_admin', 'Owns one company. Full access inside it, none outside.')
on conflict (name) do nothing;


-- --------------------------------------------------------------- branding
-- Per-tenant colours. Nullable: a company without them falls back to the
-- platform's own palette, which is what every existing screen already renders.
alter table public.companies add column if not exists primary_color   varchar(9);
alter table public.companies add column if not exists secondary_color varchar(9);
alter table public.companies add column if not exists accent_color    varchar(9);

comment on column public.companies.primary_color is
  'Hex, e.g. #2E6A76. Drives the sidebar, buttons and letterhead for this tenant.';

-- The platform's own company keeps the deep green the HRMS has always used.
update public.companies
   set primary_color   = coalesce(primary_color,   '#0F4C34'),
       secondary_color = coalesce(secondary_color, '#EAF0EC'),
       accent_color    = coalesce(accent_color,    '#2F6B46')
 where code = 'WPL';


-- ------------------------------------------------------------- Prozonic
do $$
declare
  v_company    integer;
  v_plan       integer;
  v_role       integer;
  v_user       integer;
  v_employee   integer;
  v_dept       integer;
  v_desig      integer;
  v_item       text;

  -- Taken from the logo: the wordmark's dark teal, the diamond's green, and
  -- the cyan of the figure in the "o".
  v_primary    text := '#2E6A76';
  v_secondary  text := '#8CC63F';
  v_accent     text := '#29ABE2';
  v_initial_password text := coalesce(
    nullif(current_setting('app.initial_prozonic_password', true), ''),
    encode(gen_random_bytes(16), 'base64')
  );
begin
  select id into v_company from public.companies where upper(code) = 'PRZ';

  if v_company is not null then
    raise notice 'Prozonic already exists as company #%. Nothing changed.', v_company;
    return;
  end if;

  select id into v_plan from public.subscription_plans where name = 'Professional';

  insert into public.companies (
    name, code, email, country, industry, logo_url,
    primary_color, secondary_color, accent_color,
    status, onboarding_status, employee_limit
  )
  values (
    'Prozonic', 'PRZ', 'hr@prozonic.com', 'India', 'Technology', '/prozonic-logo.png',
    v_primary, v_secondary, v_accent,
    'active', 'ready', (select employee_limit from public.subscription_plans where id = v_plan)
  )
  returning id into v_company;

  raise notice 'Created Prozonic as company #%', v_company;

  insert into public.company_subscriptions (
    company_id, plan_id, status, billing_cycle, start_date, employee_limit)
  values (
    v_company, v_plan, 'active', 'monthly', current_date,
    (select employee_limit from public.subscription_plans where id = v_plan));

  -- Modules Prozonic may use. Anything absent is hidden in the sidebar AND
  -- refused by row level security, so omission is a real restriction.
  insert into public.company_modules (company_id, module, is_enabled)
  select v_company, m, true from unnest(array[
    'employees', 'attendance', 'leaves', 'payroll',
    'documents', 'reports', 'calendar', 'announcements', 'settings'
  ]) as m;

  -- Its own org structure. Departments and designations are tenant-owned, so a
  -- new company starts with none and cannot borrow another's.
  foreach v_item in array array['Engineering', 'Operations', 'Sales'] loop
    insert into public.departments (company_id, name) values (v_company, v_item);
  end loop;

  foreach v_item in array array['Software Engineer', 'Operations Executive', 'Sales Executive'] loop
    insert into public.designations (company_id, title) values (v_company, v_item);
  end loop;

  select id into v_dept  from public.departments  where company_id = v_company order by id limit 1;
  select id into v_desig from public.designations where company_id = v_company order by id limit 1;

  -- The company admin: owns Prozonic, and nothing outside it.
  select id into v_role from public.roles where name = 'company_admin';

  insert into public.users (company_id, email, role_id, password_hash, email_confirmed_at, is_active)
  values (v_company, 'admin@prozonic.com', v_role,
          crypt(v_initial_password, gen_salt('bf', 12)), now(), true)
  returning id into v_user;

  insert into public.employees (
    company_id, user_id, employee_code, first_name, last_name,
    department_id, designation_id, joining_date, status)
  values (
    v_company, v_user, public.next_employee_code(v_company),
    'Prozonic', 'Admin', v_dept, v_desig, current_date, 'active')
  returning id into v_employee;

  insert into public.leave_balances (company_id, employee_id, leave_type_id, year, allocated_days, used_days)
  select v_company, v_employee, lt.id, extract(year from current_date), lt.default_days_per_year, 0
  from public.leave_types lt
  where lt.company_id is null or lt.company_id = v_company;

  raise notice '  admin@prozonic.com created as employee #%', v_employee;
end $$;


-- ------------------------------------------------------- platform super admin
-- company_id is null, which is what makes this account the platform's rather
-- than any tenant's. With it null every tenant policy matches nothing, so a
-- super admin sees no customer data until they open a support session.
do $$
declare
  v_role integer;
  v_initial_password text := coalesce(
    nullif(current_setting('app.initial_platform_admin_password', true), ''),
    encode(gen_random_bytes(16), 'base64')
  );
begin
  if exists (select 1 from public.users where lower(email) = 'admin@hrms.platform') then
    raise notice 'Platform super admin already exists.';
    return;
  end if;

  select id into v_role from public.roles where name = 'super_admin';

  insert into public.users (company_id, email, role_id, password_hash, email_confirmed_at, is_active)
  values (null, 'admin@hrms.platform', v_role,
          crypt(v_initial_password, gen_salt('bf', 12)), now(), true);

  raise notice 'Created platform super admin: admin@hrms.platform';
end $$;


-- ------------------------------------------------------------- diagnostics
select
  c.id,
  c.name,
  c.code,
  c.status,
  c.primary_color,
  (select count(*) from public.employees e where e.company_id = c.id) as employees,
  (select count(*) from public.company_modules m where m.company_id = c.id and m.is_enabled) as modules
from public.companies c
order by c.id;

select u.email, r.name as role, coalesce(c.name, '— platform —') as company
from public.users u
join public.roles r on r.id = u.role_id
left join public.companies c on c.id = u.company_id
where r.name in ('super_admin', 'company_admin')
order by u.email;
