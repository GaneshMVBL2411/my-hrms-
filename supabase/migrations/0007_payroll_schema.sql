-- =============================================================================
-- 0007 — Payroll & company finance: schema
--
-- Extends the minimal payroll in 0001 (one salary row per employee, a flat
-- payslip) into a full run-based payroll: dated salary structures with revision
-- history, a per-period payroll run that moves through review/approval/lock,
-- one line item per employee per run, and the bank/tax/settings tables the run
-- reads from.
--
-- Structural changes to what 0001 created:
--   * salary_structures loses `unique (employee_id)` — an employee now has one
--     row per revision, and a partial unique index keeps exactly one `active`.
--     Anything that upserted on employee_id must call upsert_salary_structure()
--     instead (0009); PostgREST cannot ON CONFLICT against a partial index.
--   * payslips gains a link to the run item that produced it, plus payment
--     tracking. Existing rows keep working — payroll_item_id stays null and the
--     legacy summary columns are still authoritative for them.
--
-- Written to be re-runnable: this project has had to reset and re-apply its
-- schema more than once, and a migration that fails halfway through the second
-- attempt is worse than one that is slightly more verbose.
-- =============================================================================

-- ---------------------------------------------------------------- enum types
-- `create type` has no IF NOT EXISTS, so each is guarded individually rather
-- than wrapping the file in a transaction that would abort on the first repeat.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payroll_frequency_enum') then
    create type payroll_frequency_enum as enum ('monthly', 'biweekly', 'weekly');
  end if;

  if not exists (select 1 from pg_type where typname = 'payroll_run_status_enum') then
    -- The workflow in order. `cancelled` is terminal and reachable from any
    -- pre-`paid` state; `locked` is the point after which items are immutable.
    create type payroll_run_status_enum as enum (
      'draft', 'computed', 'hr_review', 'accounts_verified',
      'approved', 'locked', 'paid', 'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payroll_item_status_enum') then
    create type payroll_item_status_enum as enum ('pending', 'processed', 'on_hold', 'excluded');
  end if;

  if not exists (select 1 from pg_type where typname = 'payroll_approval_action_enum') then
    create type payroll_approval_action_enum as enum (
      'created', 'computed', 'submitted', 'accounts_verified',
      'approved', 'rejected', 'locked', 'reopened', 'paid', 'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status_enum') then
    create type payment_status_enum as enum ('unpaid', 'processing', 'paid', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'salary_structure_status_enum') then
    create type salary_structure_status_enum as enum (
      'draft', 'pending_approval', 'active', 'superseded', 'rejected'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'bank_verification_status_enum') then
    create type bank_verification_status_enum as enum ('pending', 'verified', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_type_enum') then
    create type notification_type_enum as enum (
      'payroll_generated', 'payslip_ready', 'salary_credited',
      'payroll_approval_pending', 'salary_revision', 'bank_details_status'
    );
  end if;
end $$;


-- =============================================================================
-- Settings — read by every calculation, so they come first
-- =============================================================================

-- Statutory rates, versioned by financial year. The payroll run snapshots the
-- row it used (payroll_runs.tax_settings_id) so re-opening an old run cannot
-- silently recalculate it against this year's rates.
create table if not exists tax_settings (
  id serial primary key,
  financial_year varchar(9) not null unique,          -- '2026-2027'

  pf_employee_percent numeric(5, 2) not null default 12,
  pf_employer_percent numeric(5, 2) not null default 12,
  -- EPF is capped at a basic of 15,000/month unless the employee opts out of
  -- the ceiling; `pf_restrict_to_ceiling` is that opt-out, per-company.
  pf_wage_ceiling numeric(10, 2) not null default 15000,
  pf_restrict_to_ceiling boolean not null default true,

  esi_employee_percent numeric(5, 2) not null default 0.75,
  esi_employer_percent numeric(5, 2) not null default 3.25,
  -- ESI stops applying once gross crosses this; it is a threshold, not a cap.
  esi_wage_ceiling numeric(10, 2) not null default 21000,

  professional_tax_monthly numeric(10, 2) not null default 200,
  professional_tax_threshold numeric(10, 2) not null default 15000,
  -- Karnataka bills PT at a different amount in February; kept configurable
  -- rather than hard-coded into the payroll function.
  professional_tax_february numeric(10, 2),

  income_tax_regime varchar(20) not null default 'new',
  standard_deduction numeric(10, 2) not null default 75000,
  default_tds_percent numeric(5, 2) not null default 0,

  effective_from date not null default current_date,
  is_active boolean not null default true,
  updated_by integer references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ck_tax_settings_percents check (
    pf_employee_percent between 0 and 100 and pf_employer_percent between 0 and 100
    and esi_employee_percent between 0 and 100 and esi_employer_percent between 0 and 100
    and default_tds_percent between 0 and 100
  )
);

-- Exactly one active rate set at a time; the run picks it up by that flag.
create unique index if not exists ux_tax_settings_active
  on tax_settings ((true)) where is_active;

-- How payroll behaves, as opposed to what it costs. Single row — the partial
-- unique index below is what enforces that.
create table if not exists payroll_settings (
  id serial primary key,
  frequency payroll_frequency_enum not null default 'monthly',
  currency varchar(3) not null default 'INR',
  timezone varchar(64) not null default 'Asia/Kolkata',

  working_days_per_week numeric(3, 1) not null default 5,
  -- LOP divisor. 'calendar' = days in month, 'working' = working days only,
  -- 'fixed' = the number in lop_fixed_days. The three answers give materially
  -- different per-day rates, so it is a setting rather than a convention.
  lop_basis varchar(10) not null default 'calendar',
  lop_fixed_days numeric(4, 1) not null default 30,

  -- Day of month. Attendance after the cutoff lands in the next run; the lock
  -- day is when the run stops accepting edits; payment day is the credit date.
  attendance_cutoff_day smallint not null default 25,
  payroll_lock_day smallint not null default 28,
  salary_payment_day smallint not null default 1,

  overtime_rate_multiplier numeric(4, 2) not null default 2,
  overtime_enabled boolean not null default true,

  -- Approval chain. Turning either off shortens the workflow; the transition
  -- functions in 0009 read these rather than assuming a fixed chain.
  require_accounts_verification boolean not null default true,
  require_founder_approval boolean not null default true,
  auto_generate_payslips boolean not null default true,
  notify_employees boolean not null default true,

  updated_by integer references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ck_payroll_settings_lop_basis check (lop_basis in ('calendar', 'working', 'fixed')),
  constraint ck_payroll_settings_days check (
    attendance_cutoff_day between 1 and 31
    and payroll_lock_day between 1 and 31
    and salary_payment_day between 1 and 31
  )
);

create unique index if not exists ux_payroll_settings_singleton
  on payroll_settings ((true));


-- =============================================================================
-- Banking
-- =============================================================================

-- The company's own accounts. Never readable by an employee — 0008 withholds
-- the table from `authenticated` entirely and hands it out through a function.
create table if not exists company_bank_details (
  id serial primary key,
  company_name varchar(200) not null,
  legal_name varchar(200),

  bank_name varchar(100) not null,
  account_holder_name varchar(200) not null,
  account_number varchar(30) not null,
  ifsc_code varchar(11) not null,
  branch_name varchar(150),
  swift_code varchar(11),
  upi_id varchar(100),

  gst_number varchar(15),
  pan_number varchar(10),
  tan_number varchar(10),
  pf_registration_number varchar(30),
  esi_registration_number varchar(30),

  authorized_signatory varchar(200),
  logo_url varchar(500),
  signature_url varchar(500),

  -- One account is the payout account; the rest are on file.
  is_primary boolean not null default false,
  status varchar(20) not null default 'active',
  verified_by integer references users (id) on delete set null,
  verified_at timestamptz,

  updated_by integer references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ck_company_bank_status check (status in ('active', 'inactive')),
  constraint ck_company_bank_ifsc check (ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint ck_company_bank_pan check (pan_number is null or pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  constraint ck_company_bank_gst check (
    gst_number is null or gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$'
  )
);

create unique index if not exists ux_company_bank_primary
  on company_bank_details (is_primary) where is_primary;

-- Employee payout accounts. An employee may submit a change, but a `pending`
-- row is never paid to — payroll only ever reads the `verified` primary row,
-- which is what makes the approval workflow load-bearing rather than cosmetic.
create table if not exists employee_bank_details (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,

  bank_name varchar(100) not null,
  account_holder_name varchar(200) not null,
  account_number varchar(30) not null,
  ifsc_code varchar(11) not null,
  branch varchar(150),
  upi_id varchar(100),

  pan_number varchar(10),
  aadhaar_number varchar(12),
  uan_number varchar(12),
  pf_number varchar(30),
  esi_number varchar(20),

  cancelled_cheque_url varchar(500),
  passbook_url varchar(500),

  is_primary boolean not null default false,
  status varchar(20) not null default 'active',
  verification_status bank_verification_status_enum not null default 'pending',
  submitted_by integer references users (id) on delete set null,
  verified_by integer references users (id) on delete set null,
  verified_at timestamptz,
  rejection_reason varchar(500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ck_employee_bank_status check (status in ('active', 'inactive')),
  constraint ck_employee_bank_ifsc check (ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint ck_employee_bank_pan check (pan_number is null or pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  constraint ck_employee_bank_aadhaar check (aadhaar_number is null or aadhaar_number ~ '^[0-9]{12}$'),
  constraint ck_employee_bank_uan check (uan_number is null or uan_number ~ '^[0-9]{12}$'),
  constraint ck_employee_bank_rejection check (
    verification_status <> 'rejected' or rejection_reason is not null
  )
);

create index if not exists ix_employee_bank_employee on employee_bank_details (employee_id);

-- One verified primary account per employee. Pending submissions sit alongside
-- it untouched until someone approves them.
create unique index if not exists ux_employee_bank_primary
  on employee_bank_details (employee_id) where is_primary and verification_status = 'verified';

-- Only one open request at a time, so an employee cannot queue five changes.
create unique index if not exists ux_employee_bank_one_pending
  on employee_bank_details (employee_id) where verification_status = 'pending';


-- =============================================================================
-- Salary structures — 0001's table, widened and given history
-- =============================================================================

-- ALTER COLUMN TYPE is refused outright while a view reads the column, so the
-- two 0003 views that select from salary_structures and payslips come down
-- first. 0009 rebuilds both, widened to match.
drop view if exists salary_structure_detail;
drop view if exists payslip_detail;

alter table salary_structures
  add column if not exists ctc                  numeric(14, 2),
  add column if not exists medical_allowance    numeric(12, 2) not null default 0,
  add column if not exists transport_allowance  numeric(12, 2) not null default 0,
  add column if not exists internet_allowance   numeric(12, 2) not null default 0,
  add column if not exists meal_allowance       numeric(12, 2) not null default 0,
  add column if not exists performance_bonus    numeric(12, 2) not null default 0,
  add column if not exists project_bonus        numeric(12, 2) not null default 0,
  add column if not exists other_allowance      numeric(12, 2) not null default 0,

  add column if not exists professional_tax     numeric(12, 2) not null default 0,
  add column if not exists income_tax           numeric(12, 2) not null default 0,
  add column if not exists loan_deduction       numeric(12, 2) not null default 0,
  add column if not exists advance_deduction    numeric(12, 2) not null default 0,
  add column if not exists other_deduction      numeric(12, 2) not null default 0,

  -- Denormalised so the structure list and the CTC reports do not have to
  -- re-derive them; upsert_salary_structure() is the only writer.
  add column if not exists gross_salary         numeric(14, 2) not null default 0,
  add column if not exists total_deductions     numeric(14, 2) not null default 0,
  add column if not exists net_salary           numeric(14, 2) not null default 0,

  add column if not exists effective_to         date,
  add column if not exists status               salary_structure_status_enum not null default 'active',
  add column if not exists revision_no          integer not null default 1,
  add column if not exists revision_reason      varchar(500),
  add column if not exists created_by           integer references users (id) on delete set null,
  add column if not exists approved_by          integer references users (id) on delete set null,
  add column if not exists approved_at          timestamptz,
  add column if not exists updated_at           timestamptz not null default now();

-- History means many rows per employee, so the 0001 uniqueness has to go. The
-- inline `unique` in 0001 produced the default constraint name.
alter table salary_structures drop constraint if exists salary_structures_employee_id_key;

-- ADD CONSTRAINT has no IF NOT EXISTS, so it is dropped first to stay re-runnable.
alter table salary_structures drop constraint if exists ck_salary_structure_period;
alter table salary_structures
  add constraint ck_salary_structure_period check (effective_to is null or effective_to >= effective_from);

-- Widen the 0001 money columns: numeric(10,2) tops out at 99,999,999.99, which
-- a CTC column will meet long before 1000 employees do.
alter table salary_structures
  alter column basic type numeric(12, 2),
  alter column hra type numeric(12, 2),
  alter column special_allowance type numeric(12, 2);

create unique index if not exists ux_salary_structure_active
  on salary_structures (employee_id) where status = 'active';
create index if not exists ix_salary_structure_employee_from
  on salary_structures (employee_id, effective_from desc);

-- Backfill the rows 0001/seed.mjs created: they predate every column above.
update salary_structures
set gross_salary = basic + hra + special_allowance,
    ctc = coalesce(ctc, (basic + hra + special_allowance) * 12)
where gross_salary = 0;

drop trigger if exists salary_structures_set_updated_at on salary_structures;
create trigger salary_structures_set_updated_at before update on salary_structures
  for each row execute function public.set_updated_at();


-- One row per approved change, so "what did this person earn in March, and who
-- signed it off" is a lookup rather than a reconstruction.
create table if not exists salary_revisions (
  id serial primary key,
  employee_id integer not null references employees (id) on delete cascade,
  previous_structure_id integer references salary_structures (id) on delete set null,
  new_structure_id integer not null references salary_structures (id) on delete cascade,

  previous_ctc numeric(14, 2),
  new_ctc numeric(14, 2),
  previous_gross numeric(14, 2),
  new_gross numeric(14, 2),
  change_amount numeric(14, 2) generated always as (coalesce(new_gross, 0) - coalesce(previous_gross, 0)) stored,
  -- Null rather than a division-by-zero when there is no previous salary.
  change_percent numeric(7, 2),

  reason varchar(500),
  effective_date date not null,
  status salary_structure_status_enum not null default 'active',
  requested_by integer references users (id) on delete set null,
  approved_by integer references users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ix_salary_revisions_employee
  on salary_revisions (employee_id, effective_date desc);


-- =============================================================================
-- Payroll runs
-- =============================================================================

create table if not exists payroll_runs (
  id serial primary key,
  run_no varchar(30) not null unique,                -- 'PR-2026-07'
  frequency payroll_frequency_enum not null default 'monthly',

  month smallint not null,
  year smallint not null,
  period_start date not null,
  period_end date not null,
  payment_date date,

  status payroll_run_status_enum not null default 'draft',
  working_days numeric(4, 1),
  -- Frozen at compute time; see the comment on tax_settings.
  tax_settings_id integer references tax_settings (id) on delete set null,

  total_employees integer not null default 0,
  total_gross numeric(16, 2) not null default 0,
  total_bonus numeric(16, 2) not null default 0,
  total_deductions numeric(16, 2) not null default 0,
  total_net numeric(16, 2) not null default 0,
  total_employer_cost numeric(16, 2) not null default 0,

  notes varchar(1000),
  rejection_reason varchar(500),

  created_by integer references users (id) on delete set null,
  computed_at timestamptz,
  submitted_by integer references users (id) on delete set null,
  submitted_at timestamptz,
  accounts_verified_by integer references users (id) on delete set null,
  accounts_verified_at timestamptz,
  approved_by integer references users (id) on delete set null,
  approved_at timestamptz,
  locked_by integer references users (id) on delete set null,
  locked_at timestamptz,
  paid_at timestamptz,
  payment_reference varchar(100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ck_payroll_run_month check (month between 1 and 12),
  constraint ck_payroll_run_year check (year between 2000 and 2100),
  constraint ck_payroll_run_period check (period_end >= period_start)
);

-- Monthly payroll is one run per month; biweekly/weekly are distinguished by
-- their period, so the guard is scoped to the monthly case.
create unique index if not exists ux_payroll_run_monthly
  on payroll_runs (year, month) where frequency = 'monthly';
create unique index if not exists ux_payroll_run_period
  on payroll_runs (frequency, period_start, period_end);
create index if not exists ix_payroll_runs_status on payroll_runs (status, year desc, month desc);

drop trigger if exists payroll_runs_set_updated_at on payroll_runs;
create trigger payroll_runs_set_updated_at before update on payroll_runs
  for each row execute function public.set_updated_at();


-- One line per employee per run. Every component is stored rather than
-- recomputed: a payslip issued in July must still read the same in December
-- even if the salary structure or the statutory rates have moved since.
create table if not exists payroll_items (
  id serial primary key,
  payroll_run_id integer not null references payroll_runs (id) on delete cascade,
  employee_id integer not null references employees (id) on delete cascade,
  salary_structure_id integer references salary_structures (id) on delete set null,

  -- Attendance inputs
  payable_days numeric(5, 2) not null default 0,
  present_days numeric(5, 2) not null default 0,
  paid_leave_days numeric(5, 2) not null default 0,
  lop_days numeric(5, 2) not null default 0,
  overtime_hours numeric(6, 2) not null default 0,

  -- Earnings
  basic numeric(12, 2) not null default 0,
  hra numeric(12, 2) not null default 0,
  special_allowance numeric(12, 2) not null default 0,
  medical_allowance numeric(12, 2) not null default 0,
  transport_allowance numeric(12, 2) not null default 0,
  internet_allowance numeric(12, 2) not null default 0,
  meal_allowance numeric(12, 2) not null default 0,
  performance_bonus numeric(12, 2) not null default 0,
  project_bonus numeric(12, 2) not null default 0,
  other_allowance numeric(12, 2) not null default 0,
  overtime_amount numeric(12, 2) not null default 0,
  arrears numeric(12, 2) not null default 0,
  gross_earnings numeric(14, 2) not null default 0,

  -- Deductions
  pf_deduction numeric(12, 2) not null default 0,
  esi_deduction numeric(12, 2) not null default 0,
  professional_tax numeric(12, 2) not null default 0,
  income_tax numeric(12, 2) not null default 0,
  loan_deduction numeric(12, 2) not null default 0,
  advance_deduction numeric(12, 2) not null default 0,
  lop_deduction numeric(12, 2) not null default 0,
  other_deduction numeric(12, 2) not null default 0,
  total_deductions numeric(14, 2) not null default 0,

  -- Employer-side contributions: not withheld from the employee, but they are
  -- what makes the run's cost differ from the sum of its net pay.
  employer_pf numeric(12, 2) not null default 0,
  employer_esi numeric(12, 2) not null default 0,

  net_pay numeric(14, 2) not null default 0,

  -- Bank snapshot, taken when the run is computed. The payment file must not
  -- change because someone edited their account after approval.
  bank_name varchar(100),
  bank_account_number varchar(30),
  bank_ifsc varchar(11),
  bank_details_id integer references employee_bank_details (id) on delete set null,

  status payroll_item_status_enum not null default 'pending',
  hold_reason varchar(500),
  remarks varchar(500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_payroll_item_run_employee unique (payroll_run_id, employee_id)
);

create index if not exists ix_payroll_items_employee on payroll_items (employee_id);
create index if not exists ix_payroll_items_run_status on payroll_items (payroll_run_id, status);

drop trigger if exists payroll_items_set_updated_at on payroll_items;
create trigger payroll_items_set_updated_at before update on payroll_items
  for each row execute function public.set_updated_at();


-- Append-only trail of every workflow transition. audit_logs records that
-- something happened across the app; this records who moved *this run* to
-- *this state* and what they said about it, which is what an auditor asks for.
create table if not exists payroll_approvals (
  id serial primary key,
  payroll_run_id integer not null references payroll_runs (id) on delete cascade,
  action payroll_approval_action_enum not null,
  from_status payroll_run_status_enum,
  to_status payroll_run_status_enum,
  actor_user_id integer references users (id) on delete set null,
  -- Denormalised: the actor's role at the time. Roles change; history must not.
  actor_role varchar(50),
  comments varchar(1000),
  created_at timestamptz not null default now()
);

create index if not exists ix_payroll_approvals_run
  on payroll_approvals (payroll_run_id, created_at desc);


-- =============================================================================
-- Payslips — 0001's table, linked to the run and given payment tracking
-- =============================================================================

alter table payslips
  add column if not exists payroll_item_id integer references payroll_items (id) on delete set null,
  add column if not exists payroll_run_id integer references payroll_runs (id) on delete set null,
  add column if not exists payslip_no varchar(40),
  add column if not exists payment_status payment_status_enum not null default 'unpaid',
  add column if not exists payment_date date,
  add column if not exists payment_reference varchar(100),
  add column if not exists emailed_at timestamptz,
  -- Opaque token behind the payslip QR code, so a printed payslip can be
  -- checked for authenticity without exposing the row id.
  add column if not exists verification_code uuid not null default gen_random_uuid();

alter table payslips
  alter column basic type numeric(12, 2),
  alter column hra type numeric(12, 2),
  alter column special_allowance type numeric(12, 2),
  alter column gross_pay type numeric(14, 2),
  alter column pf_deduction type numeric(12, 2),
  alter column esi_deduction type numeric(12, 2),
  alter column professional_tax type numeric(12, 2),
  alter column net_pay type numeric(14, 2);

create unique index if not exists ux_payslips_no on payslips (payslip_no) where payslip_no is not null;
create unique index if not exists ux_payslips_verification on payslips (verification_code);
create index if not exists ix_payslips_run on payslips (payroll_run_id);

-- Backfill an identifier for the payslips that already exist.
update payslips
set payslip_no = 'PS-' || year || '-' || lpad(month::text, 2, '0') || '-' || lpad(employee_id::text, 4, '0')
where payslip_no is null;


-- =============================================================================
-- Notifications
-- =============================================================================

-- The workflow ends in "Employee Notification", which needs somewhere to land.
-- Delivery (email, push) is a later phase reading unsent rows; this is the
-- record, not the transport.
create table if not exists notifications (
  id serial primary key,
  user_id integer not null references users (id) on delete cascade,
  type notification_type_enum not null,
  title varchar(200) not null,
  body varchar(1000),
  -- What it points at, so the UI can deep-link without a type-specific column.
  entity varchar(50),
  entity_id integer,
  is_read boolean not null default false,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ix_notifications_user_unread
  on notifications (user_id, created_at desc) where not is_read;


-- =============================================================================
-- Reference data
-- =============================================================================

-- The spec's fourth payroll role. Deliberately not folded into app_is_hr():
-- accounts verifies payroll and reads bank details, and must not thereby gain
-- the employee/leave/document powers that helper grants across the rest of the app.
insert into roles (name, description) values
  ('accounts_manager', 'Verifies payroll and company bank details, issues payment reports')
on conflict (name) do nothing;

insert into permissions (code) values
  ('payroll.process'),
  ('payroll.verify'),
  ('payroll.approve'),
  ('payroll.lock'),
  ('payroll.view_all'),
  ('bank.company.manage'),
  ('bank.employee.manage')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('founder',          'payroll.process'),
  ('founder',          'payroll.verify'),
  ('founder',          'payroll.approve'),
  ('founder',          'payroll.lock'),
  ('founder',          'payroll.view_all'),
  ('founder',          'bank.company.manage'),
  ('founder',          'bank.employee.manage'),
  ('hr_admin',         'payroll.process'),
  ('hr_admin',         'payroll.view_all'),
  ('hr_admin',         'bank.company.manage'),
  ('hr_admin',         'bank.employee.manage'),
  ('accounts_manager', 'payroll.verify'),
  ('accounts_manager', 'payroll.view_all')
) as m(role_name, permission_code)
join roles r on r.name = m.role_name
join permissions p on p.code = m.permission_code
on conflict do nothing;

-- Seed the settings singletons so the first payroll run has rates to read.
insert into tax_settings (financial_year, effective_from)
select '2026-2027', date '2026-04-01'
where not exists (select 1 from tax_settings);

insert into payroll_settings (frequency)
select 'monthly'
where not exists (select 1 from payroll_settings);

-- Carry the bank columns 0001 put on `employees` into the new table, so nobody
-- has to re-enter what is already on file. Marked verified because it was
-- HR-entered under the old model; anything added from now on starts pending.
insert into employee_bank_details (
  employee_id, bank_name, account_holder_name, account_number, ifsc_code,
  pan_number, aadhaar_number, is_primary, verification_status, verified_at
)
select
  e.id, e.bank_name, e.full_name, e.bank_account_number, upper(e.bank_ifsc),
  e.pan_number, e.aadhaar_number, true, 'verified', now()
from employees e
where e.bank_account_number is not null
  and e.bank_ifsc is not null
  and e.bank_name is not null
  and upper(e.bank_ifsc) ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
  and not exists (select 1 from employee_bank_details b where b.employee_id = e.id);
