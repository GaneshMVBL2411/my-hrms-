-- =============================================================================
-- Give Kalyani an employee record
--
-- Run this whole file in the Supabase SQL Editor, as the `postgres` role.
--
-- Her login already exists — it was created under Authentication -> Users, which
-- writes to `auth.users` and nothing else. Signing in needs both halves: the auth
-- identity (credentials) and the app's own rows (role, employee record). She has
-- the first and not the second, which is why the HRMS employee list does not show
-- her and why signing in as her would report "This account is not active".
--
-- This adds the missing half and links it to that existing login, so no second
-- account is created. The uuid below is her UID from Authentication -> Users.
--
-- Safe to re-run: create_employee_profile raises if the email already has a
-- profile, so a second run fails loudly rather than making a duplicate.
-- =============================================================================

do $$
declare
  v_auth  uuid    := '4517abad-a359-4007-8624-5a4b70112f92';
  v_email text    := 'kalyani.aiwhhoohh@gmail.com';
  v_emp   integer;
  v_leave integer;
begin
  -- department_id 1 = Engineering, designation_id 2 = Software Engineer.
  -- employee_code is assigned by next_employee_code(), giving WP-1007.
  v_emp := public.create_employee_profile(v_auth, v_email, 'employee',
    jsonb_build_object(
      'first_name',       'Kalyani',
      'last_name',        '',
      'department_id',    1,
      'designation_id',   2,
      'joining_date',     current_date,
      'experience_years', 0,
      'status',           'active'));

  -- Every leave type at its annual default. Without these the Leaves page reads
  -- her entitlement as zero days rather than as unallocated.
  insert into public.leave_balances (employee_id, leave_type_id, year, allocated_days, used_days)
  select v_emp, id, extract(year from current_date), default_days_per_year, 0
  from public.leave_types;
  get diagnostics v_leave = row_count;

  -- Flat structure, matching every other employee: the whole salary in `basic`,
  -- no HRA, special allowance, PF or ESI.
  insert into public.salary_structures (
    employee_id, basic, hra, special_allowance, pf_percent, esi_percent, effective_from)
  values (v_emp, 25000, 0, 0, 0, 0, current_date);

  raise notice 'Kalyani added as employee #% (% leave balances, basic 25000)', v_emp, v_leave;
end $$;


-- ------------------------------------------------------------- diagnostics
-- Expect seven rows, Kalyani among them as WP-1007, confirmed and active.
select
  e.employee_code,
  e.full_name,
  u.email,
  r.name                       as role,
  coalesce(u.is_active, false) as is_active,
  au.email_confirmed_at is not null as can_sign_in,
  s.basic
from public.employees e
join public.users u        on u.id = e.user_id
join public.roles r        on r.id = u.role_id
left join auth.users au    on au.id = u.auth_id
left join public.salary_structures s on s.employee_id = e.id
order by e.employee_code;
