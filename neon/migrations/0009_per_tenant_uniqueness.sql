-- =============================================================================
-- Neon 0009 — Make uniqueness per-tenant
--
-- A defect the tenancy migrations missed, and one that could only ever show up
-- when a second company was created:
--
--   duplicate key value violates unique constraint "departments_name_key"
--   Key (name)=(Engineering) already exists.
--
-- These constraints came from the single-company schema, where "department
-- names are unique" was obviously right. Under multi-tenancy it silently means
-- "no two companies may share a department name" — so the second client to want
-- an Engineering department cannot have one, and the failure looks like a bug
-- in onboarding rather than a schema decision made years earlier.
--
-- Each becomes unique WITHIN a company instead.
--
-- Deliberately left global:
--   users.email        — Supabase Auth required it, and the auth layer that
--                        replaced it still assumes one address is one person.
--   employees.user_id  — a user has at most one employee record, in any company.
--   primary keys.
-- =============================================================================

-- ------------------------------------------------------------- departments
alter table public.departments drop constraint if exists departments_name_key;
create unique index if not exists uq_departments_company_name
  on public.departments (company_id, name);

-- ------------------------------------------------------------ designations
alter table public.designations drop constraint if exists designations_title_key;
create unique index if not exists uq_designations_company_title
  on public.designations (company_id, title);

-- ------------------------------------------------------------- leave types
-- company_id is nullable here — null means a platform-wide default offered to
-- every tenant. NULLS NOT DISTINCT matters: without it Postgres treats each
-- null as unique, so nothing would stop two platform defaults both called
-- "Casual Leave".
alter table public.leave_types drop constraint if exists leave_types_name_key;
create unique index if not exists uq_leave_types_company_name
  on public.leave_types (company_id, name) nulls not distinct;

-- --------------------------------------------------------- employee codes
-- next_employee_code() already numbers per company and prefixes with the
-- company code, so WP-1001 and PRZ-1001 coexist. The index was still global,
-- which would have collided the moment two companies shared a code prefix.
drop index if exists public.ix_employees_employee_code;
create unique index if not exists uq_employees_company_code
  on public.employees (company_id, employee_code);

-- ---------------------------------------------------------------- assets
-- Serial numbers are unique to a manufacturer, not to the world, and two
-- companies can hold identical hardware.
alter table public.assets drop constraint if exists assets_serial_number_key;
create unique index if not exists uq_assets_company_serial
  on public.assets (company_id, serial_number);


-- ------------------------------------------------------------- diagnostics
-- Every unique index on a tenant-owned table should now name company_id. The
-- exceptions listed at the top of this file are expected here.
select
  c.relname as table_name,
  i.relname as index_name,
  pg_get_indexdef(x.indexrelid) ilike '%company_id%' as per_tenant
from pg_index x
join pg_class c on c.oid = x.indrelid
join pg_class i on i.oid = x.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and x.indisunique
  and not x.indisprimary
  and c.relname in ('departments', 'designations', 'leave_types', 'employees', 'assets')
order by per_tenant, c.relname;
