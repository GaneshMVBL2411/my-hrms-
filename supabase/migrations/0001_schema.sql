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
  auth_id uuid unique references auth.users (id) on delete set null,
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
