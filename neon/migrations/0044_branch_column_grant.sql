-- =============================================================================
-- Neon 0044 — Let hrms_app read employees.branch_id
--
-- SELECT on `employees` is granted column by column, not on the table: PAN,
-- Aadhaar and the bank columns are deliberately out of the application role's
-- reach, and it is the absence of a grant that keeps them there. 0043 added
-- branch_id without adding it to that list, so every query that so much as
-- joined on it failed with
--
--   permission denied for table employees
--
-- which reads like a broken policy and is really a missing column grant. The
-- attendance export hit it on its LEFT JOIN branches, and HR saw a 403 for a
-- report they are entitled to.
--
-- One column, named explicitly. `grant select on public.employees` would fix
-- the symptom and hand the role the bank details along with it.
-- =============================================================================

grant select (branch_id) on public.employees to hrms_app;

-- ------------------------------------------------------------- diagnostics
select count(*) filter (where column_name = 'branch_id') as branch_id_granted,
       count(*) as columns_readable
  from information_schema.column_privileges
 where table_name = 'employees' and grantee = 'hrms_app' and privilege_type = 'SELECT';
