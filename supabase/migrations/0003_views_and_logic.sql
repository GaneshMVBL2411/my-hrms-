-- =============================================================================
-- 0003 — Read models and ported business logic
--
-- Views replace the `to_summary` / `to_detail` mappers from the service layer so
-- the client can keep issuing one query per screen. Functions replace the pieces
-- of app/services/*.py that were more than a single row change: anything that
-- validates, spans tables, or has to see rows the caller cannot select directly.
-- =============================================================================

-- ------------------------------------------------- who-did-it column defaults
-- These were filled from `current_user.id` in every router; make the database
-- supply them so a client can never claim to be someone else.
alter table projects       alter column created_by set default public.app_user_id();
alter table tasks          alter column created_by set default public.app_user_id();
alter table task_comments  alter column user_id    set default public.app_user_id();
alter table announcements  alter column created_by set default public.app_user_id();
alter table company_events alter column created_by set default public.app_user_id();
alter table policies       alter column updated_by set default public.app_user_id();
alter table audit_logs     alter column user_id    set default public.app_user_id();

-- Policies are versioned on every edit (document_service.update_policy).
create or replace function public.bump_policy_version()
returns trigger
language plpgsql
as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  new.updated_by = coalesce(public.app_user_id(), old.updated_by);
  return new;
end;
$$;

create trigger policies_bump_version before update on policies
  for each row execute function public.bump_policy_version();

-- Scheduling the first interview advances a fresh candidate's pipeline stage
-- (recruitment_service.add_interview).
create or replace function public.advance_candidate_on_interview()
returns trigger
language plpgsql
as $$
begin
  update candidates set status = 'interview_scheduled'
  where id = new.candidate_id and status = 'applied';
  return new;
end;
$$;

create trigger interviews_advance_candidate after insert on interviews
  for each row execute function public.advance_candidate_on_interview();

-- =============================================================================
-- Views
-- =============================================================================

-- Display name for a user: their employee name when they have a profile, else
-- the login email. Repeated in six different `_to_out` mappers before.
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
$$;

create view employee_directory with (security_invoker = on) as
select
  e.id,
  e.employee_code,
  e.full_name,
  u.email,
  e.phone,
  e.address,
  e.photo_url,
  e.department_id,
  d.name as department_name,
  e.designation_id,
  g.title as designation_title,
  e.status,
  e.joining_date,
  e.first_name,
  e.last_name,
  e.dob,
  e.gender,
  e.reporting_manager_id,
  m.full_name as reporting_manager_name,
  e.skills,
  e.experience_years,
  e.created_at
from employees e
join users u on u.id = e.user_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id
left join employees m on m.id = e.reporting_manager_id;

create view attendance_detail with (security_invoker = on) as
select
  a.id,
  a.employee_id,
  e.full_name as employee_name,
  a.date,
  a.check_in,
  a.check_out,
  a.break_minutes,
  a.status,
  case
    when a.check_in is null or a.check_out is null then null
    else round(
      greatest(extract(epoch from (a.check_out - a.check_in)) - a.break_minutes * 60, 0) / 3600.0,
      2
    )
  end as working_hours,
  coalesce((a.check_in at time zone 'utc')::time > time '09:30', false) as is_late
from attendance_records a
join employees e on e.id = a.employee_id;

create view leave_balance_detail with (security_invoker = on) as
select
  b.id,
  b.employee_id,
  b.leave_type_id,
  t.name as leave_type_name,
  b.year,
  b.allocated_days,
  b.used_days,
  b.allocated_days - b.used_days as remaining_days
from leave_balances b
join leave_types t on t.id = b.leave_type_id;

create view leave_request_detail with (security_invoker = on) as
select
  r.id,
  r.employee_id,
  e.full_name as employee_name,
  r.leave_type_id,
  t.name as leave_type_name,
  r.start_date,
  r.end_date,
  r.days_count,
  r.reason,
  r.status,
  public.user_display_name(r.decided_by) as decided_by_name,
  r.decided_at,
  r.created_at
from leave_requests r
join employees e on e.id = r.employee_id
join leave_types t on t.id = r.leave_type_id;

create view asset_detail with (security_invoker = on) as
select
  a.id,
  a.name,
  a.category,
  a.serial_number,
  a.purchase_date,
  a.status,
  a.notes,
  a.created_at,
  (
    select e.full_name
    from asset_assignments aa
    join employees e on e.id = aa.employee_id
    where aa.asset_id = a.id and aa.returned_date is null
    limit 1
  ) as assigned_to_name
from assets a;

create view asset_assignment_detail with (security_invoker = on) as
select
  aa.id,
  aa.asset_id,
  aa.employee_id,
  e.full_name as employee_name,
  aa.assigned_date,
  aa.returned_date,
  aa.notes
from asset_assignments aa
join employees e on e.id = aa.employee_id;

create view salary_structure_detail with (security_invoker = on) as
select
  s.id,
  s.employee_id,
  e.full_name as employee_name,
  s.basic,
  s.hra,
  s.special_allowance,
  s.pf_percent,
  s.esi_percent,
  s.effective_from
from salary_structures s
join employees e on e.id = s.employee_id;

create view payslip_detail with (security_invoker = on) as
select
  p.id,
  p.employee_id,
  e.full_name as employee_name,
  e.employee_code,
  g.title as designation_title,
  d.name as department_name,
  e.joining_date,
  p.month,
  p.year,
  p.basic,
  p.hra,
  p.special_allowance,
  p.gross_pay,
  p.pf_deduction,
  p.esi_deduction,
  p.professional_tax,
  p.net_pay,
  p.generated_at
from payslips p
join employees e on e.id = p.employee_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id;

create view project_directory with (security_invoker = on) as
select
  p.id,
  p.name,
  p.description,
  p.priority,
  p.status,
  p.deadline,
  p.progress,
  p.tech_stack,
  p.created_at,
  (select count(*) from project_members m where m.project_id = p.id) as member_count
from projects p;

create view project_member_detail with (security_invoker = on) as
select
  m.project_id,
  m.employee_id,
  e.full_name as employee_name,
  e.photo_url,
  m.role_in_project
from project_members m
join employees e on e.id = m.employee_id;

create view task_directory with (security_invoker = on) as
select
  t.id,
  t.title,
  t.description,
  t.project_id,
  p.name as project_name,
  t.assigned_to,
  e.full_name as assignee_name,
  t.priority,
  t.due_date,
  t.status,
  t.progress,
  t.created_at
from tasks t
left join projects p on p.id = t.project_id
left join employees e on e.id = t.assigned_to;

create view task_comment_detail with (security_invoker = on) as
select
  c.id,
  c.task_id,
  c.user_id,
  public.user_display_name(c.user_id) as user_name,
  c.body,
  c.created_at
from task_comments c;

create view candidate_directory with (security_invoker = on) as
select
  c.id,
  c.full_name,
  c.email,
  c.phone,
  c.applied_designation_id,
  g.title as applied_designation_title,
  c.status,
  c.source,
  c.notes,
  c.created_at
from candidates c
left join designations g on g.id = c.applied_designation_id;

create view interview_detail with (security_invoker = on) as
select
  i.id,
  i.candidate_id,
  i.scheduled_at,
  i.interviewer_id,
  e.full_name as interviewer_name,
  i.notes,
  i.outcome
from interviews i
left join employees e on e.id = i.interviewer_id;

create view policy_detail with (security_invoker = on) as
select
  p.id,
  p.title,
  p.content,
  p.version,
  public.user_display_name(p.updated_by) as updated_by_name,
  p.updated_at
from policies p;

create view generated_letter_detail with (security_invoker = on) as
select
  l.id,
  l.employee_id,
  e.full_name as employee_name,
  l.letter_type,
  public.user_display_name(l.generated_by) as generated_by_name,
  l.generated_at
from generated_letters l
join employees e on e.id = l.employee_id;

create view announcement_detail with (security_invoker = on) as
select
  a.id,
  a.title,
  a.body,
  a.category,
  a.pinned,
  public.user_display_name(a.created_by) as created_by_name,
  a.created_at
from announcements a;

create view company_event_detail with (security_invoker = on) as
select
  c.id,
  c.title,
  c.description,
  c.event_date,
  c.event_type,
  public.user_display_name(c.created_by) as created_by_name
from company_events c;

create view audit_log_detail with (security_invoker = on) as
select
  l.id,
  l.user_id,
  public.user_display_name(l.user_id) as user_name,
  l.action,
  l.entity,
  l.entity_id,
  l.created_at
from audit_logs l;

grant select on
  employee_directory, attendance_detail, leave_balance_detail, leave_request_detail,
  project_directory, project_member_detail, task_directory, task_comment_detail,
  candidate_directory, interview_detail,
  asset_detail, asset_assignment_detail, salary_structure_detail, payslip_detail,
  policy_detail, generated_letter_detail, announcement_detail, company_event_detail,
  audit_log_detail
to authenticated;

-- Views inherit Supabase's default grants, which include `anon`. Every view is
-- security_invoker so an anonymous caller would see nothing anyway, but there is
-- no reason for the endpoint to exist.
revoke all on
  employee_directory, attendance_detail, leave_balance_detail, leave_request_detail,
  project_directory, project_member_detail, task_directory, task_comment_detail,
  candidate_directory, interview_detail,
  asset_detail, asset_assignment_detail, salary_structure_detail, payslip_detail,
  policy_detail, generated_letter_detail, announcement_detail, company_event_detail,
  audit_log_detail
from anon;

-- Resolves any user's display name, so it is not for anonymous callers — but the
-- security_invoker views above call it, so `authenticated` must keep EXECUTE.
revoke execute on function public.user_display_name(integer) from anon;

-- =============================================================================
-- Session
-- =============================================================================

-- Replaces `GET /auth/me`. Returns null when the signed-in auth identity has no
-- active app user, which is how the UI knows to bounce back to the login screen.
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
    'photo_url', e.photo_url
  )
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where u.auth_id = auth.uid() and u.is_active
$$;

-- =============================================================================
-- Employees
-- =============================================================================

-- PAN / Aadhaar / bank details are withheld from the base table grant, so this
-- is the only way to read them — and only HR or the employee themselves get
-- the real values. Everyone else sees the profile with those fields nulled.
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
  where d.id = p_id;

  if v_result is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.next_employee_code()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select 'WP-' || ((select count(*) from employees) + 1001)::text $$;

revoke execute on function public.next_employee_code() from public, anon, authenticated;

-- Called by the `admin-users` edge function with the service key, right after it
-- has created the auth identity. Never exposed to a browser session: the account
-- and the profile have to appear together or not at all.
create or replace function public.create_employee_profile(
  p_auth_id uuid,
  p_email text,
  p_role text,
  p_employee jsonb
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
begin
  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  if exists (select 1 from users where lower(email) = lower(p_email)) then
    raise exception 'An account with email % already exists', p_email;
  end if;

  insert into users (auth_id, email, role_id)
  values (p_auth_id, p_email, v_role_id)
  returning id into v_user_id;

  insert into employees (
    user_id, employee_code, first_name, last_name, phone, address, dob, gender,
    department_id, designation_id, reporting_manager_id, joining_date, skills,
    experience_years, pan_number, aadhaar_number, bank_account_number, bank_ifsc,
    bank_name, status
  )
  values (
    v_user_id,
    public.next_employee_code(),
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

revoke execute on function public.create_employee_profile(uuid, text, text, jsonb) from public, anon, authenticated;

-- Deactivation is a soft delete across two tables, and you cannot lock yourself out.
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

  select user_id into v_user_id from employees where id = p_id;
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

-- Changing someone's role writes to `users`, which the employee form cannot see.
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

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  update users u set role_id = v_role_id
  from employees e
  where e.id = p_employee_id and u.id = e.user_id;
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
  v_today date := (now() at time zone 'utc')::date;
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  insert into attendance_records (employee_id, date, check_in, status)
  values (v_employee_id, v_today, now(), 'present')
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

create or replace function public.attendance_check_out()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_today date := (now() at time zone 'utc')::date;
  v_record attendance_records;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  select * into v_record from attendance_records
  where employee_id = v_employee_id and date = v_today;

  if v_record.id is null or v_record.check_in is null then
    raise exception 'You haven''t checked in today';
  end if;
  if v_record.check_out is not null then
    raise exception 'Already checked out today';
  end if;

  update attendance_records set check_out = now() where id = v_record.id;
  return v_record.id;
end;
$$;

-- Counts across the whole company, which a plain employee cannot select.
create or replace function public.attendance_summary(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_total integer;
  v_present integer;
  v_half integer;
  v_leave integer;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select count(*) into v_total from employees where status = 'active';
  select count(*) into v_present from attendance_records where date = v_date and status = 'present';
  select count(*) into v_half from attendance_records where date = v_date and status = 'half_day';
  select count(*) into v_leave from leave_requests
    where status = 'approved' and start_date <= v_date and end_date >= v_date;

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
  v_id integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;
  if p_end_date < p_start_date then
    raise exception 'End date must be on or after the start date';
  end if;

  insert into leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, reason)
  values (
    v_employee_id, p_leave_type_id, p_start_date, p_end_date,
    (p_end_date - p_start_date) + 1, p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Approving also spends the balance, so both have to happen in one transaction.
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

  select * into v_request from leave_requests where id = p_id for update;
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
      and year = extract(year from v_request.start_date);
  end if;

  return p_id;
end;
$$;

-- =============================================================================
-- Tasks
-- =============================================================================

-- Everyone may move a task along the board, but only a manager may re-scope it,
-- and only the assignee may report a completion percentage.
create or replace function public.update_task(p_id integer, p_patch jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task tasks;
  v_extra_keys text[];
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if not public.app_manages_tasks() then
    select array_agg(k) into v_extra_keys
    from jsonb_object_keys(p_patch) k
    where k not in ('status', 'progress');

    if v_extra_keys is not null then
      raise exception 'You can only update a task''s status and progress' using errcode = '42501';
    end if;
  end if;

  if p_patch ? 'progress' and v_task.assigned_to is distinct from public.app_employee_id() then
    raise exception 'Only the assignee can update a task''s progress percentage' using errcode = '42501';
  end if;

  update tasks t set
    title       = case when p_patch ? 'title' then p_patch->>'title' else t.title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
    -- nullif('') because a cleared form field arrives as "" rather than as null
    project_id  = case when p_patch ? 'project_id' then nullif(p_patch->>'project_id', '')::integer else t.project_id end,
    assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::integer else t.assigned_to end,
    priority    = case when p_patch ? 'priority' then (p_patch->>'priority')::priority_enum else t.priority end,
    due_date    = case when p_patch ? 'due_date' then nullif(p_patch->>'due_date', '')::date else t.due_date end,
    status      = case when p_patch ? 'status' then (p_patch->>'status')::task_status_enum else t.status end,
    progress    = case when p_patch ? 'progress' then (p_patch->>'progress')::integer else t.progress end
  where t.id = p_id;

  return p_id;
end;
$$;

-- =============================================================================
-- Assets
-- =============================================================================

create or replace function public.assign_asset(p_asset_id integer, p_employee_id integer, p_notes text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status asset_status_enum;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select status into v_status from assets where id = p_asset_id for update;
  if v_status is null then
    raise exception 'Asset not found' using errcode = 'P0002';
  end if;
  if v_status <> 'available' then
    raise exception 'Asset is currently % and cannot be assigned', v_status;
  end if;

  insert into asset_assignments (asset_id, employee_id, assigned_date, notes)
  values (p_asset_id, p_employee_id, (now() at time zone 'utc')::date, p_notes);

  update assets set status = 'assigned' where id = p_asset_id;
  return p_asset_id;
end;
$$;

create or replace function public.return_asset(p_asset_id integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select id into v_assignment_id from asset_assignments
  where asset_id = p_asset_id and returned_date is null
  limit 1;

  if v_assignment_id is null then
    raise exception 'This asset is not currently assigned to anyone';
  end if;

  update asset_assignments set returned_date = (now() at time zone 'utc')::date where id = v_assignment_id;
  update assets set status = 'available' where id = p_asset_id;
  return p_asset_id;
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
$$;

-- Salary maths, not a salary reader: only the SECURITY DEFINER routines below
-- call it, and they run as the owner, so no client needs EXECUTE.
revoke execute on function public.compute_payslip(integer) from public, anon, authenticated;

create or replace function public.generate_payslip(p_employee_id integer, p_month integer, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if exists (
    select 1 from payslips where employee_id = p_employee_id and month = p_month and year = p_year
  ) then
    raise exception 'A payslip for this employee and month already exists';
  end if;
  if not exists (select 1 from salary_structures where employee_id = p_employee_id) then
    raise exception 'This employee has no salary structure configured';
  end if;

  insert into payslips (
    employee_id, month, year, basic, hra, special_allowance, gross_pay,
    pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
  )
  select
    p_employee_id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
    c.pf_deduction, c.esi_deduction, c.professional_tax, c.net_pay, public.app_user_id()
  from public.compute_payslip(p_employee_id) c
  returning id into v_id;

  return v_id;
end;
$$;

-- Skips employees who already have a payslip for the month or no salary
-- structure — same forgiving behaviour as payroll_service.generate_bulk.
create or replace function public.generate_payslips_bulk(p_month integer, p_year integer)
returns integer[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids integer[];
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  with eligible as (
    select e.id
    from employees e
    join salary_structures s on s.employee_id = e.id
    where e.status = 'active'
      and not exists (
        select 1 from payslips p
        where p.employee_id = e.id and p.month = p_month and p.year = p_year
      )
  ),
  inserted as (
    insert into payslips (
      employee_id, month, year, basic, hra, special_allowance, gross_pay,
      pf_deduction, esi_deduction, professional_tax, net_pay, generated_by
    )
    select
      e.id, p_month, p_year, c.basic, c.hra, c.special_allowance, c.gross_pay,
      c.pf_deduction, c.esi_deduction, c.professional_tax, c.net_pay, public.app_user_id()
    from eligible e
    cross join lateral public.compute_payslip(e.id) c
    returning id
  )
  select array_agg(id) into v_ids from inserted;

  return coalesce(v_ids, '{}');
end;
$$;

create or replace function public.payroll_summary(p_month integer, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gross numeric;
  v_net numeric;
  v_count integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select coalesce(sum(gross_pay), 0), coalesce(sum(net_pay), 0), count(*)
  into v_gross, v_net, v_count
  from payslips where month = p_month and year = p_year;

  return jsonb_build_object(
    'month', p_month,
    'year', p_year,
    'employee_count', v_count,
    'total_gross', round(v_gross, 2),
    'total_deductions', round(v_gross - v_net, 2),
    'total_net', round(v_net, 2)
  );
end;
$$;

-- =============================================================================
-- Documents
-- =============================================================================

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
    'company_name', coalesce((select company_name from company_settings limit 1), 'Whhohh Path LLP'),
    'company_address', (select address from company_settings limit 1),
    'today', (now() at time zone 'utc')::date,
    'generated_at', l.generated_at
  )
  into v_result
  from generated_letters l
  join employees e on e.id = l.employee_id
  left join departments d on d.id = e.department_id
  left join designations g on g.id = e.designation_id
  left join employees m on m.id = e.reporting_manager_id
  where l.id = p_letter_id;

  return v_result;
end;
$$;

revoke execute on function public.letter_payload(integer) from public, anon, authenticated;

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
  v_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if not exists (select 1 from employees where id = p_employee_id) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  insert into generated_letters (
    employee_id, letter_type, custom_message, annual_ctc_override,
    probation_text, notice_period_text, generated_by
  )
  values (
    p_employee_id, p_letter_type::letter_type_enum, p_custom_message, p_annual_ctc,
    p_probation_text, p_notice_period_text, public.app_user_id()
  )
  returning id into v_id;

  return public.letter_payload(v_id);
end;
$$;

create or replace function public.get_letter_view(p_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer;
begin
  select employee_id into v_employee_id from generated_letters where id = p_id;
  if v_employee_id is null then
    raise exception 'Letter not found' using errcode = 'P0002';
  end if;
  if not public.app_is_hr() and v_employee_id is distinct from public.app_employee_id() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return public.letter_payload(p_id);
end;
$$;

-- =============================================================================
-- Calendar
-- =============================================================================

-- Merges five sources; the leave entries in particular cover the whole company,
-- which no plain employee can read directly.
create or replace function public.get_calendar(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_month integer := coalesce(p_month, extract(month from now() at time zone 'utc')::integer);
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  select coalesce(jsonb_agg(entry order by entry->>'date'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object('date', event_date, 'type', event_type, 'title', title) as entry
    from company_events
    where event_date between v_start and v_end

    union all

    select jsonb_build_object(
      'date', greatest(r.start_date, v_start),
      'type', 'leave',
      'title', e.full_name || ' on leave'
    )
    from leave_requests r
    join employees e on e.id = r.employee_id
    where r.status = 'approved' and r.start_date <= v_end and r.end_date >= v_start

    union all

    select jsonb_build_object('date', due_date, 'type', 'task_due', 'title', 'Task due: ' || title)
    from tasks
    where due_date between v_start and v_end

    union all

    select jsonb_build_object('date', deadline, 'type', 'project_deadline', 'title', 'Project deadline: ' || name)
    from projects
    where deadline between v_start and v_end

    union all

    select jsonb_build_object(
      'date', make_date(v_year, v_month, extract(day from dob)::integer),
      'type', 'birthday',
      'title', full_name || '''s birthday'
    )
    from employees
    where dob is not null
      and extract(month from dob) = v_month
      -- 29 Feb birthdays simply do not appear in a non-leap year
      and (extract(day from dob) <> 29 or v_month <> 2
           or extract(day from (make_date(v_year, 3, 1) - 1)) = 29)
  ) entries;

  return v_result;
end;
$$;

-- =============================================================================
-- Reports (HR only — every one of them reads across the whole company)
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
    ) s
    where e.status = 'active'
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
    where b.year = v_year
    order by e.full_name, t.name
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
    order by p.created_at desc
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
    group by coalesce(d.name, 'Unassigned'), coalesce(g.title, 'Unassigned')
    order by 1
  ) rows;

  return v_result;
end;
$$;

-- =============================================================================
-- Settings
-- =============================================================================

create or replace function public.upsert_company_settings(
  p_company_name text,
  p_address text default null,
  p_logo_url text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not public.app_is_founder() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select id into v_id from company_settings limit 1;

  if v_id is null then
    insert into company_settings (company_name, address, logo_url)
    values (p_company_name, p_address, p_logo_url)
    returning id into v_id;
  else
    update company_settings
    set company_name = p_company_name, address = p_address, logo_url = p_logo_url, updated_at = now()
    where id = v_id;
  end if;

  return v_id;
end;
$$;
