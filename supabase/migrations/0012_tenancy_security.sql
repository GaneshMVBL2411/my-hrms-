-- =============================================================================
-- 0012 — Multi-tenancy: isolation
--
-- The migration that actually earns the security guarantee. Every policy from
-- 0002 is replaced with one that also checks the tenant, and the platform
-- tables get policies of their own.
--
-- Requires 0011: every row must already carry a company_id, or these policies
-- will hide data from its rightful owner.
--
-- The whole file runs as one transaction. There is never a moment where a table
-- is readable without a tenant predicate — either all of this lands or none of
-- it does. Do not split it up.
--
-- The shape of every tenant policy is the same:
--
--     company_id = (select public.app_company_id())   -- which tenant
--     AND <the 0002 rule>                             -- which person, unchanged
--
-- The `(select ...)` wrapper is not decoration. Postgres treats it as an
-- InitPlan and evaluates it once per query instead of once per row; without it,
-- a 5,000-row scan calls the helper 5,000 times. 0002 established this pattern
-- and it matters more here, not less.
-- =============================================================================

begin;

-- =============================================================================
-- Helpers
-- =============================================================================

-- The caller's tenant, and the single source of truth for isolation.
--
-- Returns the company the caller may act inside:
--   * an ordinary user     -> their own users.company_id
--   * a super admin        -> NULL, unless they have an open support session,
--                             in which case the company that session names
--
-- A super admin therefore has no access to tenant data by default. That is
-- deliberate: platform staff reach a customer's records only by opening an
-- audited support session, so "who looked at what" is always answerable.
create or replace function public.app_company_id()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select s.company_id
      from support_sessions s
      join users u on u.id = s.super_admin_user_id
      where u.auth_id = auth.uid()
        and s.ended_at is null
      order by s.started_at desc
      limit 1
    ),
    (
      select u.company_id
      from users u
      where u.auth_id = auth.uid() and u.is_active
    )
  )
$$;

create or replace function public.app_is_super_admin()
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
    where u.auth_id = auth.uid()
      and u.is_active
      and u.company_id is null
      and r.name = 'super_admin'
  )
$$;

-- Company Admin is the tenant's own owner; HR Manager runs HR within it. 0002
-- treated founder and hr_admin as one thing; the platform model separates them,
-- so both new role names are folded in here and app_is_hr() keeps meaning
-- "may administer HR for this company".
create or replace function public.app_is_hr()
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
    where u.auth_id = auth.uid()
      and u.is_active
      and r.name in ('founder', 'company_admin', 'hr_admin')
  )
$$;

create or replace function public.app_is_founder()
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
    where u.auth_id = auth.uid()
      and u.is_active
      and r.name in ('founder', 'company_admin')
  )
$$;

-- Module gating, enforced in the database rather than only in the sidebar.
-- Hiding a nav link stops nobody who can open devtools; this stops the read.
create or replace function public.app_module_enabled(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from company_modules m
    where m.company_id = public.app_company_id()
      and m.module = p_module
      and m.is_enabled
  )
$$;

revoke execute on function public.app_company_id()          from public, anon;
revoke execute on function public.app_is_super_admin()      from public, anon;
revoke execute on function public.app_module_enabled(text)  from public, anon;
grant  execute on function public.app_company_id()          to authenticated;
grant  execute on function public.app_is_super_admin()      to authenticated;
grant  execute on function public.app_module_enabled(text)  to authenticated;


-- =============================================================================
-- Platform tables
--
-- Owned by the platform. A tenant may read its own company row (the app shows
-- its name and logo) and its own module list (the sidebar is built from it).
-- Everything else is super-admin only, and nothing here is tenant-writable.
-- =============================================================================

alter table companies             enable row level security;
alter table company_modules       enable row level security;
alter table subscription_plans    enable row level security;
alter table company_subscriptions enable row level security;
alter table platform_services     enable row level security;
alter table company_services      enable row level security;
alter table support_sessions      enable row level security;

drop policy if exists companies_read           on companies;
drop policy if exists companies_write          on companies;
drop policy if exists company_modules_read     on company_modules;
drop policy if exists company_modules_write    on company_modules;
drop policy if exists plans_read               on subscription_plans;
drop policy if exists plans_write              on subscription_plans;
drop policy if exists company_subs_read        on company_subscriptions;
drop policy if exists company_subs_write       on company_subscriptions;
drop policy if exists services_read            on platform_services;
drop policy if exists services_write           on platform_services;
drop policy if exists company_services_read    on company_services;
drop policy if exists company_services_write   on company_services;
drop policy if exists support_sessions_read    on support_sessions;
drop policy if exists support_sessions_write   on support_sessions;

create policy companies_read on companies
  for select to authenticated
  using (id = (select public.app_company_id()) or (select public.app_is_super_admin()));
create policy companies_write on companies
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));

create policy company_modules_read on company_modules
  for select to authenticated
  using (company_id = (select public.app_company_id()) or (select public.app_is_super_admin()));
create policy company_modules_write on company_modules
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));

-- The plan catalogue is public to signed-in users: an upgrade prompt has to
-- name the plans. Prices are not secret.
create policy plans_read on subscription_plans
  for select to authenticated using (true);
create policy plans_write on subscription_plans
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));

create policy company_subs_read on company_subscriptions
  for select to authenticated
  using (company_id = (select public.app_company_id()) or (select public.app_is_super_admin()));
create policy company_subs_write on company_subscriptions
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));

create policy services_read on platform_services
  for select to authenticated using (true);
create policy services_write on platform_services
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));

create policy company_services_read on company_services
  for select to authenticated
  using (company_id = (select public.app_company_id()) or (select public.app_is_super_admin()));
create policy company_services_write on company_services
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));

-- A tenant may see that it was accessed. Transparency is the point of the
-- audit trail, and hiding it from the customer would defeat it.
create policy support_sessions_read on support_sessions
  for select to authenticated
  using (company_id = (select public.app_company_id()) or (select public.app_is_super_admin()));
create policy support_sessions_write on support_sessions
  for all to authenticated
  using ((select public.app_is_super_admin())) with check ((select public.app_is_super_admin()));


-- =============================================================================
-- Tenant tables
--
-- Each policy is its 0002 rule with a company predicate ANDed on. The person
-- rules are unchanged — an employee still sees only their own payslip — so
-- behaviour inside a tenant is identical to before.
-- =============================================================================

-- roles / permissions stay platform vocabulary, readable by any HR user.
-- They carry no tenant data, so no predicate is added.

-- ------------------------------------------------------------------- users
drop policy if exists users_read   on users;
drop policy if exists users_update on users;

create policy users_read on users
  for select to authenticated
  using (company_id = (select public.app_company_id()) or (select public.app_is_super_admin()));
create policy users_update on users
  for update to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

-- ------------------------------------------------- departments / designations
drop policy if exists departments_read   on departments;
drop policy if exists departments_write  on departments;
drop policy if exists designations_read  on designations;
drop policy if exists designations_write on designations;

create policy departments_read on departments
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy departments_write on departments
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy designations_read on designations
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy designations_write on designations
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

-- --------------------------------------------------------------- employees
drop policy if exists employees_read   on employees;
drop policy if exists employees_update on employees;

create policy employees_read on employees
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy employees_update on employees
  for update to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

-- -------------------------------------------------------------- attendance
drop policy if exists attendance_read on attendance_records;

create policy attendance_read on attendance_records
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('attendance'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );

-- ------------------------------------------------------------------- leave
drop policy if exists leave_types_read     on leave_types;
drop policy if exists leave_types_write    on leave_types;
drop policy if exists leave_balances_read  on leave_balances;
drop policy if exists leave_balances_write on leave_balances;
drop policy if exists leave_requests_read  on leave_requests;
drop policy if exists leave_requests_cancel on leave_requests;

-- A null company_id is a platform default offered to every tenant; a set one is
-- that tenant's own override.
create policy leave_types_read on leave_types
  for select to authenticated
  using (company_id is null or company_id = (select public.app_company_id()));
create policy leave_types_write on leave_types
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy leave_balances_read on leave_balances
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('leaves'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );
create policy leave_balances_write on leave_balances
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy leave_requests_read on leave_requests
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('leaves'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );
create policy leave_requests_cancel on leave_requests
  for delete to authenticated
  using (
    company_id = (select public.app_company_id())
    and employee_id = (select public.app_employee_id())
    and status = 'pending'
  );

-- ---------------------------------------------------------------- projects
drop policy if exists projects_read        on projects;
drop policy if exists projects_write       on projects;
drop policy if exists project_members_read on project_members;
drop policy if exists project_members_write on project_members;

create policy projects_read on projects
  for select to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_module_enabled('projects')));
create policy projects_write on projects
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_manages_projects()))
  with check (company_id = (select public.app_company_id()) and (select public.app_manages_projects()));

create policy project_members_read on project_members
  for select to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_module_enabled('projects')));
create policy project_members_write on project_members
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_manages_projects()))
  with check (company_id = (select public.app_company_id()) and (select public.app_manages_projects()));

-- ------------------------------------------------------------------- tasks
drop policy if exists tasks_read           on tasks;
drop policy if exists tasks_insert         on tasks;
drop policy if exists tasks_delete         on tasks;
drop policy if exists task_checklist_read  on task_checklist_items;
drop policy if exists task_checklist_write on task_checklist_items;
drop policy if exists task_comments_read   on task_comments;
drop policy if exists task_comments_insert on task_comments;

create policy tasks_read on tasks
  for select to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_module_enabled('tasks')));
create policy tasks_insert on tasks
  for insert to authenticated
  with check (company_id = (select public.app_company_id()) and (select public.app_manages_tasks()));
create policy tasks_delete on tasks
  for delete to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_manages_tasks()));

create policy task_checklist_read on task_checklist_items
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy task_checklist_write on task_checklist_items
  for all to authenticated
  using (company_id = (select public.app_company_id()))
  with check (company_id = (select public.app_company_id()));

create policy task_comments_read on task_comments
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy task_comments_insert on task_comments
  for insert to authenticated
  with check (company_id = (select public.app_company_id()) and user_id = (select public.app_user_id()));

-- ------------------------------------------------------------------ assets
drop policy if exists assets_read            on assets;
drop policy if exists assets_write           on assets;
drop policy if exists asset_assignments_read on asset_assignments;

create policy assets_read on assets
  for select to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_module_enabled('assets')));
create policy assets_write on assets
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy asset_assignments_read on asset_assignments
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('assets'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );

-- ------------------------------------------------------------- recruitment
drop policy if exists candidates_all on candidates;
drop policy if exists interviews_all on interviews;

create policy candidates_all on candidates
  for all to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('recruitment'))
    and (select public.app_is_hr())
  )
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy interviews_all on interviews
  for all to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('recruitment'))
    and (select public.app_is_hr())
  )
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

-- ----------------------------------------------------------------- payroll
drop policy if exists salary_structures_read  on salary_structures;
drop policy if exists salary_structures_write on salary_structures;
drop policy if exists payslips_read           on payslips;

create policy salary_structures_read on salary_structures
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('payroll'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );
create policy salary_structures_write on salary_structures
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy payslips_read on payslips
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('payroll'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );

-- --------------------------------------------------------------- documents
drop policy if exists policies_read          on policies;
drop policy if exists policies_write         on policies;
drop policy if exists generated_letters_read on generated_letters;

create policy policies_read on policies
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy policies_write on policies
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy generated_letters_read on generated_letters
  for select to authenticated
  using (
    company_id = (select public.app_company_id())
    and (select public.app_module_enabled('documents'))
    and (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()))
  );

-- ------------------------------------------------ announcements & calendar
drop policy if exists announcements_read   on announcements;
drop policy if exists announcements_write  on announcements;
drop policy if exists company_events_read  on company_events;
drop policy if exists company_events_write on company_events;

create policy announcements_read on announcements
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy announcements_write on announcements
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

create policy company_events_read on company_events
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy company_events_write on company_events
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_manages_tasks()))
  with check (company_id = (select public.app_company_id()) and (select public.app_manages_tasks()));

-- -------------------------------------------------------- settings & audit
drop policy if exists company_settings_read  on company_settings;
drop policy if exists company_settings_write on company_settings;
drop policy if exists audit_logs_read        on audit_logs;
drop policy if exists audit_logs_insert      on audit_logs;

create policy company_settings_read on company_settings
  for select to authenticated using (company_id = (select public.app_company_id()));
create policy company_settings_write on company_settings
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_founder()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_founder()));

-- A super admin reads every company's audit trail; that is the platform
-- oversight requirement, and reading a log is not reading the data itself.
create policy audit_logs_read on audit_logs
  for select to authenticated
  using (
    (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
    or (select public.app_is_super_admin())
  );
create policy audit_logs_insert on audit_logs
  for insert to authenticated
  with check (company_id = (select public.app_company_id()) and user_id = (select public.app_user_id()));

commit;


-- ------------------------------------------------------------- diagnostics
-- Every policy on a tenant table should mention company_id. A row here with
-- `mentions_company = false` is a hole: that table is readable across tenants.
select
  c.relname                                        as table_name,
  p.polname                                        as policy,
  pg_get_expr(p.polqual, p.polrelid) ilike '%company_id%'
    or pg_get_expr(p.polwithcheck, p.polrelid) ilike '%company_id%' as mentions_company
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname not in ('roles', 'permissions', 'role_permissions',
                        'subscription_plans', 'platform_services')
order by mentions_company, c.relname, p.polname;
