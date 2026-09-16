-- =============================================================================
-- Neon 0043 — Branches: one company, several offices
--
-- A company keeps one legal identity — one PAN, one letterhead, one payroll —
-- and works out of more than one place. Bengaluru, Hyderabad, a client site.
-- Attendance is where that matters most: who is posted where, which office
-- observes which festival, and what each office's month came to.
--
-- So a branch is a place, not a tenant. It carries an address and nothing
-- else that a payslip or a letter would need, because those stay the
-- company's. `employees.branch_id` is nullable throughout: a company that
-- never adds a branch sees no change anywhere, and an employee who has not
-- been posted yet is simply unposted rather than wrong.
--
-- Holidays gain a branch too, for the case that prompted this: a regional
-- festival is a working day at the other office. A null branch there means
-- the whole company, which is what every existing holiday becomes.
-- =============================================================================

create table if not exists public.branches (
  id          serial primary key,
  company_id  integer not null references public.companies (id) on delete cascade,
  name        varchar(120) not null,
  -- Short form for the attendance sheet, where the column is narrow: BLR, HYD.
  code        varchar(20),
  address     varchar(500),
  city        varchar(100),
  state       varchar(100),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists ix_branches_company_name
  on public.branches (company_id, lower(name));
create index if not exists ix_branches_company on public.branches (company_id);

alter table public.employees       add column if not exists branch_id integer references public.branches (id) on delete set null;
alter table public.company_events  add column if not exists branch_id integer references public.branches (id) on delete cascade;

create index if not exists ix_employees_branch      on public.employees (branch_id);
create index if not exists ix_company_events_branch on public.company_events (branch_id);

alter table public.branches enable row level security;

drop policy if exists branches_read  on public.branches;
drop policy if exists branches_write on public.branches;

-- Everyone at the company can read them: an employee's own record names a
-- branch, and a name is no use if the reader cannot resolve it.
create policy branches_read on public.branches
  for select to authenticated
  using (company_id = (select public.app_company_id()));

-- Creating and closing offices is an HR act, like a department.
create policy branches_write on public.branches
  for all to authenticated
  using (company_id = (select public.app_company_id()) and (select public.app_is_hr()))
  with check (company_id = (select public.app_company_id()) and (select public.app_is_hr()));

grant select, insert, update, delete on public.branches to hrms_app;
grant usage, select on sequence public.branches_id_seq to hrms_app;

-- The directory carries the branch so the employee list and the attendance
-- export can show and filter on it without a second query.
--
-- Reproduced from the live definition with only the branch columns and their
-- join added, for two reasons. The CASE expressions around phone, address,
-- dob and gender are what keep a colleague's personal details out of the
-- directory, and retyping this view from memory is how they get lost. And the
-- new columns go at the end: `create or replace view` may append columns and
-- nothing else, so putting them next to designation_title fails outright.
create or replace view public.employee_directory with (security_invoker = on) as
SELECT e.id,
    e.employee_code,
    e.full_name,
    u.email,
        CASE
            WHEN e.user_id = app_user_id() OR app_is_hr() THEN e.phone
            ELSE NULL::character varying
        END::character varying(20) AS phone,
        CASE
            WHEN e.user_id = app_user_id() OR app_is_hr() THEN e.address
            ELSE NULL::character varying
        END::character varying(500) AS address,
    e.photo_url,
    e.department_id,
    d.name AS department_name,
    e.designation_id,
    g.title AS designation_title,
    e.status,
    e.joining_date,
    e.first_name,
    e.last_name,
        CASE
            WHEN e.user_id = app_user_id() OR app_is_hr() THEN e.dob
            ELSE NULL::date
        END AS dob,
        CASE
            WHEN e.user_id = app_user_id() OR app_is_hr() THEN e.gender
            ELSE NULL::gender_enum
        END AS gender,
    e.reporting_manager_id,
    m.full_name AS reporting_manager_name,
    e.skills,
    e.experience_years,
    e.created_at,
    e.branch_id,
    b.name AS branch_name,
    b.code AS branch_code
   FROM employees e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN designations g ON g.id = e.designation_id
     LEFT JOIN branches b ON b.id = e.branch_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id;

grant select on public.employee_directory to hrms_app;

-- ------------------------------------------------------------- diagnostics
select (select count(*) from public.branches) as branches,
       (select count(*) from information_schema.columns
         where table_name = 'employees' and column_name = 'branch_id') as employee_branch_column;
