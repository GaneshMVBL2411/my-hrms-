-- ---------------------------------------------------------------------------
-- Put the password policy where every caller meets it.
--
-- Two findings, both from trying each route rather than reading the code.
--
-- 1. The policy was enforced in exactly one place: the Express handler for
--    /auth/password, via validatePasswordStrength. Every other way of setting a
--    password went straight to the database, which asked only for 8 characters.
--    Tested by setting the password "password" — 8 characters, no capital, no
--    digit, and the most common password in every breach corpus — by each route:
--
--      set_employee_password        ACCEPTED   (HR resetting anyone)
--      change_own_password          ACCEPTED   (the API guards it; nothing else does)
--      create_employee_with_login   ACCEPTED   (so every new hire could get one)
--
--    An app-layer rule is a rule for one endpoint. This codebase's whole
--    approach is that rules belong in the database — that is why RLS decides
--    who sees what — and a password policy is no different.
--
-- 2. create_employee_with_login still hashed with gen_salt('bf'), no cost, so
--    new accounts were created at cost 6 while migration 0018 was raising
--    everyone else to 12. That migration updated two of the three functions and
--    missed this one, so the weakness was being reintroduced with every hire.
--
-- The rules deliberately match validatePasswordStrength exactly. Two layers
-- disagreeing about what is acceptable is worse than one, because the error a
-- user sees then depends on which door they came through.
-- ---------------------------------------------------------------------------

create or replace function public.assert_password_policy(p_password text)
returns void
language plpgsql
immutable
as $$
begin
  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters' using errcode = '22023';
  end if;
  if p_password !~ '[A-Z]' then
    raise exception 'Password must contain at least one uppercase letter' using errcode = '22023';
  end if;
  if p_password !~ '[a-z]' then
    raise exception 'Password must contain at least one lowercase letter' using errcode = '22023';
  end if;
  if p_password !~ '[0-9]' and p_password !~ '[^A-Za-z0-9]' then
    raise exception 'Password must contain at least one number or special character' using errcode = '22023';
  end if;
  -- A short denylist of the passwords that satisfy every composition rule and
  -- are still guessed first. Composition alone lets "Password1" through, which
  -- is the standard illustration of why composition alone is not enough.
  if lower(p_password) = any (array[
    'password1', 'password123', 'passw0rd', 'welcome1', 'welcome123',
    'qwerty123', 'admin123', 'letmein1', 'abcd1234', 'iloveyou1',
    'company123', 'changeme1', 'hrms1234', 'temp1234'
  ]) then
    raise exception 'That password is too easily guessed — choose another' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.assert_password_policy(text) from public;
grant execute on function public.assert_password_policy(text) to hrms_app;

-- ------------------------------------------------------- the three routes
-- Each is reproduced from its current definition with one line changed: the
-- bare length check becomes the shared policy call. Nothing else is touched.

create or replace function public.set_employee_password(p_employee_id integer, p_new_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company integer := public.app_company_id();
  v_user_id integer;
begin
  perform public.assert_password_policy(p_new_password);

  select e.user_id into v_user_id
    from employees e
   where e.id = p_employee_id and e.company_id = v_company;

  if v_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  if not public.app_is_hr() and v_user_id <> public.app_user_id() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  update users set password_hash = crypt(p_new_password, gen_salt('bf', 12)) where id = v_user_id;

  -- Worth its own action name: someone resetting another person's password is
  -- a different event from changing your own, and an auditor reviewing the log
  -- should not have to infer which happened.
  perform public.log_security_event('password.reset_by_admin', 'users', v_user_id, null);
end;
$function$;

create or replace function public.change_own_password(p_current_password text, p_new_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id integer := public.app_user_id();
  v_hash text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_current_password is null or length(p_current_password) = 0 then
    raise exception 'Current password is required' using errcode = '42501';
  end if;

  perform public.assert_password_policy(p_new_password);

  if p_current_password = p_new_password then
    raise exception 'New password must be different from current password' using errcode = '22023';
  end if;

  select password_hash into v_hash
    from public.users
   where id = v_user_id;

  if v_hash is null or v_hash <> crypt(p_current_password, v_hash) then
    perform public.log_security_event('password.change_failed', 'users', v_user_id, jsonb_build_object('reason', 'incorrect_password'), null, null, 'failure');
    raise exception 'Current password is incorrect' using errcode = '42501';
  end if;

  update public.users
     set password_hash = crypt(p_new_password, gen_salt('bf', 12)),
         password_changed_at = clock_timestamp(),
         token_version = coalesce(token_version, 1) + 1
   where id = v_user_id;

  perform public.log_security_event('password.changed', 'users', v_user_id, null, null, null, 'success');
end;
$function$;

-- Only two lines differ from the current definition: the policy call, and
-- gen_salt('bf') gaining its cost.
create or replace function public.create_employee_with_login(p_email text, p_password text, p_role text, p_employee jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  perform public.assert_password_policy(p_password);

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
  values (v_company, lower(p_email), v_role_id, crypt(p_password, gen_salt('bf', 12)), now())
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
$function$;
