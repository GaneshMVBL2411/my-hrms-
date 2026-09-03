-- =============================================================================
-- 0013 — Multi-tenancy: SECURITY DEFINER functions
--
-- The most dangerous file in the tenancy set. Every function here runs as its
-- owner and therefore BYPASSES ROW LEVEL SECURITY ENTIRELY — the policies in
-- 0012 do not apply inside them. A function that forgets its tenant check is a
-- complete cross-tenant breach that no policy will catch.
--
-- Two rules, applied to every function below:
--
--   READS   filter by public.app_company_id()
--   WRITES  stamp company_id from public.app_company_id(), never from an
--           argument — an argument is something the browser chose
--
-- Requires 0010, 0011 and 0012.
--
-- ---------------------------------------------------------------------------
-- COVERAGE — READ THIS BEFORE RELYING ON THIS FILE
--
-- Scoped here (19):
--   current_user_profile, user_display_name, get_employee_detail,
--   create_employee_profile, deactivate_employee, set_employee_role,
--   attendance_check_in, attendance_summary,
--   apply_leave, decide_leave_request,
--   compute_payslip, generate_payslip,
--   generate_letter, letter_payload,
--   report_attendance, report_leaves, report_employees, report_tasks,
--   report_projects
--
-- STILL UNSCOPED — a follow-up 0013b must cover these before any second
-- company is onboarded. Each is a live cross-tenant hole until then:
--   generate_payslips_bulk, payroll_summary, get_letter_view, get_calendar,
--   update_task, assign_asset, return_asset, upsert_company_settings
--
-- Trigger functions needing no change, because they act only on the row being
-- modified and inherit its tenant:
--   bump_policy_version, advance_candidate_on_interview
-- ---------------------------------------------------------------------------
-- =============================================================================

begin;

-- =============================================================================
-- Session and identity
-- =============================================================================

-- The frontend's whole picture of who is signed in. Gains the tenant, so the
-- client can brand itself and build its sidebar, and an explicit super-admin
-- flag so it knows to show the platform console instead of an HRMS.
--
-- `modules` drives the sidebar. It is advisory only — 0012 enforces the same
-- list in the policies, so hiding a link is presentation, not protection.
create or replace function public.current_user_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'role', r.name,
    'full_name', coalesce(e.full_name, u.email),
    'employee_id', e.id,
    'photo_url', e.photo_url,
    'company_id', u.company_id,
    'company_name', c.name,
    'company_code', c.code,
    'company_logo_url', c.logo_url,
    'is_super_admin', (u.company_id is null and r.name = 'super_admin'),
    'modules', coalesce(
      (select jsonb_agg(m.module order by m.module)
       from company_modules m
       where m.company_id = u.company_id and m.is_enabled),
      '[]'::jsonb
    ),
    -- Set only while a support session is open, so the client can show the
    -- "you are inside a customer's account" banner.
    'support_company_id', (
      select s.company_id from support_sessions s
      where s.super_admin_user_id = u.id and s.ended_at is null
      order by s.started_at desc limit 1
    )
  )
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  left join companies c on c.id = u.company_id
  where u.auth_id = auth.uid() and u.is_active
$$;


-- Resolves a user's display name for the views. Scoped so a name cannot be
-- probed by iterating ids across tenants.
create or replace function public.user_display_name(p_user_id integer)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(e.full_name, u.email)
  from users u
  left join employees e on e.user_id = u.id
  where u.id = p_user_id
    and u.company_id = public.app_company_id()
$$;


-- Hands out PAN / Aadhaar / bank details, so the tenant check matters twice
-- over: wrong company must not merely be filtered, it must not resolve at all.
create or replace function public.get_employee_detail(p_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_privileged boolean;
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_privileged := public.app_is_hr() or p_id = public.app_employee_id();

  select to_jsonb(d) || jsonb_build_object(
    'skills',              to_jsonb(coalesce(d.skills, '{}'::varchar[])),
    'pan_number',          case when v_privileged then e.pan_number end,
    'aadhaar_number',      case when v_privileged then e.aadhaar_number end,
    'bank_account_number', case when v_privileged then e.bank_account_number end,
    'bank_ifsc',           case when v_privileged then e.bank_ifsc end,
    'bank_name',           case when v_privileged then e.bank_name end,
    'role',                r.name
  )
  into v_result
  from employee_directory d
  join employees e on e.id = d.id
  join users u on u.id = e.user_id
  join roles r on r.id = u.role_id
  where d.id = p_id
    and e.company_id = public.app_company_id();

  -- Same error for "does not exist" and "belongs to another company": the
  -- distinction would itself leak whether an id is in use elsewhere.
  if v_result is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;


-- =============================================================================
-- Employees
-- =============================================================================

-- Called by the admin-users Edge Function with the service key, immediately
-- after the auth identity is created.
--
-- p_company_id is a new, REQUIRED argument. It is not derived from
-- app_company_id() because the caller is service_role, which has no session and
-- therefore no company — the Edge Function is responsible for passing the
-- company it has already authorised the caller against.
create or replace function public.create_employee_profile(
  p_auth_id uuid,
  p_email text,
  p_role text,
  p_employee jsonb,
  p_company_id integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
  v_user_id integer;
  v_employee_id integer;
  v_limit integer;
  v_count integer;
begin
  if p_company_id is null then
    raise exception 'A company is required to create an employee';
  end if;
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Unknown company: %', p_company_id;
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  -- Email is globally unique in auth.users, so it is checked globally here too
  -- rather than per company. See 0011's notes on that decision.
  if exists (select 1 from users where lower(email) = lower(p_email)) then
    raise exception 'An account with email % already exists', p_email;
  end if;

  -- The subscription's headcount ceiling, enforced where the row is created
  -- rather than in the UI that requested it.
  select employee_limit into v_limit from companies where id = p_company_id;
  if v_limit is not null then
    select count(*) into v_count from employees where company_id = p_company_id;
    if v_count >= v_limit then
      raise exception 'This company has reached its limit of % employees', v_limit;
    end if;
  end if;

  insert into users (company_id, auth_id, email, role_id)
  values (p_company_id, p_auth_id, p_email, v_role_id)
  returning id into v_user_id;

  insert into employees (
    company_id, user_id, employee_code, first_name, last_name, phone, address, dob, gender,
    department_id, designation_id, reporting_manager_id, joining_date, skills,
    experience_years, pan_number, aadhaar_number, bank_account_number, bank_ifsc,
    bank_name, status
  )
  values (
    p_company_id,
    v_user_id,
    public.next_employee_code(p_company_id),
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

  return v_employee_id;
end;
$$;

-- The four-argument version would now create employees with a null company and
-- break the NOT NULL from 0011. Removed so a stale caller fails loudly.
drop function if exists public.create_employee_profile(uuid, text, text, jsonb);

revoke execute on function public.create_employee_profile(uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.create_employee_profile(uuid, text, text, jsonb, integer) to service_role;


create or replace function public.deactivate_employee(p_id integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select user_id into v_user_id
  from employees
  where id = p_id and company_id = public.app_company_id();

  if v_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if v_user_id = public.app_user_id() then
    raise exception 'You cannot deactivate your own account';
  end if;

  update employees set status = 'inactive' where id = p_id;
  update users set is_active = false where id = v_user_id;
end;
$$;


create or replace function public.set_employee_role(p_employee_id integer, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- A company admin must not be able to mint a super admin, which would be a
  -- privilege escalation out of their own tenant.
  if p_role = 'super_admin' then
    raise exception 'super_admin cannot be assigned from within a company' using errcode = '42501';
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  update users u set role_id = v_role_id
  from employees e
  where e.id = p_employee_id
    and u.id = e.user_id
    and e.company_id = public.app_company_id();

  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
end;
$$;


-- =============================================================================
-- Attendance
-- =============================================================================

create or replace function public.attendance_check_in()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id integer := public.app_company_id();
  v_today date := (now() at time zone 'utc')::date;
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  insert into attendance_records (company_id, employee_id, date, check_in, status)
  values (v_company_id, v_employee_id, v_today, now(), 'present')
  on conflict (employee_id, date) do update
    set check_in = excluded.check_in, status = 'present'
    where attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Already checked in today';
  end if;

  return v_id;
end;
$$;


-- Dashboard headline figures. Every count was company-wide and is now
-- tenant-wide — without this, Company A's dashboard would report the platform's
-- total headcount.
create or replace function public.attendance_summary(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_company integer := public.app_company_id();
  v_total integer;
  v_present integer;
  v_half integer;
  v_leave integer;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select count(*) into v_total from employees
    where status = 'active' and company_id = v_company;
  select count(*) into v_present from attendance_records
    where date = v_date and status = 'present' and company_id = v_company;
  select count(*) into v_half from attendance_records
    where date = v_date and status = 'half_day' and company_id = v_company;
  select count(*) into v_leave from leave_requests
    where status = 'approved' and start_date <= v_date and end_date >= v_date
      and company_id = v_company;

  return jsonb_build_object(
    'date', v_date,
    'present', v_present,
    'absent', greatest(v_total - v_present - v_half - v_leave, 0),
    'on_leave', v_leave,
    'half_day', v_half,
    'total_employees', v_total
  );
end;
$$;


-- =============================================================================
-- Leave
-- =============================================================================

create or replace function public.apply_leave(
  p_leave_type_id integer,
  p_start_date date,
  p_end_date date,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id integer := public.app_company_id();
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;
  if p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  -- The leave type must be a platform default or this company's own; an id
  -- belonging to another tenant is not selectable.
  if not exists (
    select 1 from leave_types
    where id = p_leave_type_id
      and (company_id is null or company_id = v_company_id)
  ) then
    raise exception 'Unknown leave type' using errcode = 'P0002';
  end if;

  insert into leave_requests (
    company_id, employee_id, leave_type_id, start_date, end_date, days_count, reason)
  values (
    v_company_id, v_employee_id, p_leave_type_id, p_start_date, p_end_date,
    (p_end_date - p_start_date) + 1, p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;


create or replace function public.decide_leave_request(p_id integer, p_approve boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request leave_requests;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_request from leave_requests
   where id = p_id and company_id = public.app_company_id()
   for update;

  if v_request.id is null then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;

  update leave_requests set
    status = case when p_approve then 'approved'::leave_status_enum else 'rejected'::leave_status_enum end,
    decided_by = public.app_user_id(),
    decided_at = now()
  where id = p_id;

  if p_approve then
    update leave_balances
    set used_days = used_days + v_request.days_count
    where employee_id = v_request.employee_id
      and leave_type_id = v_request.leave_type_id
      and year = extract(year from v_request.start_date)
      and company_id = v_request.company_id;
  end if;

  return p_id;
end;
$$;


-- =============================================================================
-- Payroll
-- =============================================================================

create or replace function public.compute_payslip(p_employee_id integer)
returns table (
  basic numeric, hra numeric, special_allowance numeric, gross_pay numeric,
  pf_deduction numeric, esi_deduction numeric, professional_tax numeric, net_pay numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.basic,
    s.hra,
    s.special_allowance,
    s.basic + s.hra + s.special_allowance as gross_pay,
    round(s.basic * s.pf_percent / 100, 2) as pf_deduction,
    round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2) as esi_deduction,
    case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end::numeric as professional_tax,
    round(
      (s.basic + s.hra + s.special_allowance)
      - round(s.basic * s.pf_percent / 100, 2)
      - round((s.basic + s.hra + s.special_allowance) * s.esi_percent / 100, 2)
      - case when s.basic + s.hra + s.special_allowance > 15000 then 200 else 0 end,
      2
    ) as net_pay
  from salary_structures s
  where s.employee_id = p_employee_id
    and s.company_id = public.app_company_id()
$$;

revoke execute on function public.compute_payslip(integer) from public, anon, authenticated;


create or replace function public.generate_payslip(p_employee_id integer, p_month integer, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id integer := public.app_company_id();
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if not exists (
    select 1 from employees where id = p_employee_id and company_id = v_company_id
  ) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from payslips
    where employee_id = p_employee_id and month = p_month and year = p_year
      and company_id = v_company_id
  ) then
    raise exception 'A payslip for this employee and month already exists';
  end if;
  if not exists (
    select 1 from salary_structures
    where employee_id = p_employee_id and company_id = v_company_id
  ) then
    raise exception 'This employee has no salary structure configured';
  end if;

  insert into payslips (
    company_id, employee_id, month, year, basic, hra, special_allowance, gross_pay,
    pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
  )
  select
    v_company_id, p_employee_id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
    c.pf_deduction, c.esi_deduction, c.professional_tax, c.net_pay, public.app_user_id()
  from public.compute_payslip(p_employee_id) c
  returning id into v_id;

  return v_id;
end;
$$;


-- =============================================================================
-- Letters
-- =============================================================================

create or replace function public.generate_letter(
  p_employee_id integer,
  p_letter_type text,
  p_custom_message text default null,
  p_annual_ctc numeric default null,
  p_probation_text text default null,
  p_notice_period_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id integer := public.app_company_id();
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if not exists (
    select 1 from employees where id = p_employee_id and company_id = v_company_id
  ) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  insert into generated_letters (
    company_id, employee_id, letter_type, custom_message, annual_ctc_override,
    probation_text, notice_period_text, generated_by
  )
  values (
    v_company_id, p_employee_id, p_letter_type::letter_type_enum, p_custom_message, p_annual_ctc,
    p_probation_text, p_notice_period_text, public.app_user_id()
  )
  returning id into v_id;

  return public.letter_payload(v_id);
end;
$$;


-- The letterhead now comes from the tenant's own company record rather than the
-- single company_settings row, so each client's letters carry its own identity.
create or replace function public.letter_payload(p_letter_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', l.id,
    'letter_type', l.letter_type,
    'employee_name', e.full_name,
    'employee_code', e.employee_code,
    'employee_address', e.address,
    'designation_title', g.title,
    'department_name', d.name,
    'joining_date', e.joining_date,
    'reporting_manager_name', m.full_name,
    'annual_ctc', coalesce(l.annual_ctc_override, (select c.gross_pay * 12 from public.compute_payslip(e.id) c)),
    'probation_text', coalesce(l.probation_text, 'Six months from the date of joining'),
    'notice_period_text', coalesce(l.notice_period_text, 'Thirty days on either side after confirmation'),
    'custom_message', l.custom_message,
    'company_name', co.name,
    'company_address', co.address,
    'today', (now() at time zone 'utc')::date,
    'generated_at', l.generated_at
  )
  into v_result
  from generated_letters l
  join employees e on e.id = l.employee_id
  join companies co on co.id = l.company_id
  left join departments d on d.id = e.department_id
  left join designations g on g.id = e.designation_id
  left join employees m on m.id = e.reporting_manager_id
  where l.id = p_letter_id
    and l.company_id = public.app_company_id();

  return v_result;
end;
$$;

revoke execute on function public.letter_payload(integer) from public, anon, authenticated;


-- =============================================================================
-- Reports
--
-- These were the widest holes: every one aggregated across `employees` with no
-- company predicate, so an HR user at any tenant would have received the whole
-- platform's figures.
-- =============================================================================

create or replace function public.report_attendance(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_month integer := coalesce(p_month, extract(month from now() at time zone 'utc')::integer);
  v_company integer := public.app_company_id();
  v_start date;
  v_end date;
  v_days integer;
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := least((v_start + interval '1 month - 1 day')::date, (now() at time zone 'utc')::date);
  v_days := case when v_end >= v_start then (v_end - v_start) + 1 else 0 end;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'employee_id', e.id,
      'employee_name', e.full_name,
      'present_days', s.present,
      'absent_days', greatest(v_days - s.present - s.half_day - s.on_leave, 0),
      'half_days', s.half_day,
      'late_count', s.late_count
    ) as row
    from employees e
    cross join lateral (
      select
        count(*) filter (where a.status = 'present') as present,
        count(*) filter (where a.status = 'half_day') as half_day,
        count(*) filter (where a.status = 'on_leave') as on_leave,
        count(*) filter (where (a.check_in at time zone 'utc')::time > time '09:30') as late_count
      from attendance_records a
      where a.employee_id = e.id and a.date between v_start and v_end
        and a.company_id = v_company
    ) s
    where e.status = 'active' and e.company_id = v_company
    order by e.full_name
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_leaves(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'employee_id', b.employee_id,
      'employee_name', e.full_name,
      'leave_type_name', t.name,
      'allocated_days', b.allocated_days,
      'used_days', b.used_days,
      'remaining_days', b.allocated_days - b.used_days
    ) as row
    from leave_balances b
    join employees e on e.id = b.employee_id
    join leave_types t on t.id = b.leave_type_id
    where b.year = v_year and b.company_id = v_company
    order by e.full_name, t.name
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_employees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'department_name', coalesce(d.name, 'Unassigned'),
      'designation_title', coalesce(g.title, 'Unassigned'),
      'active_count', count(*) filter (where e.status = 'active'),
      'inactive_count', count(*) filter (where e.status <> 'active')
    ) as row
    from employees e
    left join departments d on d.id = e.department_id
    left join designations g on g.id = e.designation_id
    where e.company_id = v_company
    group by coalesce(d.name, 'Unassigned'), coalesce(g.title, 'Unassigned')
    order by 1
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'assignee_id', t.assigned_to,
      'assignee_name', coalesce(e.full_name, 'Unassigned'),
      'assigned', count(*) filter (where t.status = 'assigned'),
      'in_progress', count(*) filter (where t.status = 'in_progress'),
      'review', count(*) filter (where t.status = 'review'),
      'completed', count(*) filter (where t.status = 'completed')
    ) as row
    from tasks t
    left join employees e on e.id = t.assigned_to
    where t.company_id = v_company
    group by t.assigned_to, e.full_name
    order by coalesce(e.full_name, 'Unassigned')
  ) rows;

  return v_result;
end;
$$;


create or replace function public.report_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'priority', p.priority,
      'progress', p.progress,
      'member_count', (select count(*) from project_members m where m.project_id = p.id),
      'deadline', p.deadline
    ) as row
    from projects p
    where p.company_id = v_company
    order by p.created_at desc
  ) rows;

  return v_result;
end;
$$;

commit;


-- ------------------------------------------------------------- diagnostics
-- Every SECURITY DEFINER function in public, and whether its body mentions a
-- company. A `false` here is not automatically a bug — a trigger that only
-- touches its own row is fine — but every `false` must be justified against the
-- coverage list at the top of this file.
select
  p.proname                                        as function_name,
  pg_get_functiondef(p.oid) ilike '%company_id%'
    or pg_get_functiondef(p.oid) ilike '%app_company_id%' as tenant_aware
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by tenant_aware, p.proname;
