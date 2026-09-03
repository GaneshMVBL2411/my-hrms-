-- =============================================================================
-- schema.sql — GENERATED, do not edit
--
-- The complete HRMS schema for Neon PostgreSQL. Regenerate with
-- neon/build-schema.sh; edit the source migrations, never this file.
--
-- Apply to an empty Neon database:
--   psql "$DATABASE_URL" -f neon/schema.sql
--
-- Order matters. 0001_session_context.sql comes last on purpose: it redefines
-- the app_* helper functions that every policy calls, replacing the versions
-- that read auth.uid() with versions that read a transaction-local setting. Run
-- earlier, the migrations that follow would overwrite it and every policy would
-- deny everything.
--
-- This file creates structure only. It contains no data — the rows come across
-- separately, after you have verified the schema landed.
-- =============================================================================

-- Postgres validates the body of a `language sql` function when it is created.
-- The helpers arrive from 0002 still calling auth.uid(), which does not exist
-- here, so validation would abort the load before 0001_session_context.sql gets
-- a chance to replace them at the end. Turning the check off lets those
-- definitions land unvalidated; they are overwritten before anything calls
-- them, and the verification queries at the bottom prove none survived.
--
-- Scoped to this load only — it is a session setting, not a database one.
set check_function_bodies = off;

-- Supabase ships three roles that Postgres does not. Every policy is declared
-- `to authenticated`, so without that role the very first `create policy` fails
-- with `role "authenticated" does not exist`.
--
-- They are created here as empty, login-less groups rather than editing the
-- policies to name a different role. The policies are the multi-tenant
-- isolation model and the brief says not to change it — porting them verbatim
-- means there is nothing to re-review. `hrms_app` is made a member of
-- `authenticated` further down, which is what makes the policies apply to it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;



-- ###########################################################################
-- supabase/migrations/0001_schema.sql
-- ###########################################################################

-- =============================================================================
-- 0001 — Core schema
--
-- Ported from the retired FastAPI/SQLAlchemy backend. Two structural changes:
--   * users.hashed_password is gone — Supabase Auth (auth.users) owns credentials,
--     and users.auth_id links an app user to its auth identity.
--   * every default/onupdate that used to live in Python is now a DB default or
--     trigger, because there is no longer an application layer to apply them.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enum types
create type gender_enum as enum ('male', 'female', 'other');
create type employee_status_enum as enum ('active', 'inactive', 'on_notice', 'exited');
create type attendance_status_enum as enum ('present', 'absent', 'half_day', 'on_leave');
create type leave_status_enum as enum ('pending', 'approved', 'rejected');
create type priority_enum as enum ('low', 'medium', 'high');
create type project_status_enum as enum ('planning', 'active', 'on_hold', 'completed');
create type task_status_enum as enum ('assigned', 'in_progress', 'review', 'completed');
create type asset_category_enum as enum ('laptop', 'monitor', 'keyboard', 'mouse', 'mobile', 'accessory', 'other');
create type asset_status_enum as enum ('available', 'assigned', 'retired', 'maintenance');
create type candidate_status_enum as enum ('applied', 'interview_scheduled', 'interviewed', 'offered', 'joined', 'rejected');
create type interview_outcome_enum as enum ('pending', 'pass', 'fail');
create type letter_type_enum as enum ('offer', 'appointment', 'experience', 'relieving', 'certificate');
create type announcement_category_enum as enum ('news', 'holiday', 'event', 'general');
create type event_type_enum as enum ('meeting', 'event', 'holiday');

-- ------------------------------------------------------------ shared trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------- identity & access
create table roles (
  id serial primary key,
  name varchar(50) not null unique,
  description varchar(255)
);

create table permissions (
  id serial primary key,
  code varchar(100) not null unique,
  description varchar(255)
);

create table role_permissions (
  role_id integer not null references roles (id) on delete cascade,
  permission_id integer not null references permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table users (
  id serial primary key,
  -- Nullable so an employee record can exist before its login is provisioned
  -- (and survive the auth account being deleted).
  auth_id uuid unique,
  email varchar(255) not null,
  role_id integer not null references roles (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ix_users_email on users (lower(email));
create index ix_users_auth_id on users (auth_id);

create trigger users_set_updated_at before update on users
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- org structure
create table departments (
  id serial primary key,
  name varchar(100) not null unique,
  description varchar(255)
);

create table designations (
  id serial primary key,
  title varchar(100) not null unique,
  description varchar(255)
);

create table employees (
  id serial primary key,
  user_id integer not null unique references users (id) on delete cascade,
  employee_code varchar(20) not null,

  first_name varchar(100) not null,
  -- Empty for the mononymous: plenty of people here go by a single name, and
  -- they should not have to invent a surname to exist in the system.
  last_name varchar(100) not null default '',
  -- Stored (not computed on read) so it can be indexed and sorted/searched by
  -- PostgREST the same way the backend's `first_name || ' ' || last_name` was.
  -- trim() keeps a missing surname from leaving a trailing space on every
  -- payslip, offer letter and directory row.
  full_name varchar(201) generated always as (trim(first_name || ' ' || last_name)) stored,
  phone varchar(20),
  address varchar(500),
  dob date,
  gender gender_enum,

  department_id integer references departments (id) on delete set null,
  designation_id integer references designations (id) on delete set null,
  reporting_manager_id integer references employees (id) on delete set null,

  joining_date date,
  skills varchar[],
  experience_years integer,
  photo_url varchar(500),

  pan_number varchar(10),
  aadhaar_number varchar(12),
  bank_account_number varchar(30),
  bank_ifsc varchar(11),
  bank_name varchar(100),

  status employee_status_enum not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ix_employees_employee_code on employees (employee_code);
create index ix_employees_full_name on employees (lower(full_name));

create trigger employees_set_updated_at before update on employees
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- attendance
create table attendance_records (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,
  date date not null,
  check_in timestamptz,
  check_out timestamptz,
  break_minutes integer not null default 0,
  status attendance_status_enum not null default 'present',
  created_at timestamptz not null default now(),
  constraint uq_attendance_employee_date unique (employee_id, date)
);

-- --------------------------------------------------------------------- leave
create table leave_types (
  id serial primary key,
  name varchar(50) not null unique,
  default_days_per_year integer not null default 0
);

create table leave_balances (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,
  leave_type_id integer not null references leave_types (id) on delete cascade,
  year integer not null,
  allocated_days numeric(4, 1) not null,
  used_days numeric(4, 1) not null default 0,
  constraint uq_leave_balance_employee_type_year unique (employee_id, leave_type_id, year)
);

create table leave_requests (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,
  leave_type_id integer not null references leave_types (id),
  start_date date not null,
  end_date date not null,
  days_count numeric(4, 1) not null,
  reason varchar(500),
  status leave_status_enum not null default 'pending',
  decided_by integer references users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index ix_leave_requests_employee on leave_requests (employee_id);

-- ----------------------------------------------------------- projects & tasks
create table projects (
  id serial primary key,
  name varchar(200) not null,
  description varchar(2000),
  tech_stack varchar[],
  priority priority_enum not null default 'medium',
  status project_status_enum not null default 'planning',
  deadline date,
  progress integer not null default 0,
  created_by integer not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger projects_set_updated_at before update on projects
  for each row execute function public.set_updated_at();

create table project_members (
  project_id integer not null references projects (id) on delete cascade,
  employee_id integer not null references employees (id) on delete cascade,
  role_in_project varchar(100),
  primary key (project_id, employee_id)
);

create table tasks (
  id serial primary key,
  project_id integer references projects (id) on delete set null,
  title varchar(200) not null,
  description varchar(2000),
  assigned_to integer references employees (id) on delete set null,
  priority priority_enum not null default 'medium',
  due_date date,
  status task_status_enum not null default 'assigned',
  progress integer not null default 0,
  created_by integer not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ix_tasks_assigned_to on tasks (assigned_to);
create index ix_tasks_project on tasks (project_id);

-- Progress and status stay in sync: reaching 100% marks the task complete, and
-- marking it complete fills the progress bar. This lived in task_service.py.
create or replace function public.sync_task_progress()
returns trigger
language plpgsql
as $$
begin
  if new.progress >= 100 then
    new.status = 'completed';
  elsif new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.progress = 100;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_sync_progress before insert or update on tasks
  for each row execute function public.sync_task_progress();

create table task_checklist_items (
  id serial primary key,
  task_id integer not null references tasks (id) on delete cascade,
  label varchar(300) not null,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table task_comments (
  id serial primary key,
  task_id integer not null references tasks (id) on delete cascade,
  user_id integer not null references users (id) on delete cascade,
  body varchar(2000) not null,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------- assets
create table assets (
  id serial primary key,
  name varchar(200) not null,
  category asset_category_enum not null,
  serial_number varchar(100) unique,
  purchase_date date,
  status asset_status_enum not null default 'available',
  notes varchar(1000),
  created_at timestamptz not null default now()
);

create table asset_assignments (
  id serial primary key,
  asset_id integer not null references assets (id) on delete cascade,
  employee_id integer not null references employees (id) on delete cascade,
  assigned_date date not null,
  returned_date date,
  notes varchar(500)
);

create index ix_asset_assignments_asset on asset_assignments (asset_id);

-- --------------------------------------------------------------- recruitment
create table candidates (
  id serial primary key,
  full_name varchar(200) not null,
  email varchar(255) not null,
  phone varchar(20),
  applied_designation_id integer references designations (id) on delete set null,
  status candidate_status_enum not null default 'applied',
  source varchar(100),
  notes varchar(2000),
  created_at timestamptz not null default now()
);

create table interviews (
  id serial primary key,
  candidate_id integer not null references candidates (id) on delete cascade,
  scheduled_at timestamptz not null,
  interviewer_id integer references employees (id) on delete set null,
  notes varchar(2000),
  outcome interview_outcome_enum not null default 'pending'
);

-- ------------------------------------------------------------------- payroll
create table salary_structures (
  id serial primary key,
  employee_id integer not null unique references employees (id) on delete cascade,
  basic numeric(10, 2) not null,
  hra numeric(10, 2) not null default 0,
  special_allowance numeric(10, 2) not null default 0,
  pf_percent numeric(5, 2) not null default 12,
  esi_percent numeric(5, 2) not null default 0.75,
  effective_from date not null,
  created_at timestamptz not null default now()
);

create table payslips (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,
  month integer not null,
  year integer not null,
  basic numeric(10, 2) not null,
  hra numeric(10, 2) not null,
  special_allowance numeric(10, 2) not null,
  gross_pay numeric(10, 2) not null,
  pf_deduction numeric(10, 2) not null,
  esi_deduction numeric(10, 2) not null,
  professional_tax numeric(10, 2) not null,
  net_pay numeric(10, 2) not null,
  generated_at timestamptz not null default now(),
  generated_by integer not null references users (id),
  constraint uq_payslip_employee_month_year unique (employee_id, month, year)
);

-- ----------------------------------------------------------------- documents
create table policies (
  id serial primary key,
  title varchar(200) not null,
  content text not null,
  version integer not null default 1,
  updated_by integer not null references users (id),
  updated_at timestamptz not null default now()
);

create table generated_letters (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,
  letter_type letter_type_enum not null,
  custom_message text,
  annual_ctc_override numeric(12, 2),
  probation_text varchar(200),
  notice_period_text varchar(200),
  generated_by integer not null references users (id),
  generated_at timestamptz not null default now()
);

-- ------------------------------------------------- announcements & calendar
create table announcements (
  id serial primary key,
  title varchar(200) not null,
  body text not null,
  category announcement_category_enum not null default 'general',
  pinned boolean not null default false,
  created_by integer not null references users (id),
  created_at timestamptz not null default now()
);

create table company_events (
  id serial primary key,
  title varchar(200) not null,
  description varchar(1000),
  event_date date not null,
  event_type event_type_enum not null default 'event',
  created_by integer not null references users (id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- settings & auditing
create table company_settings (
  id serial primary key,
  company_name varchar(200) not null,
  address varchar(500),
  logo_url varchar(500),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id serial primary key,
  user_id integer references users (id) on delete set null,
  action varchar(100) not null,
  entity varchar(100) not null,
  entity_id integer,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index ix_audit_logs_created_at on audit_logs (created_at desc);


-- ###########################################################################
-- supabase/migrations/0002_security.sql
-- ###########################################################################

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


-- ###########################################################################
-- supabase/migrations/0003_views_and_logic.sql
-- ###########################################################################

-- =============================================================================
-- 0003 — Read models and ported business logic
--
-- Views replace the `to_summary` / `to_detail` mappers from the service layer so
-- the client can keep issuing one query per screen. Functions replace the pieces
-- of app/services/*.py that were more than a single row change: anything that
-- validates, spans tables, or has to see rows the caller cannot select directly.
-- =============================================================================

-- ------------------------------------------------- who-did-it column defaults
-- These were filled from `current_user.id` in every router; make the database
-- supply them so a client can never claim to be someone else.
alter table projects       alter column created_by set default public.app_user_id();
alter table tasks          alter column created_by set default public.app_user_id();
alter table task_comments  alter column user_id    set default public.app_user_id();
alter table announcements  alter column created_by set default public.app_user_id();
alter table company_events alter column created_by set default public.app_user_id();
alter table policies       alter column updated_by set default public.app_user_id();
alter table audit_logs     alter column user_id    set default public.app_user_id();

-- Policies are versioned on every edit (document_service.update_policy).
create or replace function public.bump_policy_version()
returns trigger
language plpgsql
as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  new.updated_by = coalesce(public.app_user_id(), old.updated_by);
  return new;
end;
$$;

create trigger policies_bump_version before update on policies
  for each row execute function public.bump_policy_version();

-- Scheduling the first interview advances a fresh candidate's pipeline stage
-- (recruitment_service.add_interview).
create or replace function public.advance_candidate_on_interview()
returns trigger
language plpgsql
as $$
begin
  update candidates set status = 'interview_scheduled'
  where id = new.candidate_id and status = 'applied';
  return new;
end;
$$;

create trigger interviews_advance_candidate after insert on interviews
  for each row execute function public.advance_candidate_on_interview();

-- =============================================================================
-- Views
-- =============================================================================

-- Display name for a user: their employee name when they have a profile, else
-- the login email. Repeated in six different `_to_out` mappers before.
create or replace function public.user_display_name(p_user_id integer)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(e.full_name, u.email)
  from users u
  left join employees e on e.user_id = u.id
  where u.id = p_user_id
$$;

create view employee_directory with (security_invoker = on) as
select
  e.id,
  e.employee_code,
  e.full_name,
  u.email,
  e.phone,
  e.address,
  e.photo_url,
  e.department_id,
  d.name as department_name,
  e.designation_id,
  g.title as designation_title,
  e.status,
  e.joining_date,
  e.first_name,
  e.last_name,
  e.dob,
  e.gender,
  e.reporting_manager_id,
  m.full_name as reporting_manager_name,
  e.skills,
  e.experience_years,
  e.created_at
from employees e
join users u on u.id = e.user_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id
left join employees m on m.id = e.reporting_manager_id;

create view attendance_detail with (security_invoker = on) as
select
  a.id,
  a.employee_id,
  e.full_name as employee_name,
  a.date,
  a.check_in,
  a.check_out,
  a.break_minutes,
  a.status,
  case
    when a.check_in is null or a.check_out is null then null
    else round(
      greatest(extract(epoch from (a.check_out - a.check_in)) - a.break_minutes * 60, 0) / 3600.0,
      2
    )
  end as working_hours,
  coalesce((a.check_in at time zone 'utc')::time > time '09:30', false) as is_late
from attendance_records a
join employees e on e.id = a.employee_id;

create view leave_balance_detail with (security_invoker = on) as
select
  b.id,
  b.employee_id,
  b.leave_type_id,
  t.name as leave_type_name,
  b.year,
  b.allocated_days,
  b.used_days,
  b.allocated_days - b.used_days as remaining_days
from leave_balances b
join leave_types t on t.id = b.leave_type_id;

create view leave_request_detail with (security_invoker = on) as
select
  r.id,
  r.employee_id,
  e.full_name as employee_name,
  r.leave_type_id,
  t.name as leave_type_name,
  r.start_date,
  r.end_date,
  r.days_count,
  r.reason,
  r.status,
  public.user_display_name(r.decided_by) as decided_by_name,
  r.decided_at,
  r.created_at
from leave_requests r
join employees e on e.id = r.employee_id
join leave_types t on t.id = r.leave_type_id;

create view asset_detail with (security_invoker = on) as
select
  a.id,
  a.name,
  a.category,
  a.serial_number,
  a.purchase_date,
  a.status,
  a.notes,
  a.created_at,
  (
    select e.full_name
    from asset_assignments aa
    join employees e on e.id = aa.employee_id
    where aa.asset_id = a.id and aa.returned_date is null
    limit 1
  ) as assigned_to_name
from assets a;

create view asset_assignment_detail with (security_invoker = on) as
select
  aa.id,
  aa.asset_id,
  aa.employee_id,
  e.full_name as employee_name,
  aa.assigned_date,
  aa.returned_date,
  aa.notes
from asset_assignments aa
join employees e on e.id = aa.employee_id;

create view salary_structure_detail with (security_invoker = on) as
select
  s.id,
  s.employee_id,
  e.full_name as employee_name,
  s.basic,
  s.hra,
  s.special_allowance,
  s.pf_percent,
  s.esi_percent,
  s.effective_from
from salary_structures s
join employees e on e.id = s.employee_id;

create view payslip_detail with (security_invoker = on) as
select
  p.id,
  p.employee_id,
  e.full_name as employee_name,
  e.employee_code,
  g.title as designation_title,
  d.name as department_name,
  e.joining_date,
  p.month,
  p.year,
  p.basic,
  p.hra,
  p.special_allowance,
  p.gross_pay,
  p.pf_deduction,
  p.esi_deduction,
  p.professional_tax,
  p.net_pay,
  p.generated_at
from payslips p
join employees e on e.id = p.employee_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id;

create view project_directory with (security_invoker = on) as
select
  p.id,
  p.name,
  p.description,
  p.priority,
  p.status,
  p.deadline,
  p.progress,
  p.tech_stack,
  p.created_at,
  (select count(*) from project_members m where m.project_id = p.id) as member_count
from projects p;

create view project_member_detail with (security_invoker = on) as
select
  m.project_id,
  m.employee_id,
  e.full_name as employee_name,
  e.photo_url,
  m.role_in_project
from project_members m
join employees e on e.id = m.employee_id;

create view task_directory with (security_invoker = on) as
select
  t.id,
  t.title,
  t.description,
  t.project_id,
  p.name as project_name,
  t.assigned_to,
  e.full_name as assignee_name,
  t.priority,
  t.due_date,
  t.status,
  t.progress,
  t.created_at
from tasks t
left join projects p on p.id = t.project_id
left join employees e on e.id = t.assigned_to;

create view task_comment_detail with (security_invoker = on) as
select
  c.id,
  c.task_id,
  c.user_id,
  public.user_display_name(c.user_id) as user_name,
  c.body,
  c.created_at
from task_comments c;

create view candidate_directory with (security_invoker = on) as
select
  c.id,
  c.full_name,
  c.email,
  c.phone,
  c.applied_designation_id,
  g.title as applied_designation_title,
  c.status,
  c.source,
  c.notes,
  c.created_at
from candidates c
left join designations g on g.id = c.applied_designation_id;

create view interview_detail with (security_invoker = on) as
select
  i.id,
  i.candidate_id,
  i.scheduled_at,
  i.interviewer_id,
  e.full_name as interviewer_name,
  i.notes,
  i.outcome
from interviews i
left join employees e on e.id = i.interviewer_id;

create view policy_detail with (security_invoker = on) as
select
  p.id,
  p.title,
  p.content,
  p.version,
  public.user_display_name(p.updated_by) as updated_by_name,
  p.updated_at
from policies p;

create view generated_letter_detail with (security_invoker = on) as
select
  l.id,
  l.employee_id,
  e.full_name as employee_name,
  l.letter_type,
  public.user_display_name(l.generated_by) as generated_by_name,
  l.generated_at
from generated_letters l
join employees e on e.id = l.employee_id;

create view announcement_detail with (security_invoker = on) as
select
  a.id,
  a.title,
  a.body,
  a.category,
  a.pinned,
  public.user_display_name(a.created_by) as created_by_name,
  a.created_at
from announcements a;

create view company_event_detail with (security_invoker = on) as
select
  c.id,
  c.title,
  c.description,
  c.event_date,
  c.event_type,
  public.user_display_name(c.created_by) as created_by_name
from company_events c;

create view audit_log_detail with (security_invoker = on) as
select
  l.id,
  l.user_id,
  public.user_display_name(l.user_id) as user_name,
  l.action,
  l.entity,
  l.entity_id,
  l.created_at
from audit_logs l;

grant select on
  employee_directory, attendance_detail, leave_balance_detail, leave_request_detail,
  project_directory, project_member_detail, task_directory, task_comment_detail,
  candidate_directory, interview_detail,
  asset_detail, asset_assignment_detail, salary_structure_detail, payslip_detail,
  policy_detail, generated_letter_detail, announcement_detail, company_event_detail,
  audit_log_detail
to authenticated;

-- Views inherit Supabase's default grants, which include `anon`. Every view is
-- security_invoker so an anonymous caller would see nothing anyway, but there is
-- no reason for the endpoint to exist.
revoke all on
  employee_directory, attendance_detail, leave_balance_detail, leave_request_detail,
  project_directory, project_member_detail, task_directory, task_comment_detail,
  candidate_directory, interview_detail,
  asset_detail, asset_assignment_detail, salary_structure_detail, payslip_detail,
  policy_detail, generated_letter_detail, announcement_detail, company_event_detail,
  audit_log_detail
from anon;

-- Resolves any user's display name, so it is not for anonymous callers — but the
-- security_invoker views above call it, so `authenticated` must keep EXECUTE.

-- =============================================================================
-- Session
-- =============================================================================

-- Replaces `GET /auth/me`. Returns null when the signed-in auth identity has no
-- active app user, which is how the UI knows to bounce back to the login screen.
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
    'photo_url', e.photo_url
  )
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where u.auth_id = auth.uid() and u.is_active
$$;

-- =============================================================================
-- Employees
-- =============================================================================

-- PAN / Aadhaar / bank details are withheld from the base table grant, so this
-- is the only way to read them — and only HR or the employee themselves get
-- the real values. Everyone else sees the profile with those fields nulled.
create or replace function public.get_employee_detail(p_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_privileged boolean;
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_privileged := public.app_is_hr() or p_id = public.app_employee_id();

  select to_jsonb(d) || jsonb_build_object(
    'skills',              to_jsonb(coalesce(d.skills, '{}'::varchar[])),
    'pan_number',          case when v_privileged then e.pan_number end,
    'aadhaar_number',      case when v_privileged then e.aadhaar_number end,
    'bank_account_number', case when v_privileged then e.bank_account_number end,
    'bank_ifsc',           case when v_privileged then e.bank_ifsc end,
    'bank_name',           case when v_privileged then e.bank_name end,
    'role',                r.name
  )
  into v_result
  from employee_directory d
  join employees e on e.id = d.id
  join users u on u.id = e.user_id
  join roles r on r.id = u.role_id
  where d.id = p_id;

  if v_result is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.next_employee_code()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select 'WP-' || ((select count(*) from employees) + 1001)::text $$;


-- Called by the `admin-users` edge function with the service key, right after it
-- has created the auth identity. Never exposed to a browser session: the account
-- and the profile have to appear together or not at all.
create or replace function public.create_employee_profile(
  p_auth_id uuid,
  p_email text,
  p_role text,
  p_employee jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
  v_user_id integer;
  v_employee_id integer;
begin
  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  if exists (select 1 from users where lower(email) = lower(p_email)) then
    raise exception 'An account with email % already exists', p_email;
  end if;

  insert into users (auth_id, email, role_id)
  values (p_auth_id, p_email, v_role_id)
  returning id into v_user_id;

  insert into employees (
    user_id, employee_code, first_name, last_name, phone, address, dob, gender,
    department_id, designation_id, reporting_manager_id, joining_date, skills,
    experience_years, pan_number, aadhaar_number, bank_account_number, bank_ifsc,
    bank_name, status
  )
  values (
    v_user_id,
    public.next_employee_code(),
    p_employee->>'first_name',
    coalesce(p_employee->>'last_name', ''),
    p_employee->>'phone',
    p_employee->>'address',
    nullif(p_employee->>'dob', '')::date,
    nullif(p_employee->>'gender', '')::gender_enum,
    nullif(p_employee->>'department_id', '')::integer,
    nullif(p_employee->>'designation_id', '')::integer,
    nullif(p_employee->>'reporting_manager_id', '')::integer,
    nullif(p_employee->>'joining_date', '')::date,
    case
      when p_employee->'skills' is null or jsonb_typeof(p_employee->'skills') <> 'array' then null
      else array(select jsonb_array_elements_text(p_employee->'skills'))::varchar[]
    end,
    nullif(p_employee->>'experience_years', '')::integer,
    p_employee->>'pan_number',
    p_employee->>'aadhaar_number',
    p_employee->>'bank_account_number',
    p_employee->>'bank_ifsc',
    p_employee->>'bank_name',
    coalesce((p_employee->>'status')::employee_status_enum, 'active')
  )
  returning id into v_employee_id;

  return v_employee_id;
end;
$$;

-- No browser session may call this. `service_role` must: it is what the seed
-- script and the admin-users Edge Function authenticate as, and EXECUTE reaches
-- service_role only through the PUBLIC grant being revoked here, so it has to be
-- granted back explicitly.

-- Deactivation is a soft delete across two tables, and you cannot lock yourself out.
create or replace function public.deactivate_employee(p_id integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select user_id into v_user_id from employees where id = p_id;
  if v_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if v_user_id = public.app_user_id() then
    raise exception 'You cannot deactivate your own account';
  end if;

  update employees set status = 'inactive' where id = p_id;
  update users set is_active = false where id = v_user_id;
end;
$$;

-- Changing someone's role writes to `users`, which the employee form cannot see.
create or replace function public.set_employee_role(p_employee_id integer, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  update users u set role_id = v_role_id
  from employees e
  where e.id = p_employee_id and u.id = e.user_id;
end;
$$;

-- =============================================================================
-- Attendance
-- =============================================================================

create or replace function public.attendance_check_in()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_today date := (now() at time zone 'utc')::date;
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  insert into attendance_records (employee_id, date, check_in, status)
  values (v_employee_id, v_today, now(), 'present')
  on conflict (employee_id, date) do update
    set check_in = excluded.check_in, status = 'present'
    where attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Already checked in today';
  end if;

  return v_id;
end;
$$;

create or replace function public.attendance_check_out()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_today date := (now() at time zone 'utc')::date;
  v_record attendance_records;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  select * into v_record from attendance_records
  where employee_id = v_employee_id and date = v_today;

  if v_record.id is null or v_record.check_in is null then
    raise exception 'You haven''t checked in today';
  end if;
  if v_record.check_out is not null then
    raise exception 'Already checked out today';
  end if;

  update attendance_records set check_out = now() where id = v_record.id;
  return v_record.id;
end;
$$;

-- Counts across the whole company, which a plain employee cannot select.
create or replace function public.attendance_summary(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_total integer;
  v_present integer;
  v_half integer;
  v_leave integer;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select count(*) into v_total from employees where status = 'active';
  select count(*) into v_present from attendance_records where date = v_date and status = 'present';
  select count(*) into v_half from attendance_records where date = v_date and status = 'half_day';
  select count(*) into v_leave from leave_requests
    where status = 'approved' and start_date <= v_date and end_date >= v_date;

  return jsonb_build_object(
    'date', v_date,
    'present', v_present,
    'absent', greatest(v_total - v_present - v_half - v_leave, 0),
    'on_leave', v_leave,
    'half_day', v_half,
    'total_employees', v_total
  );
end;
$$;

-- =============================================================================
-- Leave
-- =============================================================================

create or replace function public.apply_leave(
  p_leave_type_id integer,
  p_start_date date,
  p_end_date date,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;
  if p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  insert into leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, reason)
  values (
    v_employee_id, p_leave_type_id, p_start_date, p_end_date,
    (p_end_date - p_start_date) + 1, p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Approving also spends the balance, so both have to happen in one transaction.
create or replace function public.decide_leave_request(p_id integer, p_approve boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request leave_requests;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_request from leave_requests where id = p_id for update;
  if v_request.id is null then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;

  update leave_requests set
    status = case when p_approve then 'approved'::leave_status_enum else 'rejected'::leave_status_enum end,
    decided_by = public.app_user_id(),
    decided_at = now()
  where id = p_id;

  if p_approve then
    update leave_balances
    set used_days = used_days + v_request.days_count
    where employee_id = v_request.employee_id
      and leave_type_id = v_request.leave_type_id
      and year = extract(year from v_request.start_date);
  end if;

  return p_id;
end;
$$;

-- =============================================================================
-- Tasks
-- =============================================================================

-- Everyone may move a task along the board, but only a manager may re-scope it,
-- and only the assignee may report a completion percentage.
create or replace function public.update_task(p_id integer, p_patch jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task tasks;
  v_extra_keys text[];
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if not public.app_manages_tasks() then
    select array_agg(k) into v_extra_keys
    from jsonb_object_keys(p_patch) k
    where k not in ('status', 'progress');

    if v_extra_keys is not null then
      raise exception 'You can only update a task''s status and progress' using errcode = '42501';
    end if;
  end if;

  if p_patch ? 'progress' and v_task.assigned_to is distinct from public.app_employee_id() then
    raise exception 'Only the assignee can update a task''s progress percentage' using errcode = '42501';
  end if;

  update tasks t set
    title       = case when p_patch ? 'title' then p_patch->>'title' else t.title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
    -- nullif('') because a cleared form field arrives as "" rather than as null
    project_id  = case when p_patch ? 'project_id' then nullif(p_patch->>'project_id', '')::integer else t.project_id end,
    assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::integer else t.assigned_to end,
    priority    = case when p_patch ? 'priority' then (p_patch->>'priority')::priority_enum else t.priority end,
    due_date    = case when p_patch ? 'due_date' then nullif(p_patch->>'due_date', '')::date else t.due_date end,
    status      = case when p_patch ? 'status' then (p_patch->>'status')::task_status_enum else t.status end,
    progress    = case when p_patch ? 'progress' then (p_patch->>'progress')::integer else t.progress end
  where t.id = p_id;

  return p_id;
end;
$$;

-- =============================================================================
-- Assets
-- =============================================================================

create or replace function public.assign_asset(p_asset_id integer, p_employee_id integer, p_notes text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status asset_status_enum;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select status into v_status from assets where id = p_asset_id for update;
  if v_status is null then
    raise exception 'Asset not found' using errcode = 'P0002';
  end if;
  if v_status <> 'available' then
    raise exception 'Asset is currently % and cannot be assigned', v_status;
  end if;

  insert into asset_assignments (asset_id, employee_id, assigned_date, notes)
  values (p_asset_id, p_employee_id, (now() at time zone 'utc')::date, p_notes);

  update assets set status = 'assigned' where id = p_asset_id;
  return p_asset_id;
end;
$$;

create or replace function public.return_asset(p_asset_id integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select id into v_assignment_id from asset_assignments
  where asset_id = p_asset_id and returned_date is null
  limit 1;

  if v_assignment_id is null then
    raise exception 'This asset is not currently assigned to anyone';
  end if;

  update asset_assignments set returned_date = (now() at time zone 'utc')::date where id = v_assignment_id;
  update assets set status = 'available' where id = p_asset_id;
  return p_asset_id;
end;
$$;

-- =============================================================================
-- Payroll
-- =============================================================================

create or replace function public.compute_payslip(p_employee_id integer)
returns table (
  basic numeric, hra numeric, special_allowance numeric, gross_pay numeric,
  pf_deduction numeric, esi_deduction numeric, professional_tax numeric, net_pay numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.basic,
    s.hra,
    s.special_allowance,
    s.basic + s.hra + s.special_allowance as gross_pay,
    round(s.basic * s.pf_percent / 100, 2) as pf_deduction,
    round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2) as esi_deduction,
    case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end::numeric as professional_tax,
    round(
      (s.basic + s.hra + s.special_allowance)
      - round(s.basic * s.pf_percent / 100, 2)
      - round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2)
      - case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end,
      2
    ) as net_pay
  from salary_structures s
  where s.employee_id = p_employee_id
$$;

-- Salary maths, not a salary reader: only the SECURITY DEFINER routines below
-- call it, and they run as the owner, so no client needs EXECUTE.

create or replace function public.generate_payslip(p_employee_id integer, p_month integer, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if exists (
    select 1 from payslips where employee_id = p_employee_id and month = p_month and year = p_year
  ) then
    raise exception 'A payslip for this employee and month already exists';
  end if;
  if not exists (select 1 from salary_structures where employee_id = p_employee_id) then
    raise exception 'This employee has no salary structure configured';
  end if;

  insert into payslips (
    employee_id, month, year, basic, hra, special_allowance, gross_pay,
    pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
  )
  select
    p_employee_id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
    c.pf_deduction, c.esi_deduction, c.professional_tax, c.net_pay, public.app_user_id()
  from public.compute_payslip(p_employee_id) c
  returning id into v_id;

  return v_id;
end;
$$;

-- Skips employees who already have a payslip for the month or no salary
-- structure — same forgiving behaviour as payroll_service.generate_bulk.
create or replace function public.generate_payslips_bulk(p_month integer, p_year integer)
returns integer[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids integer[];
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  with eligible as (
    select e.id
    from employees e
    join salary_structures s on s.employee_id = e.id
    where e.status = 'active'
      and not exists (
        select 1 from payslips p
        where p.employee_id = e.id and p.month = p_month and p.year = p_year
      )
  ),
  inserted as (
    insert into payslips (
      employee_id, month, year, basic, hra, special_allowance, gross_pay,
      pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
    )
    select
      e.id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
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
  v_gross numeric;
  v_net numeric;
  v_count integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(sum(gross_pay), 0), coalesce(sum(net_pay), 0), count(*)
  into v_gross, v_net, v_count
  from payslips where month = p_month and year = p_year;

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

-- =============================================================================
-- Documents
-- =============================================================================

create or replace function public.letter_payload(p_letter_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', l.id,
    'letter_type', l.letter_type,
    'employee_name', e.full_name,
    'employee_code', e.employee_code,
    'employee_address', e.address,
    'designation_title', g.title,
    'department_name', d.name,
    'joining_date', e.joining_date,
    'reporting_manager_name', m.full_name,
    'annual_ctc', coalesce(l.annual_ctc_override, (select c.gross_pay * 12 from public.compute_payslip(e.id) c)),
    'probation_text', coalesce(l.probation_text, 'Six months from the date of joining'),
    'notice_period_text', coalesce(l.notice_period_text, 'Thirty days on either side after confirmation'),
    'custom_message', l.custom_message,
    'company_name', coalesce((select company_name from company_settings limit 1), 'Whhohh Path LLP'),
    'company_address', (select address from company_settings limit 1),
    'today', (now() at time zone 'utc')::date,
    'generated_at', l.generated_at
  )
  into v_result
  from generated_letters l
  join employees e on e.id = l.employee_id
  left join departments d on d.id = e.department_id
  left join designations g on g.id = e.designation_id
  left join employees m on m.id = e.reporting_manager_id
  where l.id = p_letter_id;

  return v_result;
end;
$$;


create or replace function public.generate_letter(
  p_employee_id integer,
  p_letter_type text,
  p_custom_message text default null,
  p_annual_ctc numeric default null,
  p_probation_text text default null,
  p_notice_period_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if not exists (select 1 from employees where id = p_employee_id) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  insert into generated_letters (
    employee_id, letter_type, custom_message, annual_ctc_override,
    probation_text, notice_period_text, generated_by
  )
  values (
    p_employee_id, p_letter_type::letter_type_enum, p_custom_message, p_annual_ctc,
    p_probation_text, p_notice_period_text, public.app_user_id()
  )
  returning id into v_id;

  return public.letter_payload(v_id);
end;
$$;

create or replace function public.get_letter_view(p_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer;
begin
  select employee_id into v_employee_id from generated_letters where id = p_id;
  if v_employee_id is null then
    raise exception 'Letter not found' using errcode = 'P0002';
  end if;
  if not public.app_is_hr() and v_employee_id is distinct from public.app_employee_id() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return public.letter_payload(p_id);
end;
$$;

-- =============================================================================
-- Calendar
-- =============================================================================

-- Merges five sources; the leave entries in particular cover the whole company,
-- which no plain employee can read directly.
create or replace function public.get_calendar(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_month integer := coalesce(p_month, extract(month from now() at time zone 'utc')::integer);
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  select coalesce(jsonb_agg(entry order by entry->>'date'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object('date', event_date, 'type', event_type, 'title', title) as entry
    from company_events
    where event_date between v_start and v_end

    union all

    select jsonb_build_object(
      'date', greatest(r.start_date, v_start),
      'type', 'leave',
      'title', e.full_name || ' on leave'
    )
    from leave_requests r
    join employees e on e.id = r.employee_id
    where r.status = 'approved' and r.start_date <= v_end and r.end_date >= v_start

    union all

    select jsonb_build_object('date', due_date, 'type', 'task_due', 'title', 'Task due: ' || title)
    from tasks
    where due_date between v_start and v_end

    union all

    select jsonb_build_object('date', deadline, 'type', 'project_deadline', 'title', 'Project deadline: ' || name)
    from projects
    where deadline between v_start and v_end

    union all

    select jsonb_build_object(
      'date', make_date(v_year, v_month, extract(day from dob)::integer),
      'type', 'birthday',
      'title', full_name || '''s birthday'
    )
    from employees
    where dob is not null
      and extract(month from dob) = v_month
      -- 29 Feb birthdays simply do not appear in a non-leap year
      and (extract(day from dob) <> 29 or v_month <> 2
           or extract(day from (make_date(v_year, 3, 1) - 1)) = 29)
  ) entries;

  return v_result;
end;
$$;

-- =============================================================================
-- Reports (HR only — every one of them reads across the whole company)
-- =============================================================================

create or replace function public.report_attendance(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_month integer := coalesce(p_month, extract(month from now() at time zone 'utc')::integer);
  v_start date;
  v_end date;
  v_days integer;
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := least((v_start + interval '1 month - 1 day')::date, (now() at time zone 'utc')::date);
  v_days := case when v_end >= v_start then (v_end - v_start) + 1 else 0 end;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'employee_id', e.id,
      'employee_name', e.full_name,
      'present_days', s.present,
      'absent_days', greatest(v_days - s.present - s.half_day - s.on_leave, 0),
      'half_days', s.half_day,
      'late_count', s.late_count
    ) as row
    from employees e
    cross join lateral (
      select
        count(*) filter (where a.status = 'present') as present,
        count(*) filter (where a.status = 'half_day') as half_day,
        count(*) filter (where a.status = 'on_leave') as on_leave,
        count(*) filter (where (a.check_in at time zone 'utc')::time > time '09:30') as late_count
      from attendance_records a
      where a.employee_id = e.id and a.date between v_start and v_end
    ) s
    where e.status = 'active'
    order by e.full_name
  ) rows;

  return v_result;
end;
$$;

create or replace function public.report_leaves(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'employee_id', b.employee_id,
      'employee_name', e.full_name,
      'leave_type_name', t.name,
      'allocated_days', b.allocated_days,
      'used_days', b.used_days,
      'remaining_days', b.allocated_days - b.used_days
    ) as row
    from leave_balances b
    join employees e on e.id = b.employee_id
    join leave_types t on t.id = b.leave_type_id
    where b.year = v_year
    order by e.full_name, t.name
  ) rows;

  return v_result;
end;
$$;

create or replace function public.report_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'assignee_id', t.assigned_to,
      'assignee_name', coalesce(e.full_name, 'Unassigned'),
      'assigned', count(*) filter (where t.status = 'assigned'),
      'in_progress', count(*) filter (where t.status = 'in_progress'),
      'review', count(*) filter (where t.status = 'review'),
      'completed', count(*) filter (where t.status = 'completed')
    ) as row
    from tasks t
    left join employees e on e.id = t.assigned_to
    group by t.assigned_to, e.full_name
    order by coalesce(e.full_name, 'Unassigned')
  ) rows;

  return v_result;
end;
$$;

create or replace function public.report_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'priority', p.priority,
      'progress', p.progress,
      'member_count', (select count(*) from project_members m where m.project_id = p.id),
      'deadline', p.deadline
    ) as row
    from projects p
    order by p.created_at desc
  ) rows;

  return v_result;
end;
$$;

create or replace function public.report_employees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'department_name', coalesce(d.name, 'Unassigned'),
      'designation_title', coalesce(g.title, 'Unassigned'),
      'active_count', count(*) filter (where e.status = 'active'),
      'inactive_count', count(*) filter (where e.status <> 'active')
    ) as row
    from employees e
    left join departments d on d.id = e.department_id
    left join designations g on g.id = e.designation_id
    group by coalesce(d.name, 'Unassigned'), coalesce(g.title, 'Unassigned')
    order by 1
  ) rows;

  return v_result;
end;
$$;

-- =============================================================================
-- Settings
-- =============================================================================

create or replace function public.upsert_company_settings(
  p_company_name text,
  p_address text default null,
  p_logo_url text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not public.app_is_founder() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select id into v_id from company_settings limit 1;

  if v_id is null then
    insert into company_settings (company_name, address, logo_url)
    values (p_company_name, p_address, p_logo_url)
    returning id into v_id;
  else
    update company_settings
    set company_name = p_company_name, address = p_address, logo_url = p_logo_url, updated_at = now()
    where id = v_id;
  end if;

  return v_id;
end;
$$;


-- ###########################################################################
-- supabase/migrations/0004_reference_data.sql
-- ###########################################################################

-- =============================================================================
-- 0004 — Reference data
--
-- The lookup rows the app cannot start without. Idempotent: safe to re-run.
-- People (and the demo project/policies/announcements that hang off them) are
-- seeded by supabase/seed.mjs instead, because creating a login needs the
-- service key and the Auth admin API.
-- =============================================================================

insert into roles (name, description) values
  ('founder',         'Full access to every module'),
  ('hr_admin',        'Manages people, payroll and documents'),
  ('project_manager', 'Manages projects and tasks'),
  ('team_lead',       'Manages tasks for their team'),
  ('employee',        'Self-service access')
on conflict (name) do nothing;

insert into permissions (code) values
  ('employees.manage'),
  ('employees.view'),
  ('projects.manage'),
  ('tasks.manage'),
  ('payroll.manage')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('founder',         'employees.manage'),
  ('founder',         'employees.view'),
  ('founder',         'projects.manage'),
  ('founder',         'tasks.manage'),
  ('founder',         'payroll.manage'),
  ('hr_admin',        'employees.manage'),
  ('hr_admin',        'employees.view'),
  ('project_manager', 'employees.view'),
  ('project_manager', 'projects.manage'),
  ('project_manager', 'tasks.manage'),
  ('team_lead',       'employees.view'),
  ('team_lead',       'tasks.manage'),
  ('employee',        'employees.view')
) as m(role_name, permission_code)
join roles r on r.name = m.role_name
join permissions p on p.code = m.permission_code
on conflict do nothing;

insert into departments (name) values
  ('Engineering'), ('Design'), ('AI/ML'), ('Operations')
on conflict (name) do nothing;

insert into designations (title) values
  ('Founder & CEO'), ('Software Engineer'), ('Product Designer'), ('AI Engineer'), ('HR Executive')
on conflict (title) do nothing;

insert into leave_types (name, default_days_per_year) values
  ('Casual Leave', 12),
  ('Sick Leave', 10),
  ('Paid Leave', 15),
  ('Work From Home', 24),
  ('Comp Off', 5)
on conflict (name) do nothing;

insert into company_settings (company_name, address)
select 'Whhohh Path LLP', 'Bengaluru, Karnataka, India'
where not exists (select 1 from company_settings);


-- ###########################################################################
-- supabase/migrations/0010_tenancy_schema.sql
-- ###########################################################################

-- =============================================================================
-- 0010 — Multi-tenancy: schema
--
-- Turns the single-company HRMS into a platform that hosts many client
-- companies. This file is the first of the tenancy migrations and is
-- deliberately ADDITIVE ONLY: it creates the platform tables and adds a
-- nullable `company_id` to everything a company owns.
--
-- Nothing here changes behaviour. Every existing query, policy and function
-- keeps working exactly as before, because nothing yet reads the new column.
-- The rows are assigned to a company in 0011, and the policies start enforcing
-- it in 0012. Splitting it this way means each step can be verified on its own,
-- and this one can be rolled back by dropping what it created.
--
-- Built on the schema as it actually stands in the live project (0001-0006).
-- Migrations 0007-0009 are NOT applied and are not assumed here; when they are
-- revisited they should be re-authored with `company_id` already in place.
--
-- Safe to re-run: every statement is guarded.
-- =============================================================================


-- ---------------------------------------------------------------- enum types
-- `create type` has no IF NOT EXISTS, so each is guarded individually rather
-- than wrapping the file in a transaction that would abort on the first repeat.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'company_status_enum') then
    create type company_status_enum as enum ('trial', 'active', 'suspended', 'inactive');
  end if;

  -- The commercial lifecycle, separate from `status`: a company can be
  -- technically active while still being onboarded, and HR support needs to
  -- see which of the two states it is in.
  if not exists (select 1 from pg_type where typname = 'onboarding_status_enum') then
    create type onboarding_status_enum as enum (
      'new', 'setup_in_progress', 'configuration', 'ready', 'active'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'billing_cycle_enum') then
    create type billing_cycle_enum as enum ('monthly', 'quarterly', 'annual');
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status_enum') then
    create type subscription_status_enum as enum (
      'trialing', 'active', 'past_due', 'cancelled', 'expired'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'service_status_enum') then
    create type service_status_enum as enum (
      'requested', 'scheduled', 'in_progress', 'completed', 'cancelled'
    );
  end if;
end $$;


-- =============================================================================
-- Platform tables
--
-- These are owned by the platform, not by any tenant. Only the super admin
-- writes them; 0012 attaches the policies that say so.
-- =============================================================================

-- The tenant. Every company-owned row in the database points here.
--
-- `code` is the human-readable handle (WPL, ACME) used in employee codes and
-- reserved for future subdomain routing. It is not the primary key: an integer
-- key keeps the foreign keys narrow across 25 tables and matches the existing
-- schema's style, while `code` can be renamed without a cascade.
create table if not exists companies (
  id serial primary key,
  name varchar(200) not null,
  code varchar(20) not null,

  email varchar(255),
  phone varchar(20),
  website varchar(255),

  address varchar(500),
  city varchar(100),
  state varchar(100),
  country varchar(100),

  logo_url varchar(500),
  industry varchar(100),
  company_size varchar(50),

  status            company_status_enum    not null default 'trial',
  onboarding_status onboarding_status_enum not null default 'new',

  -- Employee headcount ceiling, denormalised from the active subscription so
  -- the limit can be enforced in a policy without a join to the plan.
  employee_limit integer,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ix_companies_code on companies (upper(code));
create index if not exists ix_companies_status on companies (status);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'companies_set_updated_at'
  ) then
    create trigger companies_set_updated_at before update on companies
      for each row execute function public.set_updated_at();
  end if;
end $$;


-- Which HRMS modules a company may use.
--
-- A row per company per module, rather than a jsonb blob, so that a policy can
-- join against it cheaply and so enabling a module is an ordinary insert that
-- the audit log records like any other change.
create table if not exists company_modules (
  id serial primary key,
  company_id integer not null references companies (id) on delete cascade,
  -- Matches the `module` key on the frontend nav entries, so the sidebar and
  -- the policies are driven by the same vocabulary.
  module varchar(50) not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint uq_company_module unique (company_id, module)
);

create index if not exists ix_company_modules_lookup
  on company_modules (company_id, module) where is_enabled;


-- Commercial plans offered by the platform. Global, not per tenant.
create table if not exists subscription_plans (
  id serial primary key,
  name varchar(100) not null unique,
  description varchar(500),
  employee_limit integer,
  storage_mb integer,
  price_amount numeric(10, 2),
  price_currency varchar(3) not null default 'INR',
  -- The modules a plan grants by default. Applied when a company is created;
  -- company_modules remains the authority afterwards, so a plan change never
  -- silently switches off a module someone is mid-way through using.
  default_modules varchar[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);


create table if not exists company_subscriptions (
  id serial primary key,
  company_id integer not null references companies (id) on delete cascade,
  plan_id integer not null references subscription_plans (id),
  status subscription_status_enum not null default 'trialing',
  billing_cycle billing_cycle_enum not null default 'monthly',
  start_date date not null,
  end_date date,
  employee_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live subscription per company. A partial unique index rather than a plain
-- one, so historical cancelled/expired rows are kept for billing history.
create unique index if not exists ix_company_subscription_current
  on company_subscriptions (company_id)
  where status in ('trialing', 'active', 'past_due');

create index if not exists ix_company_subscriptions_company
  on company_subscriptions (company_id);


-- Services the platform sells alongside the software (setup, migration,
-- consulting). Catalogue is global; assignments are per company.
create table if not exists platform_services (
  id serial primary key,
  name varchar(150) not null unique,
  description varchar(500),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists company_services (
  id serial primary key,
  company_id integer not null references companies (id) on delete cascade,
  service_id integer not null references platform_services (id),
  status service_status_enum not null default 'requested',
  assigned_date date,
  due_date date,
  -- The platform-side person responsible. References `users`, which after 0011
  -- carries a company_id — a super admin's row will have company_id null.
  assigned_to integer references users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_company_services_company on company_services (company_id);


-- Support-mode sessions: a super admin acting inside a tenant.
--
-- Recorded as its own table rather than as audit rows because the session has a
-- lifetime — it is opened, it is used, it is closed — and because "who was in
-- which tenant, when" is a question that gets asked on its own.
create table if not exists support_sessions (
  id serial primary key,
  super_admin_user_id integer not null references users (id) on delete cascade,
  company_id integer not null references companies (id) on delete cascade,
  reason varchar(500),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ip_address inet
);

create index if not exists ix_support_sessions_open
  on support_sessions (super_admin_user_id) where ended_at is null;


-- =============================================================================
-- Tenant column on company-owned tables
--
-- Nullable for now. 0011 fills it in and applies NOT NULL; doing it in one step
-- would fail on every existing row.
--
-- Denormalised onto child tables (task_comments, project_members, ...) rather
-- than reached through a parent join. Under RLS a policy that joins runs a
-- subquery per row; a plain equality check on an indexed column does not. At
-- hundreds of companies that difference is the whole performance story.
-- =============================================================================

do $$
declare
  -- Every table a company owns. `roles`, `permissions` and `role_permissions`
  -- are deliberately absent: they are platform vocabulary shared by all tenants.
  t text;
  tenant_tables text[] := array[
    'users', 'employees', 'departments', 'designations',
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
  foreach t in array tenant_tables loop
    execute format(
      'alter table public.%I add column if not exists company_id integer references public.companies (id) on delete cascade',
      t
    );

    -- Single-column index: the tenant predicate is on every query, so it is the
    -- leading column of almost every access path.
    execute format(
      'create index if not exists ix_%s_company on public.%I (company_id)',
      t, t
    );
  end loop;
end $$;


-- `users.company_id` is the one that must stay nullable after 0011: a super
-- admin belongs to the platform, not to any tenant. That is what distinguishes
-- them, and 0012's helpers rely on it.
comment on column public.users.company_id is
  'Null means a platform-level user (super admin). Every other user belongs to exactly one company.';


-- Leave types are platform defaults today. Per-company leave configuration
-- needs overrides, so this column is nullable by design and stays that way:
-- null = a default offered to every tenant, set = that tenant's own type.
alter table public.leave_types
  add column if not exists company_id integer references public.companies (id) on delete cascade;

create index if not exists ix_leave_types_company on public.leave_types (company_id);


-- --------------------------------------------------- composite indexes
-- The access patterns that matter once every query carries a tenant predicate.
-- Created here rather than in 0012 so the policy migration has them ready.
create index if not exists ix_employees_company_status
  on employees (company_id, status);

create index if not exists ix_attendance_company_date
  on attendance_records (company_id, date);

create index if not exists ix_leave_requests_company_status
  on leave_requests (company_id, status);

create index if not exists ix_payslips_company_period
  on payslips (company_id, year, month);

create index if not exists ix_audit_logs_company_created
  on audit_logs (company_id, created_at desc);

create index if not exists ix_tasks_company_status
  on tasks (company_id, status);


-- --------------------------------------------------- audit log completeness
-- 21 of the platform requirements ask for IP and outcome on every audited
-- action. The table predates that; both are nullable so existing rows stay
-- valid and the writers can be updated one at a time.
alter table public.audit_logs add column if not exists ip_address inet;
alter table public.audit_logs add column if not exists result varchar(20);
-- Set when a super admin performed the action inside a tenant, so support-mode
-- activity is distinguishable from the company's own users acting.
alter table public.audit_logs
  add column if not exists support_session_id integer references support_sessions (id) on delete set null;




-- ###########################################################################
-- supabase/migrations/0011_tenancy_backfill.sql
-- ###########################################################################

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





-- ###########################################################################
-- supabase/migrations/0012_tenancy_security.sql
-- ###########################################################################

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





-- ###########################################################################
-- supabase/migrations/0013_tenancy_functions.sql
-- ###########################################################################

-- =============================================================================
-- 0013 — Multi-tenancy: SECURITY DEFINER functions
--
-- The most dangerous file in the tenancy set. Every function here runs as its
-- owner and therefore BYPASSES ROW LEVEL SECURITY ENTIRELY — the policies in
-- 0012 do not apply inside them. A function that forgets its tenant check is a
-- complete cross-tenant breach that no policy will catch.
--
-- Two rules, applied to every function below:
--
--   READS   filter by public.app_company_id()
--   WRITES  stamp company_id from public.app_company_id(), never from an
--           argument — an argument is something the browser chose
--
-- Requires 0010, 0011 and 0012.
--
-- ---------------------------------------------------------------------------
-- COVERAGE — READ THIS BEFORE RELYING ON THIS FILE
--
-- Scoped here (19):
--   current_user_profile, user_display_name, get_employee_detail,
--   create_employee_profile, deactivate_employee, set_employee_role,
--   attendance_check_in, attendance_summary,
--   apply_leave, decide_leave_request,
--   compute_payslip, generate_payslip,
--   generate_letter, letter_payload,
--   report_attendance, report_leaves, report_employees, report_tasks,
--   report_projects
--
-- STILL UNSCOPED — a follow-up 0013b must cover these before any second
-- company is onboarded. Each is a live cross-tenant hole until then:
--   generate_payslips_bulk, payroll_summary, get_letter_view, get_calendar,
--   update_task, assign_asset, return_asset, upsert_company_settings
--
-- Trigger functions needing no change, because they act only on the row being
-- modified and inherit its tenant:
--   bump_policy_version, advance_candidate_on_interview
-- ---------------------------------------------------------------------------
-- =============================================================================


-- =============================================================================
-- Session and identity
-- =============================================================================

-- The frontend's whole picture of who is signed in. Gains the tenant, so the
-- client can brand itself and build its sidebar, and an explicit super-admin
-- flag so it knows to show the platform console instead of an HRMS.
--
-- `modules` drives the sidebar. It is advisory only — 0012 enforces the same
-- list in the policies, so hiding a link is presentation, not protection.
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
    -- Set only while a support session is open, so the client can show the
    -- "you are inside a customer's account" banner.
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
  where u.auth_id = auth.uid() and u.is_active
$$;


-- Resolves a user's display name for the views. Scoped so a name cannot be
-- probed by iterating ids across tenants.
create or replace function public.user_display_name(p_user_id integer)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(e.full_name, u.email)
  from users u
  left join employees e on e.user_id = u.id
  where u.id = p_user_id
    and u.company_id = public.app_company_id()
$$;


-- Hands out PAN / Aadhaar / bank details, so the tenant check matters twice
-- over: wrong company must not merely be filtered, it must not resolve at all.
create or replace function public.get_employee_detail(p_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_privileged boolean;
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_privileged := public.app_is_hr() or p_id = public.app_employee_id();

  select to_jsonb(d) || jsonb_build_object(
    'skills',              to_jsonb(coalesce(d.skills, '{}'::varchar[])),
    'pan_number',          case when v_privileged then e.pan_number end,
    'aadhaar_number',      case when v_privileged then e.aadhaar_number end,
    'bank_account_number', case when v_privileged then e.bank_account_number end,
    'bank_ifsc',           case when v_privileged then e.bank_ifsc end,
    'bank_name',           case when v_privileged then e.bank_name end,
    'role',                r.name
  )
  into v_result
  from employee_directory d
  join employees e on e.id = d.id
  join users u on u.id = e.user_id
  join roles r on r.id = u.role_id
  where d.id = p_id
    and e.company_id = public.app_company_id();

  -- Same error for "does not exist" and "belongs to another company": the
  -- distinction would itself leak whether an id is in use elsewhere.
  if v_result is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;


-- =============================================================================
-- Employees
-- =============================================================================

-- Called by the admin-users Edge Function with the service key, immediately
-- after the auth identity is created.
--
-- p_company_id is a new, REQUIRED argument. It is not derived from
-- app_company_id() because the caller is which has no session and
-- therefore no company — the Edge Function is responsible for passing the
-- company it has already authorised the caller against.
create or replace function public.create_employee_profile(
  p_auth_id uuid,
  p_email text,
  p_role text,
  p_employee jsonb,
  p_company_id integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
  v_user_id integer;
  v_employee_id integer;
  v_limit integer;
  v_count integer;
begin
  if p_company_id is null then
    raise exception 'A company is required to create an employee';
  end if;
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Unknown company: %', p_company_id;
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  -- Email is globally unique in auth.users, so it is checked globally here too
  -- rather than per company. See 0011's notes on that decision.
  if exists (select 1 from users where lower(email) = lower(p_email)) then
    raise exception 'An account with email % already exists', p_email;
  end if;

  -- The subscription's headcount ceiling, enforced where the row is created
  -- rather than in the UI that requested it.
  select employee_limit into v_limit from companies where id = p_company_id;
  if v_limit is not null then
    select count(*) into v_count from employees where company_id = p_company_id;
    if v_count >= v_limit then
      raise exception 'This company has reached its limit of % employees', v_limit;
    end if;
  end if;

  insert into users (company_id, auth_id, email, role_id)
  values (p_company_id, p_auth_id, p_email, v_role_id)
  returning id into v_user_id;

  insert into employees (
    company_id, user_id, employee_code, first_name, last_name, phone, address, dob, gender,
    department_id, designation_id, reporting_manager_id, joining_date, skills,
    experience_years, pan_number, aadhaar_number, bank_account_number, bank_ifsc,
    bank_name, status
  )
  values (
    p_company_id,
    v_user_id,
    public.next_employee_code(p_company_id),
    p_employee->>'first_name',
    coalesce(p_employee->>'last_name', ''),
    p_employee->>'phone',
    p_employee->>'address',
    nullif(p_employee->>'dob', '')::date,
    nullif(p_employee->>'gender', '')::gender_enum,
    nullif(p_employee->>'department_id', '')::integer,
    nullif(p_employee->>'designation_id', '')::integer,
    nullif(p_employee->>'reporting_manager_id', '')::integer,
    nullif(p_employee->>'joining_date', '')::date,
    case
      when p_employee->'skills' is null or jsonb_typeof(p_employee->'skills') <> 'array' then null
      else array(select jsonb_array_elements_text(p_employee->'skills'))::varchar[]
    end,
    nullif(p_employee->>'experience_years', '')::integer,
    p_employee->>'pan_number',
    p_employee->>'aadhaar_number',
    p_employee->>'bank_account_number',
    p_employee->>'bank_ifsc',
    p_employee->>'bank_name',
    coalesce((p_employee->>'status')::employee_status_enum, 'active')
  )
  returning id into v_employee_id;

  return v_employee_id;
end;
$$;

-- The four-argument version would now create employees with a null company and
-- break the NOT NULL from 0011. Removed so a stale caller fails loudly.
drop function if exists public.create_employee_profile(uuid, text, text, jsonb);



create or replace function public.deactivate_employee(p_id integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select user_id into v_user_id
  from employees
  where id = p_id and company_id = public.app_company_id();

  if v_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if v_user_id = public.app_user_id() then
    raise exception 'You cannot deactivate your own account';
  end if;

  update employees set status = 'inactive' where id = p_id;
  update users set is_active = false where id = v_user_id;
end;
$$;


create or replace function public.set_employee_role(p_employee_id integer, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- A company admin must not be able to mint a super admin, which would be a
  -- privilege escalation out of their own tenant.
  if p_role = 'super_admin' then
    raise exception 'super_admin cannot be assigned from within a company' using errcode = '42501';
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  update users u set role_id = v_role_id
  from employees e
  where e.id = p_employee_id
    and u.id = e.user_id
    and e.company_id = public.app_company_id();

  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
end;
$$;


-- =============================================================================
-- Attendance
-- =============================================================================

create or replace function public.attendance_check_in()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id integer := public.app_company_id();
  v_today date := (now() at time zone 'utc')::date;
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  insert into attendance_records (company_id, employee_id, date, check_in, status)
  values (v_company_id, v_employee_id, v_today, now(), 'present')
  on conflict (employee_id, date) do update
    set check_in = excluded.check_in, status = 'present'
    where attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Already checked in today';
  end if;

  return v_id;
end;
$$;


-- Dashboard headline figures. Every count was company-wide and is now
-- tenant-wide — without this, Company A's dashboard would report the platform's
-- total headcount.
create or replace function public.attendance_summary(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_company integer := public.app_company_id();
  v_total integer;
  v_present integer;
  v_half integer;
  v_leave integer;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select count(*) into v_total from employees
    where status = 'active' and company_id = v_company;
  select count(*) into v_present from attendance_records
    where date = v_date and status = 'present' and company_id = v_company;
  select count(*) into v_half from attendance_records
    where date = v_date and status = 'half_day' and company_id = v_company;
  select count(*) into v_leave from leave_requests
    where status = 'approved' and start_date <= v_date and end_date >= v_date
      and company_id = v_company;

  return jsonb_build_object(
    'date', v_date,
    'present', v_present,
    'absent', greatest(v_total - v_present - v_half - v_leave, 0),
    'on_leave', v_leave,
    'half_day', v_half,
    'total_employees', v_total
  );
end;
$$;


-- =============================================================================
-- Leave
-- =============================================================================

create or replace function public.apply_leave(
  p_leave_type_id integer,
  p_start_date date,
  p_end_date date,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id integer := public.app_company_id();
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;
  if p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  -- The leave type must be a platform default or this company's own; an id
  -- belonging to another tenant is not selectable.
  if not exists (
    select 1 from leave_types
    where id = p_leave_type_id
      and (company_id is null or company_id = v_company_id)
  ) then
    raise exception 'Unknown leave type' using errcode = 'P0002';
  end if;

  insert into leave_requests (
    company_id, employee_id, leave_type_id, start_date, end_date, days_count, reason)
  values (
    v_company_id, v_employee_id, p_leave_type_id, p_start_date, p_end_date,
    (p_end_date - p_start_date) + 1, p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;


create or replace function public.decide_leave_request(p_id integer, p_approve boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request leave_requests;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_request from leave_requests
   where id = p_id and company_id = public.app_company_id()
   for update;

  if v_request.id is null then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;

  update leave_requests set
    status = case when p_approve then 'approved'::leave_status_enum else 'rejected'::leave_status_enum end,
    decided_by = public.app_user_id(),
    decided_at = now()
  where id = p_id;

  if p_approve then
    update leave_balances
    set used_days = used_days + v_request.days_count
    where employee_id = v_request.employee_id
      and leave_type_id = v_request.leave_type_id
      and year = extract(year from v_request.start_date)
      and company_id = v_request.company_id;
  end if;

  return p_id;
end;
$$;


-- =============================================================================
-- Payroll
-- =============================================================================

create or replace function public.compute_payslip(p_employee_id integer)
returns table (
  basic numeric, hra numeric, special_allowance numeric, gross_pay numeric,
  pf_deduction numeric, esi_deduction numeric, professional_tax numeric, net_pay numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.basic,
    s.hra,
    s.special_allowance,
    s.basic + s.hra + s.special_allowance as gross_pay,
    round(s.basic * s.pf_percent / 100, 2) as pf_deduction,
    round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2) as esi_deduction,
    case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end::numeric as professional_tax,
    round(
      (s.basic + s.hra + s.special_allowance)
      - round(s.basic * s.pf_percent / 100, 2)
      - round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2)
      - case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end,
      2
    ) as net_pay
  from salary_structures s
  where s.employee_id = p_employee_id
    and s.company_id = public.app_company_id()
$$;



create or replace function public.generate_payslip(p_employee_id integer, p_month integer, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id integer := public.app_company_id();
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if not exists (
    select 1 from employees where id = p_employee_id and company_id = v_company_id
  ) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from payslips
    where employee_id = p_employee_id and month = p_month and year = p_year
      and company_id = v_company_id
  ) then
    raise exception 'A payslip for this employee and month already exists';
  end if;
  if not exists (
    select 1 from salary_structures
    where employee_id = p_employee_id and company_id = v_company_id
  ) then
    raise exception 'This employee has no salary structure configured';
  end if;

  insert into payslips (
    company_id, employee_id, month, year, basic, hra, special_allowance, gross_pay,
    pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
  )
  select
    v_company_id, p_employee_id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
    c.pf_deduction, c.esi_deduction, c.professional_tax, c.net_pay, public.app_user_id()
  from public.compute_payslip(p_employee_id) c
  returning id into v_id;

  return v_id;
end;
$$;


-- =============================================================================
-- Letters
-- =============================================================================

create or replace function public.generate_letter(
  p_employee_id integer,
  p_letter_type text,
  p_custom_message text default null,
  p_annual_ctc numeric default null,
  p_probation_text text default null,
  p_notice_period_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id integer := public.app_company_id();
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if not exists (
    select 1 from employees where id = p_employee_id and company_id = v_company_id
  ) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  insert into generated_letters (
    company_id, employee_id, letter_type, custom_message, annual_ctc_override,
    probation_text, notice_period_text, generated_by
  )
  values (
    v_company_id, p_employee_id, p_letter_type::letter_type_enum, p_custom_message, p_annual_ctc,
    p_probation_text, p_notice_period_text, public.app_user_id()
  )
  returning id into v_id;

  return public.letter_payload(v_id);
end;
$$;


-- The letterhead now comes from the tenant's own company record rather than the
-- single company_settings row, so each client's letters carry its own identity.
create or replace function public.letter_payload(p_letter_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', l.id,
    'letter_type', l.letter_type,
    'employee_name', e.full_name,
    'employee_code', e.employee_code,
    'employee_address', e.address,
    'designation_title', g.title,
    'department_name', d.name,
    'joining_date', e.joining_date,
    'reporting_manager_name', m.full_name,
    'annual_ctc', coalesce(l.annual_ctc_override, (select c.gross_pay * 12 from public.compute_payslip(e.id) c)),
    'probation_text', coalesce(l.probation_text, 'Six months from the date of joining'),
    'notice_period_text', coalesce(l.notice_period_text, 'Thirty days on either side after confirmation'),
    'custom_message', l.custom_message,
    'company_name', co.name,
    'company_address', co.address,
    'today', (now() at time zone 'utc')::date,
    'generated_at', l.generated_at
  )
  into v_result
  from generated_letters l
  join employees e on e.id = l.employee_id
  join companies co on co.id = l.company_id
  left join departments d on d.id = e.department_id
  left join designations g on g.id = e.designation_id
  left join employees m on m.id = e.reporting_manager_id
  where l.id = p_letter_id
    and l.company_id = public.app_company_id();

  return v_result;
end;
$$;



-- =============================================================================
-- Reports
--
-- These were the widest holes: every one aggregated across `employees` with no
-- company predicate, so an HR user at any tenant would have received the whole
-- platform's figures.
-- =============================================================================

create or replace function public.report_attendance(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_month integer := coalesce(p_month, extract(month from now() at time zone 'utc')::integer);
  v_company integer := public.app_company_id();
  v_start date;
  v_end date;
  v_days integer;
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := least((v_start + interval '1 month - 1 day')::date, (now() at time zone 'utc')::date);
  v_days := case when v_end >= v_start then (v_end - v_start) + 1 else 0 end;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'employee_id', e.id,
      'employee_name', e.full_name,
      'present_days', s.present,
      'absent_days', greatest(v_days - s.present - s.half_day - s.on_leave, 0),
      'half_days', s.half_day,
      'late_count', s.late_count
    ) as row
    from employees e
    cross join lateral (
      select
        count(*) filter (where a.status = 'present') as present,
        count(*) filter (where a.status = 'half_day') as half_day,
        count(*) filter (where a.status = 'on_leave') as on_leave,
        count(*) filter (where (a.check_in at time zone 'utc')::time > time '09:30') as late_count
      from attendance_records a
      where a.employee_id = e.id and a.date between v_start and v_end
        and a.company_id = v_company
    ) s
    where e.status = 'active' and e.company_id = v_company
    order by e.full_name
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_leaves(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'employee_id', b.employee_id,
      'employee_name', e.full_name,
      'leave_type_name', t.name,
      'allocated_days', b.allocated_days,
      'used_days', b.used_days,
      'remaining_days', b.allocated_days - b.used_days
    ) as row
    from leave_balances b
    join employees e on e.id = b.employee_id
    join leave_types t on t.id = b.leave_type_id
    where b.year = v_year and b.company_id = v_company
    order by e.full_name, t.name
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_employees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'department_name', coalesce(d.name, 'Unassigned'),
      'designation_title', coalesce(g.title, 'Unassigned'),
      'active_count', count(*) filter (where e.status = 'active'),
      'inactive_count', count(*) filter (where e.status <> 'active')
    ) as row
    from employees e
    left join departments d on d.id = e.department_id
    left join designations g on g.id = e.designation_id
    where e.company_id = v_company
    group by coalesce(d.name, 'Unassigned'), coalesce(g.title, 'Unassigned')
    order by 1
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'assignee_id', t.assigned_to,
      'assignee_name', coalesce(e.full_name, 'Unassigned'),
      'assigned', count(*) filter (where t.status = 'assigned'),
      'in_progress', count(*) filter (where t.status = 'in_progress'),
      'review', count(*) filter (where t.status = 'review'),
      'completed', count(*) filter (where t.status = 'completed')
    ) as row
    from tasks t
    left join employees e on e.id = t.assigned_to
    where t.company_id = v_company
    group by t.assigned_to, e.full_name
    order by coalesce(e.full_name, 'Unassigned')
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'priority', p.priority,
      'progress', p.progress,
      'member_count', (select count(*) from project_members m where m.project_id = p.id),
      'deadline', p.deadline
    ) as row
    from projects p
    where p.company_id = v_company
    order by p.created_at desc
  ) rows;

  return v_result;
end;
$$;





-- ###########################################################################
-- neon/migrations/0001_session_context.sql  (MUST BE LAST)
-- ###########################################################################

-- =============================================================================
-- Neon 0001 — Session context: the replacement for Supabase Auth
--
-- This is the linchpin of the whole re-platform. Everything else is mechanical;
-- this is the part that decides whether the security model survives the move.
--
-- THE PROBLEM
--
-- On Supabase, every RLS policy resolves the caller through auth.uid(), a
-- function GoTrue provides that reads the verified JWT out of the request. Neon
-- is Postgres and nothing else: there is no auth schema, no GoTrue, no
-- auth.uid(). Ported unchanged, every policy would evaluate to null and the
-- database would deny everything to everyone.
--
-- THE REPLACEMENT
--
-- The backend authenticates the request, then tells the database who is calling
-- by setting a transaction-local setting before running any query:
--
--     begin;
--     set local app.user_id    = '42';
--     set local app.company_id = '1';
--     -- ... the actual query, with RLS now able to see the caller ...
--     commit;
--
-- app_user_id() reads that setting instead of auth.uid(). Every policy and
-- every helper above it is then unchanged — which is the point. The isolation
-- model in 0012 keeps working line for line.
--
-- WHY `SET LOCAL` AND NOT `SET`
--
-- `set local` is scoped to the transaction and is discarded on commit or
-- rollback. Plain `set` persists for the whole session, and with a connection
-- pool a session is reused by the next request — so a plain `set` would leak
-- one user's identity into another user's query. That is a cross-tenant breach
-- with a very ordinary-looking cause, and it is the single easiest way to get
-- this migration wrong.
--
-- WHY THE APPLICATION MUST NOT CONNECT AS THE TABLE OWNER
--
-- Postgres exempts a table's owner from its own RLS unless FORCE ROW LEVEL
-- SECURITY is set. Connecting the app as the owner would silently disable every
-- policy in this database. The `hrms_app` role below is deliberately not the
-- owner, and the backend must use it — never the Neon default role, which is.
-- =============================================================================


-- ---------------------------------------------------------- application role
-- The role the backend connects as. It owns nothing, so RLS always applies.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hrms_app') then
    create role hrms_app nologin;
  end if;
end $$;

comment on role hrms_app is
  'The role the API server connects as. Deliberately owns no tables, so row level security is never bypassed.';

-- Every policy is declared `to authenticated`, carried over unchanged from
-- Supabase. A policy only applies to roles it names, so without this membership
-- hrms_app would match no policy at all — and a table with RLS enabled and no
-- applicable policy denies everything. The symptom would be an app that
-- authenticates fine and then shows empty screens everywhere.
grant authenticated to hrms_app;


-- ------------------------------------------------------------ session getters
-- The `true` second argument makes current_setting() return null instead of
-- raising when the setting is absent — an unauthenticated request must read as
-- "nobody", not as an error.

create or replace function public.app_user_id()
returns integer
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::integer
$$;

-- Read straight from the session rather than looked up from users, because the
-- backend has already resolved it while authenticating. One less query per
-- policy evaluation, and it is the value the request was authorised against.
create or replace function public.app_company_id()
returns integer
language sql
stable
as $$
  select nullif(current_setting('app.company_id', true), '')::integer
$$;

create or replace function public.app_employee_id()
returns integer
language sql
stable
as $$
  select e.id from employees e where e.user_id = public.app_user_id()
$$;

create or replace function public.app_role()
returns text
language sql
stable
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
as $$
  select public.app_role() = 'super_admin' and current_setting('app.company_id', true) is null
$$;

create or replace function public.app_is_hr()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin')
$$;

create or replace function public.app_is_founder()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin')
$$;

create or replace function public.app_manages_projects()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin', 'project_manager')
$$;

create or replace function public.app_manages_tasks()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('founder', 'company_admin', 'hr_admin', 'project_manager', 'team_lead')
$$;

create or replace function public.app_module_enabled(p_module text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from company_modules m
    where m.company_id = public.app_company_id()
      and m.module = p_module
      and m.is_enabled
  )
$$;


-- ------------------------------------------------------- the session profile
-- current_user_profile() also resolved the caller through auth.uid(), so it
-- needs the same treatment as the helpers above — without this it survives the
-- port still calling a function that does not exist, and sign-in returns null
-- for everybody.
--
-- The shape of the returned object is unchanged, because AuthContext.tsx reads
-- it field by field and the brief is explicit that the frontend does not change.
create or replace function public.current_user_profile()
returns jsonb
language sql
stable
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


-- ------------------------------------------------------------------- grants
-- SECURITY INVOKER, not DEFINER. On Supabase these helpers had to be DEFINER to
-- read users while its own policies were being evaluated; here they read a
-- session setting, so there is nothing to elevate for. Fewer privileged
-- functions is strictly better.
grant usage on schema public to hrms_app;
grant select, insert, update, delete on all tables in schema public to hrms_app;
grant usage, select on all sequences in schema public to hrms_app;
grant execute on all functions in schema public to hrms_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to hrms_app;
alter default privileges in schema public
  grant usage, select on sequences to hrms_app;


-- ------------------------------------------------------------- credentials
-- Supabase kept password hashes in auth.users, which does not exist here. They
-- move onto the app's own users table — this is the one schema change the
-- re-platform genuinely requires, and it is why authentication cannot be left
-- untouched as your brief hoped.
--
-- bcrypt via pgcrypto, matching what GoTrue produced, so existing hashes can be
-- copied across and every current password keeps working.
create extension if not exists pgcrypto;

alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists email_confirmed_at timestamptz;
alter table public.users add column if not exists last_sign_in_at timestamptz;

-- auth_id becomes vestigial: it pointed into auth.users, which is not here. It
-- is kept, nullable and without its foreign key, purely so rows can still be
-- matched back to the Supabase project during the data migration.
alter table public.users alter column auth_id drop not null;
comment on column public.users.auth_id is
  'Vestigial. Was a foreign key into Supabase auth.users; retained only to correlate rows during migration.';




-- ------------------------------------------------------------- verification
-- Table count. Expect 35: the original 28 plus the seven tenancy tables.
select count(*) as tables from pg_tables where schemaname = 'public';

-- No policy may still reference auth.uid(): each one that does is a policy that
-- can never match, and a screen that will silently show nothing.
select
  c.relname as table_name,
  p.polname as policy
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (pg_get_expr(p.polqual, p.polrelid) ilike '%auth.uid%'
       or pg_get_expr(p.polwithcheck, p.polrelid) ilike '%auth.uid%');

-- Nothing may still depend on the auth schema.
--
-- prokind = 'f' restricts this to ordinary functions. pg_proc also holds
-- aggregates and window functions, and pg_get_functiondef() raises on those
-- ("array_agg" is an aggregate function) rather than returning null — so
-- without the filter this check aborts instead of reporting.
select
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%auth.uid%';
