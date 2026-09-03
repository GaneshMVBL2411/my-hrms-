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


-- ------------------------------------------------------------- diagnostics
-- Expect: the platform tables present, and company_id on 25 tables, all still
-- nullable and all still empty. Nothing is assigned to a company until 0011.
select
  c.relname                                as table_name,
  a.attnum is not null                     as has_company_id,
  not a.attnotnull                         as still_nullable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_attribute a
  on a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public'
  and c.relkind = 'r'
  and a.attnum is not null
order by c.relname;
