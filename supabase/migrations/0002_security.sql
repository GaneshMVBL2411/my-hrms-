-- =============================================================================
-- 0002 — Identity helpers, privileges and row level security
--
-- With the FastAPI layer gone, every rule that used to live in `require_roles(...)`
-- and the per-endpoint scoping checks now has to be enforced by the database,
-- because the browser talks to PostgREST directly with a publishable anon key.
-- =============================================================================

-- ------------------------------------------------------------------ helpers
-- SECURITY DEFINER (owned by postgres) so these can read users/employees while
-- being called *from* the policies on those same tables.

create or replace function public.app_user_id()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id from users u where u.auth_id = auth.uid() and u.is_active
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
  where u.auth_id = auth.uid() and u.is_active
$$;

create or replace function public.app_employee_id()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
  from employees e
  join users u on u.id = e.user_id
  where u.auth_id = auth.uid() and u.is_active
$$;

-- The three role tiers the retired API used, by their endpoint constant names.
create or replace function public.app_is_hr()
returns boolean
language sql
stable
as $$ select public.app_role() in ('founder', 'hr_admin') $$;

create or replace function public.app_is_founder()
returns boolean
language sql
stable
as $$ select public.app_role() = 'founder' $$;

create or replace function public.app_manages_projects()
returns boolean
language sql
stable
as $$ select public.app_role() in ('founder', 'hr_admin', 'project_manager') $$;

create or replace function public.app_manages_tasks()
returns boolean
language sql
stable
as $$ select public.app_role() in ('founder', 'hr_admin', 'project_manager', 'team_lead') $$;

-- --------------------------------------------------------------- privileges
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Never writable from a browser session: these are only ever touched by the
-- SECURITY DEFINER routines in 0003, so no client grant is warranted.
revoke insert, update, delete on roles, permissions, role_permissions from authenticated;
revoke insert, delete on users from authenticated;
revoke insert, delete on employees from authenticated;
revoke insert, update, delete on payslips from authenticated;
revoke insert, update, delete on generated_letters from authenticated;
revoke insert, update on leave_requests from authenticated;
revoke insert, update, delete on asset_assignments from authenticated;
revoke insert, update, delete on attendance_records from authenticated;
revoke update, delete on audit_logs from authenticated;

-- PAN / Aadhaar / bank details were readable by any signed-in user through the
-- old `GET /employees/{id}`. Now that reads are direct, withhold those columns
-- at the grant level — `get_employee_detail()` hands them out to HR and to the
-- employee themselves, and to nobody else.
revoke select on employees from authenticated;
grant select (
  id, user_id, employee_code, first_name, last_name, full_name, phone, address,
  dob, gender, department_id, designation_id, reporting_manager_id, joining_date,
  skills, experience_years, photo_url, status, created_at, updated_at
) on employees to authenticated;

-- ----------------------------------------------------------------------- RLS
alter table roles                enable row level security;
alter table permissions          enable row level security;
alter table role_permissions     enable row level security;
alter table users                enable row level security;
alter table departments          enable row level security;
alter table designations         enable row level security;
alter table employees            enable row level security;
alter table attendance_records   enable row level security;
alter table leave_types          enable row level security;
alter table leave_balances       enable row level security;
alter table leave_requests       enable row level security;
alter table projects             enable row level security;
alter table project_members      enable row level security;
alter table tasks                enable row level security;
alter table task_checklist_items enable row level security;
alter table task_comments        enable row level security;
alter table assets               enable row level security;
alter table asset_assignments    enable row level security;
alter table candidates           enable row level security;
alter table interviews           enable row level security;
alter table salary_structures    enable row level security;
alter table payslips             enable row level security;
alter table policies             enable row level security;
alter table generated_letters    enable row level security;
alter table announcements        enable row level security;
alter table company_events       enable row level security;
alter table company_settings     enable row level security;
alter table audit_logs           enable row level security;

-- roles / permissions — the Settings screen and the employee form, both HR-only.
create policy roles_read on roles
  for select to authenticated using ((select public.app_is_hr()));
create policy permissions_read on permissions
  for select to authenticated using ((select public.app_is_hr()));
create policy role_permissions_read on role_permissions
  for select to authenticated using ((select public.app_is_hr()));

-- users — email is shown in the employee directory to everyone, as before.
create policy users_read on users
  for select to authenticated using (true);
create policy users_update on users
  for update to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

-- departments / designations
create policy departments_read on departments
  for select to authenticated using (true);
create policy departments_write on departments
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy designations_read on designations
  for select to authenticated using (true);
create policy designations_write on designations
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

-- employees
create policy employees_read on employees
  for select to authenticated using (true);
create policy employees_update on employees
  for update to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

-- attendance — you see your own; HR sees everyone's.
create policy attendance_read on attendance_records
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));

-- leave
create policy leave_types_read on leave_types
  for select to authenticated using (true);
create policy leave_types_write on leave_types
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy leave_balances_read on leave_balances
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));
create policy leave_balances_write on leave_balances
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy leave_requests_read on leave_requests
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));
-- Cancelling is the one leave mutation a client does directly, and only ever
-- against its own still-pending request.
create policy leave_requests_cancel on leave_requests
  for delete to authenticated
  using (employee_id = (select public.app_employee_id()) and status = 'pending');

-- projects
create policy projects_read on projects
  for select to authenticated using (true);
create policy projects_write on projects
  for all to authenticated
  using ((select public.app_manages_projects())) with check ((select public.app_manages_projects()));

create policy project_members_read on project_members
  for select to authenticated using (true);
create policy project_members_write on project_members
  for all to authenticated
  using ((select public.app_manages_projects())) with check ((select public.app_manages_projects()));

-- tasks — updates go through update_task() so the assignee-only progress rule
-- can be applied per field; inserts and deletes stay manager-only.
create policy tasks_read on tasks
  for select to authenticated using (true);
create policy tasks_insert on tasks
  for insert to authenticated with check ((select public.app_manages_tasks()));
create policy tasks_delete on tasks
  for delete to authenticated using ((select public.app_manages_tasks()));

create policy task_checklist_read on task_checklist_items
  for select to authenticated using (true);
create policy task_checklist_write on task_checklist_items
  for all to authenticated using (true) with check (true);

create policy task_comments_read on task_comments
  for select to authenticated using (true);
create policy task_comments_insert on task_comments
  for insert to authenticated with check (user_id = (select public.app_user_id()));

-- assets
create policy assets_read on assets
  for select to authenticated using (true);
create policy assets_write on assets
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy asset_assignments_read on asset_assignments
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));

-- recruitment — HR-only end to end, as the old router was.
create policy candidates_all on candidates
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));
create policy interviews_all on interviews
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

-- payroll
create policy salary_structures_read on salary_structures
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));
create policy salary_structures_write on salary_structures
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy payslips_read on payslips
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));

-- documents
create policy policies_read on policies
  for select to authenticated using (true);
create policy policies_write on policies
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy generated_letters_read on generated_letters
  for select to authenticated
  using (employee_id = (select public.app_employee_id()) or (select public.app_is_hr()));

-- announcements & calendar
create policy announcements_read on announcements
  for select to authenticated using (true);
create policy announcements_write on announcements
  for all to authenticated
  using ((select public.app_is_hr())) with check ((select public.app_is_hr()));

create policy company_events_read on company_events
  for select to authenticated using (true);
create policy company_events_write on company_events
  for all to authenticated
  using ((select public.app_manages_tasks())) with check ((select public.app_manages_tasks()));

-- settings & audit
create policy company_settings_read on company_settings
  for select to authenticated using (true);
create policy company_settings_write on company_settings
  for all to authenticated
  using ((select public.app_is_founder())) with check ((select public.app_is_founder()));

create policy audit_logs_read on audit_logs
  for select to authenticated using ((select public.app_is_hr()));
create policy audit_logs_insert on audit_logs
  for insert to authenticated with check (user_id = (select public.app_user_id()));
