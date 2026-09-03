-- =============================================================================
-- 0008 — Payroll: privileges and row level security
--
-- Read 0002 first; this follows the same model. Two things make payroll stricter
-- than the rest of the app:
--
--   * Bank account numbers, PAN, Aadhaar and UAN are not withheld column by
--     column the way `employees` does it — the whole of company_bank_details and
--     employee_bank_details is kept away from `authenticated`, and the only way
--     in is a SECURITY DEFINER function in 0009. A payout account is a credential.
--   * Every payroll table is read-mostly from the client. Runs, items, approvals
--     and revisions are written exclusively by the workflow functions, so a
--     signed-in HR session cannot move a run to `approved` with a PATCH.
--
-- IMPORTANT: Supabase ships ALTER DEFAULT PRIVILEGES granting anon and
-- authenticated full DML on new tables in `public`. Every table 0007 created is
-- therefore world-writable the moment it exists. The blanket revoke below is
-- what closes that, and it has to come before anything else.
-- =============================================================================

-- ------------------------------------------------------- close the defaults
revoke all on tax_settings, payroll_settings, company_bank_details,
  employee_bank_details, salary_revisions, payroll_runs, payroll_items,
  payroll_approvals, notifications
from anon, authenticated;

revoke all on all sequences in schema public from anon;

alter table tax_settings           enable row level security;
alter table payroll_settings       enable row level security;
alter table company_bank_details   enable row level security;
alter table employee_bank_details  enable row level security;
alter table salary_revisions       enable row level security;
alter table payroll_runs           enable row level security;
alter table payroll_items          enable row level security;
alter table payroll_approvals      enable row level security;
alter table notifications          enable row level security;

-- Belt and braces: these tables hold payout instructions, so a policy gap must
-- not be survivable by owning the table. FORCE applies RLS to the owner too.
alter table company_bank_details   force row level security;
alter table employee_bank_details  force row level security;


-- =============================================================================
-- Role helpers
-- =============================================================================

-- accounts_manager is a payroll role only. It is deliberately absent from
-- app_is_hr(), which gates employees, leave, documents and recruitment across
-- the rest of the app — verifying a payroll run must not carry those with it.
create or replace function public.app_is_accounts()
returns boolean
language sql
stable
as $$ select public.app_role() = 'accounts_manager' $$;

-- Who may see payroll for everybody, as opposed to just their own line.
create or replace function public.app_can_view_payroll()
returns boolean
language sql
stable
as $$ select public.app_role() in ('founder', 'hr_admin', 'accounts_manager') $$;

-- Who may create a run, compute it and submit it for review.
create or replace function public.app_can_process_payroll()
returns boolean
language sql
stable
as $$ select public.app_role() in ('founder', 'hr_admin') $$;

-- Who may verify a submitted run. Founder is included so a company without an
-- accounts manager is not deadlocked at the verification step.
create or replace function public.app_can_verify_payroll()
returns boolean
language sql
stable
as $$ select public.app_role() in ('founder', 'accounts_manager') $$;

-- Approval and locking are the founder's alone, per the permission matrix.
create or replace function public.app_can_approve_payroll()
returns boolean
language sql
stable
as $$ select public.app_role() = 'founder' $$;


-- =============================================================================
-- Settings — readable by payroll roles, written by the founder
-- =============================================================================

grant select on tax_settings, payroll_settings to authenticated;

-- Everyone signed in may read the payroll calendar: an employee needs to know
-- the pay date. The rate tables are narrower.
create policy payroll_settings_read on payroll_settings
  for select to authenticated using (true);
create policy payroll_settings_write on payroll_settings
  for update to authenticated
  using ((select public.app_can_approve_payroll()))
  with check ((select public.app_can_approve_payroll()));

create policy tax_settings_read on tax_settings
  for select to authenticated using ((select public.app_can_view_payroll()));
create policy tax_settings_write on tax_settings
  for all to authenticated
  using ((select public.app_can_approve_payroll()))
  with check ((select public.app_can_approve_payroll()));

grant update on payroll_settings to authenticated;
grant insert, update on tax_settings to authenticated;


-- =============================================================================
-- Bank details — no table access at all
-- =============================================================================

-- No grant, and a policy that denies everyone. Both are deliberate: the grant
-- is what PostgREST checks, the policy is what protects the table if a later
-- migration re-grants it by accident. 0009's functions are SECURITY DEFINER and
-- run as the owner, so they are unaffected by either.
create policy company_bank_no_client_access on company_bank_details
  for all to authenticated using (false) with check (false);

create policy employee_bank_no_client_access on employee_bank_details
  for all to authenticated using (false) with check (false);


-- =============================================================================
-- Salary structures and revisions
-- =============================================================================

-- 0002 let HR write salary_structures directly. That cannot stand now that a
-- structure carries revision history: a direct UPDATE would rewrite the past
-- instead of superseding it. upsert_salary_structure() is the only writer.
drop policy if exists salary_structures_write on salary_structures;
revoke insert, update, delete on salary_structures from authenticated;

-- Replaces the 0002 read policy, which predates accounts_manager.
drop policy if exists salary_structures_read on salary_structures;
create policy salary_structures_read on salary_structures
  for select to authenticated
  using (
    employee_id = (select public.app_employee_id())
    or (select public.app_can_view_payroll())
  );

grant select on salary_revisions to authenticated;
create policy salary_revisions_read on salary_revisions
  for select to authenticated
  using (
    employee_id = (select public.app_employee_id())
    or (select public.app_can_view_payroll())
  );


-- =============================================================================
-- Payroll runs, items and approvals
-- =============================================================================

grant select on payroll_runs, payroll_items, payroll_approvals to authenticated;

-- A run is company-wide, so seeing one is a payroll-role privilege. An employee
-- learns about their pay through their item and their payslip, not the run.
create policy payroll_runs_read on payroll_runs
  for select to authenticated using ((select public.app_can_view_payroll()));

create policy payroll_items_read on payroll_items
  for select to authenticated
  using (
    employee_id = (select public.app_employee_id())
    or (select public.app_can_view_payroll())
  );

create policy payroll_approvals_read on payroll_approvals
  for select to authenticated using ((select public.app_can_view_payroll()));

-- No write policies and no write grants anywhere above: the state machine in
-- 0009 owns every transition. Spelled out rather than left implicit, because
-- "there is no policy" and "the policy was dropped" look identical later.


-- =============================================================================
-- Payslips
-- =============================================================================

-- 0002's read policy predates accounts_manager; payment status is theirs to see.
drop policy if exists payslips_read on payslips;
create policy payslips_read on payslips
  for select to authenticated
  using (
    employee_id = (select public.app_employee_id())
    or (select public.app_can_view_payroll())
  );


-- =============================================================================
-- Notifications
-- =============================================================================

grant select, update on notifications to authenticated;

create policy notifications_read on notifications
  for select to authenticated using (user_id = (select public.app_user_id()));

-- Marking your own notification read is the only client write. The WITH CHECK
-- repeats the USING clause so a row cannot be updated onto someone else.
create policy notifications_mark_read on notifications
  for update to authenticated
  using (user_id = (select public.app_user_id()))
  with check (user_id = (select public.app_user_id()));


-- =============================================================================
-- Employee-facing column exposure
-- =============================================================================

-- 0002 withheld PAN, Aadhaar and the bank columns from `employees` at grant
-- level. Those columns are now duplicated into employee_bank_details, which is
-- fully closed above — no further action needed here, but the two must stay in
-- step: re-granting either one re-opens the same data by another route.
