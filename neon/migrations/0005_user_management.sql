-- =============================================================================
-- Neon 0005 — Creating logins and setting passwords
--
-- Replaces the `admin-users` Edge Function. On Supabase it needed the service
-- key because creating a login meant calling the Auth admin API; here the
-- credential is a column on `users`, so the same work is a SECURITY DEFINER
-- function — but the reasoning is unchanged. Writing a password hash must not
-- be something a browser session can do directly, so `users.password_hash` is
-- never written through RLS by the client.
--
-- Each function re-checks the caller's role itself. That is not belt-and-braces:
-- SECURITY DEFINER bypasses row level security, so a function that skipped the
-- check would let any signed-in employee create an administrator.
-- =============================================================================

-- Anyone may change their own password, and must prove the current one first.
-- A live session is not treated as permission to replace the credential that
-- created it — a borrowed laptop should not be enough to lock the owner out.
create or replace function public.set_own_password(p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer := public.app_user_id();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  update users
     set password_hash = crypt(p_new_password, gen_salt('bf'))
   where id = v_user_id;
end;
$$;


-- HR resets anyone's password in their own company; everyone else only their
-- own. Mirrors what the Edge Function enforced.
create or replace function public.set_employee_password(p_employee_id integer, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer;
  v_company integer := public.app_company_id();
begin
  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  select e.user_id into v_user_id
    from employees e
   where e.id = p_employee_id and e.company_id = v_company;

  if v_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  if not public.app_is_hr() and v_user_id <> public.app_user_id() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  update users set password_hash = crypt(p_new_password, gen_salt('bf')) where id = v_user_id;
end;
$$;


-- Creates the login and the employee record together, in one transaction.
--
-- The company comes from the caller's session, never from an argument. That is
-- the whole reason this cannot be an ordinary insert from the client: a browser
-- that could name the company could create an employee inside someone else's.
create or replace function public.create_employee_with_login(
  p_email text,
  p_password text,
  p_role text,
  p_employee jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_role_id integer;
  v_user_id integer;
  v_employee_id integer;
  v_limit integer;
  v_count integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if v_company is null then
    raise exception 'No company in this session';
  end if;
  if length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  -- A company admin must not be able to mint a platform administrator and so
  -- escape their own tenant.
  if p_role = 'super_admin' then
    raise exception 'super_admin cannot be assigned from within a company' using errcode = '42501';
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  if exists (select 1 from users where lower(email) = lower(p_email)) then
    raise exception 'An account with email % already exists', p_email;
  end if;

  -- The subscription's headcount ceiling, enforced where the row is created
  -- rather than in the screen that asked for it.
  select employee_limit into v_limit from companies where id = v_company;
  if v_limit is not null then
    select count(*) into v_count from employees where company_id = v_company;
    if v_count >= v_limit then
      raise exception 'This company has reached its limit of % employees', v_limit;
    end if;
  end if;

  insert into users (company_id, email, role_id, password_hash, email_confirmed_at)
  values (v_company, lower(p_email), v_role_id, crypt(p_password, gen_salt('bf')), now())
  returning id into v_user_id;

  insert into employees (
    company_id, user_id, employee_code, first_name, last_name, phone, address, dob, gender,
    department_id, designation_id, reporting_manager_id, joining_date, skills,
    experience_years, pan_number, aadhaar_number, bank_account_number, bank_ifsc,
    bank_name, status
  )
  values (
    v_company, v_user_id, public.next_employee_code(v_company),
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

  -- Every leave type available to this company, at its annual default.
  insert into leave_balances (company_id, employee_id, leave_type_id, year, allocated_days, used_days)
  select v_company, v_employee_id, lt.id, extract(year from current_date), lt.default_days_per_year, 0
  from leave_types lt
  where lt.company_id is null or lt.company_id = v_company;

  return v_employee_id;
end;
$$;

grant execute on function public.set_own_password(text)                          to hrms_app;
grant execute on function public.set_employee_password(integer, text)            to hrms_app;
grant execute on function public.create_employee_with_login(text, text, text, jsonb) to hrms_app;


-- ------------------------------------------------------------- diagnostics
select p.proname, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('set_own_password', 'set_employee_password', 'create_employee_with_login')
order by p.proname;
