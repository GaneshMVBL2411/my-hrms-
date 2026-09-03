-- =============================================================================
-- Add Kalyani as an employee
--
-- Run this whole file in the Supabase SQL Editor, as the `postgres` role.
--
-- Why this is a file you paste rather than the app's "Add Employee" button:
-- creating a login needs the Auth admin API, which needs the service key, which
-- only the `admin-users` Edge Function holds. Until that function is deployed
-- (`supabase functions deploy admin-users`) the button returns
-- "Requested function was not found", and this is the way in.
--
-- Creates all four things a working employee needs:
--   1. the auth identity        — the credentials sign-in checks
--   2. public.users             — role and active flag
--   3. public.employees         — the profile, code, department, designation
--   4. leave balances + salary  — without these the Leaves and Payroll pages
--                                 render her as broken rather than as new
--
-- Idempotent: re-running reports what already exists and changes nothing.
-- The Edge Function creates the login and the profile in one transaction for
-- exactly one reason, and it applies here too — the SQL Editor runs this file
-- as a single transaction, so a failure at any step leaves no orphaned account.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  -- ----------------------------------------------------------------- details
  -- Note the domain: a personal gmail address, not the whhoohhpath.com the
  -- rest of the company uses.
  -- No login exists for this address, so the script creates one below. (The
  -- kalyani.aiwhhoohh@gmail.com login made in the dashboard is a separate
  -- account and is left untouched — see the note at the top of this file.)
  v_email      text := 'kalyani@whhoohh.com';
  v_password   text := encode(extensions.gen_random_bytes(16), 'base64');
  v_first      text := 'Kalyani';
  v_last       text := '';              -- '' if she goes by a single name
  v_role       text := 'employee';      -- founder | hr_admin | project_manager | team_lead | employee
  v_department text := 'Engineering';
  v_designation text := 'Software Engineer';
  v_joining    date := current_date;

  -- A flat structure, matching what every other employee is now on: the whole
  -- salary sits in `basic`, with no HRA, special allowance, PF or ESI. Not the
  -- 40% / 15% split seed.mjs used — that split was replaced across the board.
  v_basic      numeric(10, 2) := 25000;

  v_auth_id     uuid;
  v_employee_id integer;
  v_dept_id     integer;
  v_desig_id    integer;
  v_year        integer := extract(year from current_date);
  v_leave_rows  integer;
begin
  -- An address already in `users` means she has been added before. Stop rather
  -- than half-create a second profile against the same email.
  if exists (select 1 from public.users where lower(email) = lower(v_email)) then
    raise notice 'Skipped: % already has a profile. Nothing changed.', v_email;
    return;
  end if;

  select id into v_dept_id  from public.departments  where name  = v_department;
  select id into v_desig_id from public.designations where title = v_designation;

  if v_dept_id is null then
    raise exception 'No department named %. Check public.departments.', v_department;
  end if;
  if v_desig_id is null then
    raise exception 'No designation titled %. Check public.designations.', v_designation;
  end if;

  -- --------------------------------------------------------- 1. the login
  -- What auth.admin.createUser({email_confirm: true}) writes, by hand. GoTrue
  -- verifies encrypted_password as bcrypt, so crypt(..., bf) is what it expects.
  -- email_confirmed_at must be set: an unconfirmed address is refused at sign-in.
  select id into v_auth_id from auth.users where lower(email) = lower(v_email);

  if v_auth_id is null then
    v_auth_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_auth_id,
      'authenticated',
      'authenticated',
      lower(v_email),
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

    -- GoTrue expects a matching identity row for the email provider. Without it
    -- the password still verifies, but the account looks half-made in the
    -- dashboard and later provider linking misbehaves.
    --
    -- `provider_id` is the provider's own subject id, which for the email
    -- provider is the user's uuid — GoTrue reads it back out of
    -- identity_data->>'sub', so the two must agree. It is not the address; the
    -- address reaches the generated `email` column through identity_data.
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(),
      v_auth_id,
      jsonb_build_object('sub', v_auth_id::text, 'email', lower(v_email), 'email_verified', true),
      'email',
      v_auth_id::text,
      now(),
      now(),
      now()
    );

    raise notice 'Created the login for %', v_email;
  else
    raise notice 'A login already existed for %; reusing it.', v_email;
  end if;

  -- ------------------------------------------- 2 + 3. the user and employee
  -- The same function the Edge Function calls, so this employee is built
  -- identically to one added through the app: employee_code comes from
  -- next_employee_code(), and gender is left unset rather than guessed.
  v_employee_id := public.create_employee_profile(
    v_auth_id,
    lower(v_email),
    v_role,
    jsonb_build_object(
      'first_name',       v_first,
      'last_name',        v_last,
      'department_id',    v_dept_id,
      'designation_id',   v_desig_id,
      'joining_date',     v_joining,
      'experience_years', 0,
      'status',           'active'
    )
  );

  -- ------------------------------------------------ 4. leave and salary
  -- Every leave type at its annual default, for the current year — the Leaves
  -- page reads balances, not entitlements, so a missing row reads as zero days.
  insert into public.leave_balances (employee_id, leave_type_id, year, allocated_days, used_days)
  select v_employee_id, lt.id, v_year, lt.default_days_per_year, 0
  from public.leave_types lt
  on conflict (employee_id, leave_type_id, year) do nothing;

  get diagnostics v_leave_rows = row_count;

  insert into public.salary_structures (
    employee_id, basic, hra, special_allowance, pf_percent, esi_percent, effective_from
  )
  values (v_employee_id, v_basic, 0, 0, 0, 0, v_joining)
  on conflict (employee_id) do nothing;

  raise notice 'Added % as employee #% (% leave balances, salary structure on basic %)',
    v_first, v_employee_id, v_leave_rows, v_basic;
end $$;


-- ------------------------------------------------------------- diagnostics
-- Expect one row for Kalyani: confirmed, has_profile, is_active, with her
-- employee code, department and designation filled in. If has_login is true but
-- has_profile is false she cannot sign in — "This account is not active" is that
-- state, and link-auth-user.sql repairs it.
select
  au.email,
  au.email_confirmed_at is not null as confirmed,
  u.id is not null                  as has_profile,
  coalesce(u.is_active, false)      as is_active,
  r.name                            as role,
  e.employee_code,
  e.full_name,
  d.name                            as department,
  ds.title                          as designation,
  e.joining_date,
  e.status
from auth.users au
left join public.users u        on u.auth_id = au.id
left join public.roles r        on r.id = u.role_id
left join public.employees e    on e.user_id = u.id
left join public.departments d  on d.id = e.department_id
left join public.designations ds on ds.id = e.designation_id
order by e.employee_code nulls last;
