-- ---------------------------------------------------------------------------
-- Migration 0020: Security Hardening Phase 2
--
-- Findings addressed:
--   M3  — Protect sensitive employee columns (PAN, Aadhaar, Bank Details, IFSC)
--         Ensure blanket table grants cannot undo column-level restrictions.
--   H4  — Privilege escalation and segregation of duties
--         Prevent self-role promotion, founder minting by HR, and self-approval of leave.
--   H5  — Append-only audit logging for role and leave changes.
--   M11 — Client-safe application audit logging via SECURITY DEFINER function.
-- ---------------------------------------------------------------------------

-- 1. M3: Protect sensitive columns in public.employees at the database grant level
do $$
declare
  v_cols text;
  v_role text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'employees'
     and column_name not in ('pan_number', 'aadhaar_number', 'bank_account_number', 'bank_ifsc');

  if v_cols is null then
    raise exception 'public.employees has no columns — refusing to change grants';
  end if;

  foreach v_role in array array['hrms_app', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke select on public.employees from %I', v_role);
      execute format('grant select (%s) on public.employees to %I', v_cols, v_role);
    end if;
  end loop;
end
$$;

-- 2. H4 & H5: Hardened set_employee_role with segregation of duties and audit logging
create or replace function public.set_employee_role(p_employee_id integer, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id integer;
  v_target_user_id integer;
  v_caller_user_id integer := public.app_user_id();
  v_caller_role text;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- Block minting super_admin from inside a tenant
  if p_role = 'super_admin' then
    raise exception 'super_admin cannot be assigned from within a company' using errcode = '42501';
  end if;

  select e.user_id into v_target_user_id
    from employees e
   where e.id = p_employee_id
     and e.company_id = public.app_company_id();

  if v_target_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  -- H4: Prevent changing your own privileged role
  if v_target_user_id = v_caller_user_id then
    raise exception 'You cannot modify your own role' using errcode = '42501';
  end if;

  -- H4: Only an existing founder (or super_admin) can assign the founder role
  if p_role = 'founder' then
    select r.name into v_caller_role
      from users u
      join roles r on r.id = u.role_id
     where u.id = v_caller_user_id;

    if v_caller_role <> 'founder' and not public.app_is_super_admin() then
      raise exception 'Only an existing founder can assign the founder role' using errcode = '42501';
    end if;
  end if;

  select id into v_role_id from roles where name = p_role;
  if v_role_id is null then
    raise exception 'Unknown role: %', p_role;
  end if;

  update users set role_id = v_role_id where id = v_target_user_id;

  -- H5: Mandatory compliance audit logging
  perform public.log_security_event(
    'role.assigned',
    'employees',
    p_employee_id,
    jsonb_build_object('new_role', p_role, 'assigned_by', v_caller_user_id)
  );
end;
$$;

revoke all on function public.set_employee_role(integer, text) from public;
grant execute on function public.set_employee_role(integer, text) to authenticated, hrms_app;

-- 3. H4 & H5: Hardened decide_leave_request with self-approval prohibition
create or replace function public.decide_leave_request(p_id integer, p_approve boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request leave_requests;
  v_caller_employee_id integer := public.app_employee_id();
  v_caller_user_id integer := public.app_user_id();
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

  -- H4: Prevent approving your own leave request
  if v_request.employee_id = v_caller_employee_id then
    raise exception 'Self-approval of leave requests is prohibited' using errcode = '42501';
  end if;

  update leave_requests set
    status = case when p_approve then 'approved'::leave_status_enum else 'rejected'::leave_status_enum end,
    decided_by = v_caller_user_id,
    decided_at = clock_timestamp()
  where id = p_id;

  if p_approve then
    update leave_balances
       set used_days = used_days + v_request.days_count
     where employee_id = v_request.employee_id
       and leave_type_id = v_request.leave_type_id
       and year = extract(year from v_request.start_date)
       and company_id = v_request.company_id;
  end if;

  -- H5: Mandatory compliance audit logging
  perform public.log_security_event(
    case when p_approve then 'leave.approved' else 'leave.rejected' end,
    'leave_requests',
    p_id,
    jsonb_build_object(
      'days', v_request.days_count,
      'employee_id', v_request.employee_id,
      'decided_by', v_caller_user_id
    )
  );

  return p_id;
end;
$$;

revoke all on function public.decide_leave_request(integer, boolean) from public;
grant execute on function public.decide_leave_request(integer, boolean) to authenticated, hrms_app;

-- 4. M11: Safe application audit log function
create or replace function public.log_application_audit(
  p_action text,
  p_entity text,
  p_entity_id integer default null,
  p_meta jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id integer := public.app_company_id();
  v_user_id integer := public.app_user_id();
begin
  if v_company_id is null or v_user_id is null then
    return;
  end if;

  insert into audit_logs (user_id, action, entity, entity_id, meta, company_id, result)
  values (
    v_user_id,
    p_action,
    p_entity,
    p_entity_id,
    p_meta,
    v_company_id,
    'success'
  );
exception
  when others then null;
end;
$$;

revoke all on function public.log_application_audit(text, text, integer, jsonb) from public;
grant execute on function public.log_application_audit(text, text, integer, jsonb) to authenticated, hrms_app;
