-- =============================================================================
-- 0009 — Payroll: read models and business logic
--
-- The client cannot write a payroll run, an item, a revision or a bank record —
-- 0008 removed the grants. Everything below is the replacement: SECURITY DEFINER
-- routines that check the caller's role, enforce the state machine, and leave a
-- trail in payroll_approvals and audit_logs.
--
-- Money rules worth stating once, because they are assumptions and not laws:
--   * Components are NOT prorated. Loss of pay is a single deduction line at the
--     per-day rate, which is how an Indian payslip normally reads and keeps the
--     earnings side stable month to month.
--   * PF is on basic, capped at the statutory ceiling unless the company opts
--     out. ESI is on gross and stops entirely once gross crosses its threshold —
--     a threshold, not a cap, so crossing it removes the deduction rather than
--     freezing it.
--   * A computed item is a snapshot. Re-running compute overwrites it; approving
--     freezes it; locking makes it immutable. Nothing recalculates on read.
-- =============================================================================

-- =============================================================================
-- Read models
-- =============================================================================

-- 0003's versions predate every column 0007 added. CASCADE would take the
-- dependent grants with it, so they are dropped and re-granted explicitly.
drop view if exists salary_structure_detail;
create view salary_structure_detail with (security_invoker = on) as
select
  s.id,
  s.employee_id,
  e.full_name as employee_name,
  e.employee_code,
  d.name as department_name,
  g.title as designation_title,
  s.ctc,
  s.basic,
  s.hra,
  s.special_allowance,
  s.medical_allowance,
  s.transport_allowance,
  s.internet_allowance,
  s.meal_allowance,
  s.performance_bonus,
  s.project_bonus,
  s.other_allowance,
  s.gross_salary,
  s.pf_percent,
  s.esi_percent,
  s.professional_tax,
  s.income_tax,
  s.loan_deduction,
  s.advance_deduction,
  s.other_deduction,
  s.total_deductions,
  s.net_salary,
  s.effective_from,
  s.effective_to,
  s.status,
  s.revision_no,
  s.revision_reason,
  public.user_display_name(s.approved_by) as approved_by_name,
  s.approved_at,
  s.created_at
from salary_structures s
join employees e on e.id = s.employee_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id;

drop view if exists payslip_detail;
create view payslip_detail with (security_invoker = on) as
select
  p.id,
  p.employee_id,
  e.full_name as employee_name,
  e.employee_code,
  g.title as designation_title,
  d.name as department_name,
  e.joining_date,
  p.payslip_no,
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
  p.payroll_run_id,
  p.payroll_item_id,
  p.payment_status,
  p.payment_date,
  p.payment_reference,
  p.verification_code,
  p.emailed_at,
  p.generated_at
from payslips p
join employees e on e.id = p.employee_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id;

create or replace view payroll_run_detail with (security_invoker = on) as
select
  r.id,
  r.run_no,
  r.frequency,
  r.month,
  r.year,
  r.period_start,
  r.period_end,
  r.payment_date,
  r.status,
  r.working_days,
  r.total_employees,
  r.total_gross,
  r.total_bonus,
  r.total_deductions,
  r.total_net,
  r.total_employer_cost,
  r.notes,
  r.rejection_reason,
  public.user_display_name(r.created_by) as created_by_name,
  public.user_display_name(r.submitted_by) as submitted_by_name,
  public.user_display_name(r.accounts_verified_by) as accounts_verified_by_name,
  public.user_display_name(r.approved_by) as approved_by_name,
  public.user_display_name(r.locked_by) as locked_by_name,
  r.computed_at,
  r.submitted_at,
  r.accounts_verified_at,
  r.approved_at,
  r.locked_at,
  r.paid_at,
  r.payment_reference,
  (select count(*) from payroll_items i where i.payroll_run_id = r.id and i.status = 'on_hold') as on_hold_count,
  (select count(*) from payslips s where s.payroll_run_id = r.id) as payslip_count,
  r.created_at
from payroll_runs r;

create or replace view payroll_item_detail with (security_invoker = on) as
select
  i.id,
  i.payroll_run_id,
  r.run_no,
  r.month,
  r.year,
  r.status as run_status,
  i.employee_id,
  e.full_name as employee_name,
  e.employee_code,
  d.name as department_name,
  g.title as designation_title,
  i.payable_days,
  i.present_days,
  i.paid_leave_days,
  i.lop_days,
  i.overtime_hours,
  i.basic,
  i.hra,
  i.special_allowance,
  i.medical_allowance,
  i.transport_allowance,
  i.internet_allowance,
  i.meal_allowance,
  i.performance_bonus,
  i.project_bonus,
  i.other_allowance,
  i.overtime_amount,
  i.arrears,
  i.gross_earnings,
  i.pf_deduction,
  i.esi_deduction,
  i.professional_tax,
  i.income_tax,
  i.loan_deduction,
  i.advance_deduction,
  i.lop_deduction,
  i.other_deduction,
  i.total_deductions,
  i.employer_pf,
  i.employer_esi,
  i.net_pay,
  -- The account is masked here. The unmasked number lives behind
  -- report_bank_payment_file(), which only accounts and the founder may call.
  case
    when i.bank_account_number is null then null
    else repeat('X', greatest(length(i.bank_account_number) - 4, 0))
         || right(i.bank_account_number, 4)
  end as bank_account_masked,
  i.bank_name,
  i.bank_ifsc,
  (i.bank_details_id is not null) as bank_verified,
  i.status,
  i.hold_reason,
  i.remarks
from payroll_items i
join payroll_runs r on r.id = i.payroll_run_id
join employees e on e.id = i.employee_id
left join departments d on d.id = e.department_id
left join designations g on g.id = e.designation_id;

create or replace view salary_revision_detail with (security_invoker = on) as
select
  v.id,
  v.employee_id,
  e.full_name as employee_name,
  e.employee_code,
  d.name as department_name,
  v.previous_ctc,
  v.new_ctc,
  v.previous_gross,
  v.new_gross,
  v.change_amount,
  v.change_percent,
  v.reason,
  v.effective_date,
  v.status,
  public.user_display_name(v.requested_by) as requested_by_name,
  public.user_display_name(v.approved_by) as approved_by_name,
  v.approved_at,
  v.created_at
from salary_revisions v
join employees e on e.id = v.employee_id
left join departments d on d.id = e.department_id;

create or replace view payroll_approval_detail with (security_invoker = on) as
select
  a.id,
  a.payroll_run_id,
  a.action,
  a.from_status,
  a.to_status,
  a.actor_user_id,
  public.user_display_name(a.actor_user_id) as actor_name,
  a.actor_role,
  a.comments,
  a.created_at
from payroll_approvals a;

grant select on
  salary_structure_detail, payslip_detail, payroll_run_detail, payroll_item_detail,
  salary_revision_detail, payroll_approval_detail
to authenticated;

-- Same reasoning as 0003: these are security_invoker, so anon would see nothing,
-- but the endpoint should not exist at all.
revoke all on
  salary_structure_detail, payslip_detail, payroll_run_detail, payroll_item_detail,
  salary_revision_detail, payroll_approval_detail
from anon;


-- =============================================================================
-- Internal helpers
-- =============================================================================

-- Writes the workflow trail. Called only from the transition functions, which
-- have already authorised the caller.
create or replace function public.payroll_log(
  p_run_id integer,
  p_action payroll_approval_action_enum,
  p_from payroll_run_status_enum,
  p_to payroll_run_status_enum,
  p_comments text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into payroll_approvals (
    payroll_run_id, action, from_status, to_status, actor_user_id, actor_role, comments
  )
  values (p_run_id, p_action, p_from, p_to, public.app_user_id(), public.app_role(), p_comments);
$$;

create or replace function public.notify_user(
  p_user_id integer,
  p_type notification_type_enum,
  p_title text,
  p_body text default null,
  p_entity text default null,
  p_entity_id integer default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into notifications (user_id, type, title, body, entity, entity_id)
  select p_user_id, p_type, p_title, p_body, p_entity, p_entity_id
  where p_user_id is not null;
$$;

-- The active rate set. Every calculation goes through this rather than reading
-- tax_settings directly, so "no rates configured" fails once, loudly, here.
create or replace function public.active_tax_settings()
returns tax_settings
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from tax_settings where is_active order by effective_from desc limit 1
$$;

-- The divisor behind the per-day rate. `working` counts Mon-Fri in the period;
-- the other two are constants.
create or replace function public.payroll_day_divisor(p_start date, p_end date)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings payroll_settings;
  v_days numeric;
begin
  select * into v_settings from payroll_settings limit 1;
  if v_settings is null then
    return (p_end - p_start) + 1;
  end if;

  case v_settings.lop_basis
    when 'fixed' then
      v_days := v_settings.lop_fixed_days;
    when 'working' then
      select count(*) into v_days
      from generate_series(p_start, p_end, interval '1 day') d
      where extract(isodow from d) < 6;
    else
      v_days := (p_end - p_start) + 1;
  end case;

  -- A zero divisor would turn every per-day rate into a division error.
  return greatest(coalesce(v_days, 0), 1);
end;
$$;

revoke execute on function public.payroll_log(integer, payroll_approval_action_enum,
  payroll_run_status_enum, payroll_run_status_enum, text) from public, anon, authenticated;
revoke execute on function public.notify_user(integer, notification_type_enum, text, text, text, integer)
  from public, anon, authenticated;
-- Both are SECURITY DEFINER and would hand the rate table to any signed-in
-- session, bypassing the tax_settings policy. Only the routines above call them.
revoke execute on function public.active_tax_settings() from public, anon, authenticated;
revoke execute on function public.payroll_day_divisor(date, date) from public, anon, authenticated;


-- =============================================================================
-- Company bank details
-- =============================================================================

-- The table is closed to clients (0008), so reads come through here. Employees
-- are refused outright — the spec is explicit that they never see this page.
create or replace function public.get_company_bank_details()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(t) order by t.is_primary desc, t.id)
      from (
        select
          c.id, c.company_name, c.legal_name, c.bank_name, c.account_holder_name,
          c.account_number, c.ifsc_code, c.branch_name, c.swift_code, c.upi_id,
          c.gst_number, c.pan_number, c.tan_number, c.pf_registration_number,
          c.esi_registration_number, c.authorized_signatory, c.logo_url,
          c.signature_url, c.is_primary, c.status,
          public.user_display_name(c.verified_by) as verified_by_name,
          c.verified_at,
          public.user_display_name(c.updated_by) as updated_by_name,
          c.updated_at
        from company_bank_details c
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.upsert_company_bank_details(p_id integer, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
  v_primary boolean := coalesce((p_payload ->> 'is_primary')::boolean, false);
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- Only one primary account; clear the flag elsewhere before setting it here,
  -- or the partial unique index rejects the write.
  if v_primary then
    update company_bank_details set is_primary = false
    where is_primary and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into company_bank_details (
      company_name, legal_name, bank_name, account_holder_name, account_number,
      ifsc_code, branch_name, swift_code, upi_id, gst_number, pan_number,
      tan_number, pf_registration_number, esi_registration_number,
      authorized_signatory, logo_url, signature_url, is_primary, status, updated_by
    )
    select
      p_payload ->> 'company_name', p_payload ->> 'legal_name', p_payload ->> 'bank_name',
      p_payload ->> 'account_holder_name', p_payload ->> 'account_number',
      upper(p_payload ->> 'ifsc_code'), p_payload ->> 'branch_name',
      upper(nullif(p_payload ->> 'swift_code', '')), p_payload ->> 'upi_id',
      upper(nullif(p_payload ->> 'gst_number', '')), upper(nullif(p_payload ->> 'pan_number', '')),
      upper(nullif(p_payload ->> 'tan_number', '')), p_payload ->> 'pf_registration_number',
      p_payload ->> 'esi_registration_number', p_payload ->> 'authorized_signatory',
      p_payload ->> 'logo_url', p_payload ->> 'signature_url',
      v_primary, coalesce(p_payload ->> 'status', 'active'), public.app_user_id()
    returning id into v_id;
  else
    update company_bank_details set
      company_name            = coalesce(p_payload ->> 'company_name', company_name),
      legal_name              = coalesce(p_payload ->> 'legal_name', legal_name),
      bank_name               = coalesce(p_payload ->> 'bank_name', bank_name),
      account_holder_name     = coalesce(p_payload ->> 'account_holder_name', account_holder_name),
      account_number          = coalesce(p_payload ->> 'account_number', account_number),
      ifsc_code               = coalesce(upper(p_payload ->> 'ifsc_code'), ifsc_code),
      branch_name             = coalesce(p_payload ->> 'branch_name', branch_name),
      swift_code              = coalesce(upper(nullif(p_payload ->> 'swift_code', '')), swift_code),
      upi_id                  = coalesce(p_payload ->> 'upi_id', upi_id),
      gst_number              = coalesce(upper(nullif(p_payload ->> 'gst_number', '')), gst_number),
      pan_number              = coalesce(upper(nullif(p_payload ->> 'pan_number', '')), pan_number),
      tan_number              = coalesce(upper(nullif(p_payload ->> 'tan_number', '')), tan_number),
      pf_registration_number  = coalesce(p_payload ->> 'pf_registration_number', pf_registration_number),
      esi_registration_number = coalesce(p_payload ->> 'esi_registration_number', esi_registration_number),
      authorized_signatory    = coalesce(p_payload ->> 'authorized_signatory', authorized_signatory),
      logo_url                = coalesce(p_payload ->> 'logo_url', logo_url),
      signature_url           = coalesce(p_payload ->> 'signature_url', signature_url),
      is_primary              = v_primary,
      status                  = coalesce(p_payload ->> 'status', status),
      -- Verification attests that the *account* is correct, so only a change to
      -- the account itself revokes it. Editing a logo, a GST number or the
      -- signatory does not, or uploading a payslip image would quietly make the
      -- company unpayable. Bare column names here are the pre-update values.
      verified_by = case
        when coalesce(p_payload ->> 'account_number', account_number) is distinct from account_number
          or coalesce(upper(p_payload ->> 'ifsc_code'), ifsc_code) is distinct from ifsc_code
          or coalesce(p_payload ->> 'bank_name', bank_name) is distinct from bank_name
        then null else verified_by end,
      verified_at = case
        when coalesce(p_payload ->> 'account_number', account_number) is distinct from account_number
          or coalesce(upper(p_payload ->> 'ifsc_code'), ifsc_code) is distinct from ifsc_code
          or coalesce(p_payload ->> 'bank_name', bank_name) is distinct from bank_name
        then null else verified_at end,
      updated_by              = public.app_user_id()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'No company bank record with id %', p_id;
    end if;
  end if;

  insert into audit_logs (user_id, action, entity, entity_id)
  values (public.app_user_id(), case when p_id is null then 'create' else 'update' end,
          'company_bank_details', v_id);

  return v_id;
end;
$$;

create or replace function public.verify_company_bank_details(p_id integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_can_verify_payroll() then
    raise exception 'Only accounts or the founder can verify bank details' using errcode = '42501';
  end if;

  update company_bank_details
  set verified_by = public.app_user_id(), verified_at = now()
  where id = p_id;

  if not found then
    raise exception 'No company bank record with id %', p_id;
  end if;

  insert into audit_logs (user_id, action, entity, entity_id)
  values (public.app_user_id(), 'verify', 'company_bank_details', p_id);
end;
$$;


-- =============================================================================
-- Employee bank details
-- =============================================================================

-- Own record, or anyone's if you run payroll. Account numbers come back in full
-- for both — the employee owns theirs, and payroll needs them to pay people.
create or replace function public.get_employee_bank_details(p_employee_id integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_target integer := coalesce(p_employee_id, public.app_employee_id());
begin
  if v_target is null then
    return '[]'::jsonb;
  end if;
  if v_target <> coalesce(public.app_employee_id(), -1) and not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(t) order by t.is_primary desc, t.created_at desc)
      from (
        select
          b.id, b.employee_id, e.full_name as employee_name, e.employee_code,
          b.bank_name, b.account_holder_name, b.account_number, b.ifsc_code,
          b.branch, b.upi_id, b.pan_number, b.aadhaar_number, b.uan_number,
          b.pf_number, b.esi_number, b.cancelled_cheque_url, b.passbook_url,
          b.is_primary, b.status, b.verification_status, b.rejection_reason,
          public.user_display_name(b.submitted_by) as submitted_by_name,
          public.user_display_name(b.verified_by) as verified_by_name,
          b.verified_at, b.created_at, b.updated_at
        from employee_bank_details b
        join employees e on e.id = b.employee_id
        where b.employee_id = v_target
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

-- The Employee Bank Details screen: everyone, with verification state, so HR can
-- see at a glance who is unpayable. Account numbers are masked in the list.
create or replace function public.list_employee_bank_details(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(t) order by t.employee_name)
      from (
        select
          e.id as employee_id,
          e.full_name as employee_name,
          e.employee_code,
          d.name as department_name,
          b.id as bank_details_id,
          b.bank_name,
          b.account_holder_name,
          case
            when b.account_number is null then null
            else repeat('X', greatest(length(b.account_number) - 4, 0)) || right(b.account_number, 4)
          end as account_masked,
          b.ifsc_code,
          b.branch,
          b.upi_id,
          b.uan_number,
          b.pf_number,
          b.esi_number,
          (b.cancelled_cheque_url is not null) as has_cancelled_cheque,
          (b.passbook_url is not null) as has_passbook,
          coalesce(b.verification_status::text, 'missing') as verification_status,
          b.rejection_reason,
          public.user_display_name(b.verified_by) as verified_by_name,
          b.verified_at
        from employees e
        left join departments d on d.id = e.department_id
        left join lateral (
          -- The record that matters: the verified primary, else the open request.
          select * from employee_bank_details x
          where x.employee_id = e.id
          order by (x.is_primary and x.verification_status = 'verified') desc,
                   x.created_at desc
          limit 1
        ) b on true
        where e.status = 'active'
          and (
            p_status is null
            or coalesce(b.verification_status::text, 'missing') = p_status
          )
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

-- An employee submits a change request; HR submits on anyone's behalf. Either
-- way the row lands as `pending` and is not paid to until it is verified — that
-- is the whole point of the workflow, so HR does not get to self-approve here.
create or replace function public.submit_employee_bank_details(
  p_employee_id integer,
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target integer := coalesce(p_employee_id, public.app_employee_id());
  v_id integer;
begin
  if v_target is null then
    raise exception 'No employee to attach these bank details to';
  end if;
  if v_target <> coalesce(public.app_employee_id(), -1) and not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- One open request at a time. Superseding rather than rejecting, because the
  -- employee is correcting themselves, not being turned down.
  delete from employee_bank_details
  where employee_id = v_target and verification_status = 'pending';

  insert into employee_bank_details (
    employee_id, bank_name, account_holder_name, account_number, ifsc_code,
    branch, upi_id, pan_number, aadhaar_number, uan_number, pf_number, esi_number,
    cancelled_cheque_url, passbook_url, verification_status, submitted_by
  )
  values (
    v_target,
    p_payload ->> 'bank_name',
    p_payload ->> 'account_holder_name',
    p_payload ->> 'account_number',
    upper(p_payload ->> 'ifsc_code'),
    p_payload ->> 'branch',
    nullif(p_payload ->> 'upi_id', ''),
    upper(nullif(p_payload ->> 'pan_number', '')),
    nullif(p_payload ->> 'aadhaar_number', ''),
    nullif(p_payload ->> 'uan_number', ''),
    nullif(p_payload ->> 'pf_number', ''),
    nullif(p_payload ->> 'esi_number', ''),
    nullif(p_payload ->> 'cancelled_cheque_url', ''),
    nullif(p_payload ->> 'passbook_url', ''),
    'pending',
    public.app_user_id()
  )
  returning id into v_id;

  insert into audit_logs (user_id, action, entity, entity_id, meta)
  values (public.app_user_id(), 'submit', 'employee_bank_details', v_id,
          jsonb_build_object('employee_id', v_target));

  return v_id;
end;
$$;

create or replace function public.verify_employee_bank_details(
  p_id integer,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row employee_bank_details;
  v_user_id integer;
begin
  if not (public.app_is_hr() or public.app_is_accounts()) then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_row from employee_bank_details where id = p_id;
  if v_row is null then
    raise exception 'No bank record with id %', p_id;
  end if;
  if v_row.verification_status <> 'pending' then
    raise exception 'This record has already been %', v_row.verification_status;
  end if;

  if p_approve then
    -- The approved record becomes the one payroll reads; the previous primary
    -- steps down first so the partial unique index stays satisfied.
    update employee_bank_details
    set is_primary = false, status = 'inactive'
    where employee_id = v_row.employee_id and id <> p_id and is_primary;

    update employee_bank_details
    set verification_status = 'verified',
        is_primary = true,
        status = 'active',
        verified_by = public.app_user_id(),
        verified_at = now(),
        rejection_reason = null
    where id = p_id;
  else
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'A reason is required when rejecting bank details';
    end if;
    update employee_bank_details
    set verification_status = 'rejected',
        verified_by = public.app_user_id(),
        verified_at = now(),
        rejection_reason = p_reason
    where id = p_id;
  end if;

  select u.id into v_user_id from users u join employees e on e.user_id = u.id
  where e.id = v_row.employee_id;

  perform public.notify_user(
    v_user_id, 'bank_details_status',
    case when p_approve then 'Bank details verified' else 'Bank details rejected' end,
    case when p_approve then 'Your account has been verified and will be used for salary payments.'
         else p_reason end,
    'employee_bank_details', p_id
  );

  insert into audit_logs (user_id, action, entity, entity_id, meta)
  values (public.app_user_id(), case when p_approve then 'verify' else 'reject' end,
          'employee_bank_details', p_id, jsonb_build_object('reason', p_reason));
end;
$$;


-- =============================================================================
-- Salary structures
-- =============================================================================

-- Creating a structure supersedes the current one rather than editing it, and
-- records the delta in salary_revisions. This is why 0008 removed the client's
-- write grant: an UPDATE would erase the history this depends on.
create or replace function public.upsert_salary_structure(
  p_employee_id integer,
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tax tax_settings;
  v_current salary_structures;
  v_new_id integer;
  v_effective date := coalesce((p_payload ->> 'effective_from')::date, current_date);
  v_gross numeric(14, 2);
  v_pf numeric(14, 2);
  v_esi numeric(14, 2);
  v_pt numeric(14, 2);
  v_deductions numeric(14, 2);
  v_basic numeric(12, 2) := coalesce((p_payload ->> 'basic')::numeric, 0);
  v_pf_percent numeric(5, 2);
  v_esi_percent numeric(5, 2);
  v_pf_base numeric(14, 2);
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if v_basic <= 0 then
    raise exception 'Basic salary must be greater than zero';
  end if;

  v_tax := public.active_tax_settings();
  if v_tax is null then
    raise exception 'No active tax settings. Configure them under Tax Settings first.';
  end if;

  select * into v_current
  from salary_structures where employee_id = p_employee_id and status = 'active';

  v_pf_percent := coalesce((p_payload ->> 'pf_percent')::numeric, v_tax.pf_employee_percent);
  v_esi_percent := coalesce((p_payload ->> 'esi_percent')::numeric, v_tax.esi_employee_percent);

  v_gross :=
      v_basic
    + coalesce((p_payload ->> 'hra')::numeric, 0)
    + coalesce((p_payload ->> 'special_allowance')::numeric, 0)
    + coalesce((p_payload ->> 'medical_allowance')::numeric, 0)
    + coalesce((p_payload ->> 'transport_allowance')::numeric, 0)
    + coalesce((p_payload ->> 'internet_allowance')::numeric, 0)
    + coalesce((p_payload ->> 'meal_allowance')::numeric, 0)
    + coalesce((p_payload ->> 'performance_bonus')::numeric, 0)
    + coalesce((p_payload ->> 'project_bonus')::numeric, 0)
    + coalesce((p_payload ->> 'other_allowance')::numeric, 0);

  v_pf_base := case when v_tax.pf_restrict_to_ceiling then least(v_basic, v_tax.pf_wage_ceiling)
                    else v_basic end;
  v_pf := round(v_pf_base * v_pf_percent / 100, 2);
  -- ESI is a threshold: above the ceiling it stops applying altogether.
  v_esi := case when v_gross <= v_tax.esi_wage_ceiling
                then round(v_gross * v_esi_percent / 100, 2) else 0 end;
  v_pt := coalesce(
    (p_payload ->> 'professional_tax')::numeric,
    case when v_gross > v_tax.professional_tax_threshold then v_tax.professional_tax_monthly else 0 end
  );

  v_deductions := v_pf + v_esi + v_pt
    + coalesce((p_payload ->> 'income_tax')::numeric, 0)
    + coalesce((p_payload ->> 'loan_deduction')::numeric, 0)
    + coalesce((p_payload ->> 'advance_deduction')::numeric, 0)
    + coalesce((p_payload ->> 'other_deduction')::numeric, 0);

  if v_current.id is not null then
    update salary_structures
    set status = 'superseded', effective_to = v_effective - 1
    where id = v_current.id;
  end if;

  insert into salary_structures (
    employee_id, ctc, basic, hra, special_allowance, medical_allowance,
    transport_allowance, internet_allowance, meal_allowance, performance_bonus,
    project_bonus, other_allowance, gross_salary, pf_percent, esi_percent,
    professional_tax, income_tax, loan_deduction, advance_deduction,
    other_deduction, total_deductions, net_salary, effective_from, status,
    revision_no, revision_reason, created_by, approved_by, approved_at
  )
  values (
    p_employee_id,
    coalesce((p_payload ->> 'ctc')::numeric, v_gross * 12),
    v_basic,
    coalesce((p_payload ->> 'hra')::numeric, 0),
    coalesce((p_payload ->> 'special_allowance')::numeric, 0),
    coalesce((p_payload ->> 'medical_allowance')::numeric, 0),
    coalesce((p_payload ->> 'transport_allowance')::numeric, 0),
    coalesce((p_payload ->> 'internet_allowance')::numeric, 0),
    coalesce((p_payload ->> 'meal_allowance')::numeric, 0),
    coalesce((p_payload ->> 'performance_bonus')::numeric, 0),
    coalesce((p_payload ->> 'project_bonus')::numeric, 0),
    coalesce((p_payload ->> 'other_allowance')::numeric, 0),
    v_gross, v_pf_percent, v_esi_percent, v_pt,
    coalesce((p_payload ->> 'income_tax')::numeric, 0),
    coalesce((p_payload ->> 'loan_deduction')::numeric, 0),
    coalesce((p_payload ->> 'advance_deduction')::numeric, 0),
    coalesce((p_payload ->> 'other_deduction')::numeric, 0),
    v_deductions, v_gross - v_deductions, v_effective, 'active',
    coalesce(v_current.revision_no, 0) + 1,
    p_payload ->> 'revision_reason',
    public.app_user_id(),
    public.app_user_id(), now()
  )
  returning id into v_new_id;

  -- First structure is not a revision; there is nothing it revised.
  if v_current.id is not null then
    insert into salary_revisions (
      employee_id, previous_structure_id, new_structure_id, previous_ctc, new_ctc,
      previous_gross, new_gross, change_percent, reason, effective_date, status,
      requested_by, approved_by, approved_at
    )
    values (
      p_employee_id, v_current.id, v_new_id, v_current.ctc,
      coalesce((p_payload ->> 'ctc')::numeric, v_gross * 12),
      v_current.gross_salary, v_gross,
      case when coalesce(v_current.gross_salary, 0) > 0
           then round((v_gross - v_current.gross_salary) * 100 / v_current.gross_salary, 2)
      end,
      p_payload ->> 'revision_reason', v_effective, 'active',
      public.app_user_id(), public.app_user_id(), now()
    );

    perform public.notify_user(
      (select u.id from users u join employees e on e.user_id = u.id where e.id = p_employee_id),
      'salary_revision', 'Your salary has been revised',
      'Effective ' || to_char(v_effective, 'DD Mon YYYY') || '.',
      'salary_structures', v_new_id
    );
  end if;

  insert into audit_logs (user_id, action, entity, entity_id, meta)
  values (public.app_user_id(), 'upsert', 'salary_structures', v_new_id,
          jsonb_build_object('employee_id', p_employee_id, 'gross', v_gross));

  return v_new_id;
end;
$$;

-- Own history, or anyone's for payroll roles.
create or replace function public.salary_history(p_employee_id integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_target integer := coalesce(p_employee_id, public.app_employee_id());
begin
  if v_target is null then return '[]'::jsonb; end if;
  if v_target <> coalesce(public.app_employee_id(), -1) and not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(to_jsonb(t) order by t.effective_from desc)
      from (
        select
          s.id, s.revision_no, s.ctc, s.gross_salary, s.net_salary,
          s.basic, s.hra, s.special_allowance, s.effective_from, s.effective_to,
          s.status, s.revision_reason,
          public.user_display_name(s.approved_by) as approved_by_name,
          s.approved_at,
          v.previous_gross, v.change_amount, v.change_percent
        from salary_structures s
        left join salary_revisions v on v.new_structure_id = s.id
        where s.employee_id = v_target
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

-- 0003's compute_payslip selects from salary_structures by employee alone. With
-- revision history that now matches every past revision too, which would make
-- generate_payslip insert one payslip per revision. Scoped to the active row.
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
    s.gross_salary,
    round(s.basic * s.pf_percent / 100, 2),
    round(s.gross_salary * s.esi_percent / 100, 2),
    s.professional_tax,
    s.net_salary
  from salary_structures s
  where s.employee_id = p_employee_id and s.status = 'active'
$$;

revoke execute on function public.compute_payslip(integer) from public, anon, authenticated;


-- =============================================================================
-- Payroll run — creation and calculation
-- =============================================================================

create or replace function public.payroll_create_run(p_month integer, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
  v_start date;
  v_end date;
  v_settings payroll_settings;
begin
  if not public.app_can_process_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if p_month not between 1 and 12 then
    raise exception 'Month must be between 1 and 12';
  end if;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  if exists (select 1 from payroll_runs where year = p_year and month = p_month and frequency = 'monthly') then
    raise exception 'A payroll run for % % already exists', to_char(v_start, 'Mon'), p_year;
  end if;

  select * into v_settings from payroll_settings limit 1;

  insert into payroll_runs (
    run_no, frequency, month, year, period_start, period_end, payment_date,
    status, working_days, created_by
  )
  values (
    'PR-' || p_year || '-' || lpad(p_month::text, 2, '0'),
    coalesce(v_settings.frequency, 'monthly'), p_month, p_year, v_start, v_end,
    -- Salary for this month is credited on the payment day of the next one.
    (v_start + interval '1 month')::date
      + (coalesce(v_settings.salary_payment_day, 1) - 1),
    'draft',
    public.payroll_day_divisor(v_start, v_end),
    public.app_user_id()
  )
  returning id into v_id;

  perform public.payroll_log(v_id, 'created', null, 'draft', null);

  insert into audit_logs (user_id, action, entity, entity_id, meta)
  values (public.app_user_id(), 'create', 'payroll_runs', v_id,
          jsonb_build_object('month', p_month, 'year', p_year));

  return v_id;
end;
$$;

-- Rebuilds every line from scratch: salary structure, attendance, leave and
-- overtime for the period, against the rates active right now. Safe to re-run
-- while the run is still editable, which is the point — payroll is iterative
-- until someone approves it.
create or replace function public.payroll_compute(p_run_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
  v_tax tax_settings;
  v_settings payroll_settings;
  v_divisor numeric;
  v_emp record;
  v_count integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not public.app_can_process_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then
    raise exception 'No payroll run with id %', p_run_id;
  end if;
  if v_run.status not in ('draft', 'computed', 'hr_review') then
    raise exception 'This run is % and can no longer be recalculated', v_run.status;
  end if;

  v_tax := public.active_tax_settings();
  if v_tax is null then
    raise exception 'No active tax settings. Configure them under Tax Settings first.';
  end if;
  select * into v_settings from payroll_settings limit 1;
  v_divisor := public.payroll_day_divisor(v_run.period_start, v_run.period_end);

  -- Recomputing replaces the previous attempt rather than merging into it, so a
  -- structure that was deleted between runs does not leave an orphan line.
  delete from payroll_items where payroll_run_id = p_run_id;

  for v_emp in
    -- `s.*` already carries employee_id; selecting e.id under the same name
    -- would put two columns of that name in the record and make every
    -- v_emp.employee_id reference ambiguous at runtime.
    select
      s.*,
      b.id as bank_id, b.bank_name as b_bank, b.account_number as b_account, b.ifsc_code as b_ifsc
    from employees e
    join salary_structures s
      on s.employee_id = e.id and s.status = 'active' and s.effective_from <= v_run.period_end
    left join employee_bank_details b
      on b.employee_id = e.id and b.is_primary and b.verification_status = 'verified'
    where e.status in ('active', 'on_notice')
  loop
    declare
      v_present numeric := 0;
      v_paid_leave numeric := 0;
      v_lop numeric := 0;
      v_ot_hours numeric := 0;
      v_per_day numeric;
      v_gross numeric;
      v_ot_amount numeric := 0;
      v_pf numeric; v_esi numeric; v_pt numeric;
      v_lop_amount numeric;
      v_total_ded numeric;
      v_pf_base numeric;
    begin
      -- Attendance. A half day is half present and half loss of pay; an absence
      -- is a full day of it. Days with no record at all are treated as worked —
      -- an unmarked day is a data gap, not evidence that someone did not turn up.
      select
        coalesce(sum(case a.status when 'present' then 1 when 'half_day' then 0.5 else 0 end), 0),
        coalesce(sum(case when a.status = 'on_leave' then 1 else 0 end), 0),
        coalesce(sum(case a.status when 'absent' then 1 when 'half_day' then 0.5 else 0 end), 0)
      into v_present, v_paid_leave, v_lop
      from attendance_records a
      where a.employee_id = v_emp.employee_id
        and a.date between v_run.period_start and v_run.period_end;

      -- Leave only stays paid if it was actually approved; anything marked
      -- on_leave without an approved request falls through to loss of pay.
      v_paid_leave := least(
        v_paid_leave,
        coalesce((
          select sum(least(l.end_date, v_run.period_end) - greatest(l.start_date, v_run.period_start) + 1)
          from leave_requests l
          where l.employee_id = v_emp.employee_id
            and l.status = 'approved'
            and l.start_date <= v_run.period_end
            and l.end_date >= v_run.period_start
        ), 0)
      );
      v_lop := v_lop + greatest(
        coalesce((
          select sum(case when a.status = 'on_leave' then 1 else 0 end)
          from attendance_records a
          where a.employee_id = v_emp.employee_id
            and a.date between v_run.period_start and v_run.period_end
        ), 0) - v_paid_leave,
        0
      );

      if coalesce(v_settings.overtime_enabled, true) then
        select coalesce(sum(
          greatest(extract(epoch from (a.check_out - a.check_in)) / 3600
                   - a.break_minutes / 60.0 - 8, 0)
        ), 0)
        into v_ot_hours
        from attendance_records a
        where a.employee_id = v_emp.employee_id
          and a.date between v_run.period_start and v_run.period_end
          and a.check_in is not null and a.check_out is not null;
      end if;

      v_gross := v_emp.gross_salary;
      v_per_day := round(v_gross / v_divisor, 2);
      v_lop_amount := round(v_per_day * v_lop, 2);
      -- An eight-hour day is the divisor for an hourly rate.
      v_ot_amount := round((v_per_day / 8) * v_ot_hours
                           * coalesce(v_settings.overtime_rate_multiplier, 2), 2);

      v_gross := v_gross + v_ot_amount;

      v_pf_base := case when v_tax.pf_restrict_to_ceiling
                        then least(v_emp.basic, v_tax.pf_wage_ceiling) else v_emp.basic end;
      v_pf := round(v_pf_base * v_emp.pf_percent / 100, 2);
      v_esi := case when v_gross <= v_tax.esi_wage_ceiling
                    then round(v_gross * v_emp.esi_percent / 100, 2) else 0 end;
      v_pt := case
                when v_run.month = 2 and v_tax.professional_tax_february is not null
                  then v_tax.professional_tax_february
                when v_gross > v_tax.professional_tax_threshold
                  then coalesce(nullif(v_emp.professional_tax, 0), v_tax.professional_tax_monthly)
                else 0
              end;

      v_total_ded := v_pf + v_esi + v_pt + v_emp.income_tax + v_emp.loan_deduction
                     + v_emp.advance_deduction + v_emp.other_deduction + v_lop_amount;

      insert into payroll_items (
        payroll_run_id, employee_id, salary_structure_id,
        payable_days, present_days, paid_leave_days, lop_days, overtime_hours,
        basic, hra, special_allowance, medical_allowance, transport_allowance,
        internet_allowance, meal_allowance, performance_bonus, project_bonus,
        other_allowance, overtime_amount, gross_earnings,
        pf_deduction, esi_deduction, professional_tax, income_tax,
        loan_deduction, advance_deduction, lop_deduction, other_deduction,
        total_deductions, employer_pf, employer_esi, net_pay,
        bank_name, bank_account_number, bank_ifsc, bank_details_id, status
      )
      values (
        p_run_id, v_emp.employee_id, v_emp.id,
        v_divisor, v_present, v_paid_leave, v_lop, v_ot_hours,
        v_emp.basic, v_emp.hra, v_emp.special_allowance, v_emp.medical_allowance,
        v_emp.transport_allowance, v_emp.internet_allowance, v_emp.meal_allowance,
        v_emp.performance_bonus, v_emp.project_bonus, v_emp.other_allowance,
        v_ot_amount, v_gross,
        v_pf, v_esi, v_pt, v_emp.income_tax,
        v_emp.loan_deduction, v_emp.advance_deduction, v_lop_amount, v_emp.other_deduction,
        v_total_ded,
        round(v_pf_base * v_tax.pf_employer_percent / 100, 2),
        case when v_gross <= v_tax.esi_wage_ceiling
             then round(v_gross * v_tax.esi_employer_percent / 100, 2) else 0 end,
        v_gross - v_total_ded,
        v_emp.b_bank, v_emp.b_account, v_emp.b_ifsc, v_emp.bank_id,
        -- No verified account means no payment instruction. Held rather than
        -- silently paid nowhere, and it shows up in the run's on_hold count.
        case when v_emp.bank_id is null then 'on_hold' else 'processed' end
      );

      if v_emp.bank_id is null then
        update payroll_items set hold_reason = 'No verified bank account'
        where payroll_run_id = p_run_id and employee_id = v_emp.employee_id;
      end if;

      v_count := v_count + 1;
    end;
  end loop;

  -- Anyone active without a structure is reported back, not silently dropped.
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name)), '[]'::jsonb)
  into v_skipped
  from employees e
  where e.status in ('active', 'on_notice')
    and not exists (
      select 1 from salary_structures s
      where s.employee_id = e.id and s.status = 'active' and s.effective_from <= v_run.period_end
    );

  update payroll_runs r
  set status = 'computed',
      computed_at = now(),
      tax_settings_id = v_tax.id,
      working_days = v_divisor,
      total_employees = v_count,
      total_gross = coalesce(t.gross, 0),
      total_bonus = coalesce(t.bonus, 0),
      total_deductions = coalesce(t.deductions, 0),
      total_net = coalesce(t.net, 0),
      total_employer_cost = coalesce(t.net, 0) + coalesce(t.deductions, 0)
                            + coalesce(t.employer, 0)
  from (
    select
      sum(gross_earnings) as gross,
      sum(performance_bonus + project_bonus) as bonus,
      sum(total_deductions) as deductions,
      sum(net_pay) as net,
      sum(employer_pf + employer_esi) as employer
    from payroll_items where payroll_run_id = p_run_id
  ) t
  where r.id = p_run_id;

  perform public.payroll_log(p_run_id, 'computed', v_run.status, 'computed',
    v_count || ' employees processed');

  return jsonb_build_object(
    'run_id', p_run_id,
    'processed', v_count,
    'skipped', v_skipped,
    'on_hold', (select count(*) from payroll_items where payroll_run_id = p_run_id and status = 'on_hold')
  );
end;
$$;


-- =============================================================================
-- Payroll run — workflow transitions
-- =============================================================================

create or replace function public.payroll_submit(p_run_id integer, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
begin
  if not public.app_can_process_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status <> 'computed' then
    raise exception 'Only a computed run can be submitted for review; this one is %', v_run.status;
  end if;
  if not exists (select 1 from payroll_items where payroll_run_id = p_run_id) then
    raise exception 'This run has no line items. Calculate it first.';
  end if;

  update payroll_runs
  set status = 'hr_review', submitted_by = public.app_user_id(), submitted_at = now(),
      rejection_reason = null
  where id = p_run_id;

  perform public.payroll_log(p_run_id, 'submitted', v_run.status, 'hr_review', p_comments);

  -- Whoever has to act next hears about it.
  perform public.notify_user(u.id, 'payroll_approval_pending',
    'Payroll ' || v_run.run_no || ' needs your review',
    'Net payable ' || to_char(v_run.total_net, 'FM9,99,99,999.00'), 'payroll_runs', p_run_id)
  from users u join roles ro on ro.id = u.role_id
  where u.is_active and ro.name in ('founder', 'accounts_manager');
end;
$$;

create or replace function public.payroll_verify(p_run_id integer, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
begin
  if not public.app_can_verify_payroll() then
    raise exception 'Only accounts or the founder can verify a payroll run' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status <> 'hr_review' then
    raise exception 'Only a run under review can be verified; this one is %', v_run.status;
  end if;

  update payroll_runs
  set status = 'accounts_verified',
      accounts_verified_by = public.app_user_id(), accounts_verified_at = now()
  where id = p_run_id;

  perform public.payroll_log(p_run_id, 'accounts_verified', v_run.status, 'accounts_verified', p_comments);

  perform public.notify_user(u.id, 'payroll_approval_pending',
    'Payroll ' || v_run.run_no || ' is ready for approval', null, 'payroll_runs', p_run_id)
  from users u join roles ro on ro.id = u.role_id
  where u.is_active and ro.name = 'founder';
end;
$$;

create or replace function public.payroll_approve(p_run_id integer, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
  v_settings payroll_settings;
begin
  if not public.app_can_approve_payroll() then
    raise exception 'Only the founder can approve payroll' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  select * into v_settings from payroll_settings limit 1;

  -- Verification can be switched off, in which case approval follows review.
  if v_run.status not in ('accounts_verified', 'hr_review') then
    raise exception 'This run is % and cannot be approved', v_run.status;
  end if;
  if v_run.status = 'hr_review' and coalesce(v_settings.require_accounts_verification, true) then
    raise exception 'This run must be verified by accounts before it can be approved';
  end if;

  update payroll_runs
  set status = 'approved', approved_by = public.app_user_id(), approved_at = now()
  where id = p_run_id;

  perform public.payroll_log(p_run_id, 'approved', v_run.status, 'approved', p_comments);
end;
$$;

create or replace function public.payroll_reject(p_run_id integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
begin
  if not (public.app_can_verify_payroll() or public.app_can_approve_payroll()) then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when rejecting a payroll run';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status not in ('hr_review', 'accounts_verified') then
    raise exception 'This run is % and cannot be rejected', v_run.status;
  end if;

  -- Back to computed, not draft: the numbers are still there to be corrected.
  update payroll_runs
  set status = 'computed', rejection_reason = p_reason,
      submitted_by = null, submitted_at = null,
      accounts_verified_by = null, accounts_verified_at = null
  where id = p_run_id;

  perform public.payroll_log(p_run_id, 'rejected', v_run.status, 'computed', p_reason);

  perform public.notify_user(v_run.submitted_by, 'payroll_approval_pending',
    'Payroll ' || v_run.run_no || ' was sent back', p_reason, 'payroll_runs', p_run_id);
end;
$$;

-- The point of no return. After this the items are frozen and payslips can be
-- issued against them.
create or replace function public.payroll_lock(p_run_id integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
begin
  if not public.app_can_approve_payroll() then
    raise exception 'Only the founder can lock payroll' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status <> 'approved' then
    raise exception 'Only an approved run can be locked; this one is %', v_run.status;
  end if;

  update payroll_runs
  set status = 'locked', locked_by = public.app_user_id(), locked_at = now()
  where id = p_run_id;

  perform public.payroll_log(p_run_id, 'locked', 'approved', 'locked', null);

  insert into audit_logs (user_id, action, entity, entity_id)
  values (public.app_user_id(), 'lock', 'payroll_runs', p_run_id);
end;
$$;

-- Deliberately narrow: a paid run is history and cannot be reopened, because
-- money has already left the account.
create or replace function public.payroll_reopen(p_run_id integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
begin
  if not public.app_can_approve_payroll() then
    raise exception 'Only the founder can reopen payroll' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when reopening a payroll run';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status = 'paid' then
    raise exception 'This run has already been paid and cannot be reopened';
  end if;
  if v_run.status not in ('approved', 'locked') then
    raise exception 'This run is % and is already open', v_run.status;
  end if;
  if exists (select 1 from payslips where payroll_run_id = p_run_id) then
    raise exception 'Payslips have been issued for this run. Delete them before reopening.';
  end if;

  update payroll_runs
  set status = 'computed', approved_by = null, approved_at = null,
      locked_by = null, locked_at = null,
      accounts_verified_by = null, accounts_verified_at = null,
      rejection_reason = p_reason
  where id = p_run_id;

  perform public.payroll_log(p_run_id, 'reopened', v_run.status, 'computed', p_reason);
end;
$$;

create or replace function public.payroll_hold_item(p_item_id integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status payroll_run_status_enum;
begin
  if not public.app_can_process_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select r.status into v_status
  from payroll_items i join payroll_runs r on r.id = i.payroll_run_id
  where i.id = p_item_id;

  if v_status is null then raise exception 'No payroll item with id %', p_item_id; end if;
  if v_status in ('locked', 'paid') then
    raise exception 'This run is % and its items can no longer be changed', v_status;
  end if;

  update payroll_items
  set status = case when status = 'on_hold' then 'processed' else 'on_hold' end,
      hold_reason = case when status = 'on_hold' then null else p_reason end
  where id = p_item_id;
end;
$$;


-- =============================================================================
-- Payslips and payment
-- =============================================================================

create or replace function public.payroll_generate_payslips(p_run_id integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
  v_count integer;
begin
  if not public.app_can_process_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status not in ('locked', 'paid') then
    raise exception 'Payslips can only be issued once the run is locked; this one is %', v_run.status;
  end if;

  -- Held lines are excluded: an employee with no verified account has nothing
  -- to be paid against, and a payslip claiming otherwise would be wrong.
  insert into payslips (
    employee_id, month, year, basic, hra, special_allowance, gross_pay,
    pf_deduction, esi_deduction, professional_tax, net_pay, generated_by,
    payroll_item_id, payroll_run_id, payslip_no, payment_status
  )
  select
    i.employee_id, v_run.month, v_run.year, i.basic, i.hra, i.special_allowance,
    i.gross_earnings, i.pf_deduction, i.esi_deduction, i.professional_tax,
    i.net_pay, public.app_user_id(), i.id, p_run_id,
    'PS-' || v_run.year || '-' || lpad(v_run.month::text, 2, '0')
      || '-' || lpad(i.employee_id::text, 4, '0'),
    'unpaid'
  from payroll_items i
  where i.payroll_run_id = p_run_id and i.status = 'processed'
  on conflict (employee_id, month, year) do update
    set payroll_item_id = excluded.payroll_item_id,
        payroll_run_id = excluded.payroll_run_id,
        basic = excluded.basic, hra = excluded.hra,
        special_allowance = excluded.special_allowance, gross_pay = excluded.gross_pay,
        pf_deduction = excluded.pf_deduction, esi_deduction = excluded.esi_deduction,
        professional_tax = excluded.professional_tax, net_pay = excluded.net_pay;

  get diagnostics v_count = row_count;

  perform public.notify_user(u.id, 'payslip_ready',
    'Your payslip for ' || to_char(make_date(v_run.year, v_run.month, 1), 'Mon YYYY') || ' is ready',
    null, 'payslips', s.id)
  from payslips s
  join employees e on e.id = s.employee_id
  join users u on u.id = e.user_id
  where s.payroll_run_id = p_run_id;

  insert into audit_logs (user_id, action, entity, entity_id, meta)
  values (public.app_user_id(), 'generate', 'payslips', p_run_id,
          jsonb_build_object('count', v_count));

  return v_count;
end;
$$;

create or replace function public.payroll_mark_paid(
  p_run_id integer,
  p_payment_date date default null,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
  v_date date := coalesce(p_payment_date, current_date);
begin
  -- Accounts moves the money, so accounts (or the founder) records that it moved.
  if not public.app_can_verify_payroll() then
    raise exception 'Only accounts or the founder can record a payment' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status <> 'locked' then
    raise exception 'Only a locked run can be marked paid; this one is %', v_run.status;
  end if;

  update payroll_runs
  set status = 'paid', paid_at = now(), payment_date = v_date, payment_reference = p_reference
  where id = p_run_id;

  update payslips
  set payment_status = 'paid', payment_date = v_date, payment_reference = p_reference
  where payroll_run_id = p_run_id;

  perform public.payroll_log(p_run_id, 'paid', 'locked', 'paid', p_reference);

  perform public.notify_user(u.id, 'salary_credited',
    'Salary credited for ' || to_char(make_date(v_run.year, v_run.month, 1), 'Mon YYYY'),
    'Net ' || to_char(i.net_pay, 'FM9,99,99,999.00'), 'payroll_items', i.id)
  from payroll_items i
  join employees e on e.id = i.employee_id
  join users u on u.id = e.user_id
  where i.payroll_run_id = p_run_id and i.status = 'processed';
end;
$$;


-- =============================================================================
-- Dashboard and reports
-- =============================================================================

create or replace function public.payroll_dashboard(p_month integer, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
begin
  if not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where month = p_month and year = p_year and frequency = 'monthly';

  return jsonb_build_object(
    'run_id', v_run.id,
    'run_no', v_run.run_no,
    'month', p_month,
    'year', p_year,
    'status', coalesce(v_run.status::text, 'not_started'),
    'payment_date', v_run.payment_date,
    'total_employees', (select count(*) from employees where status in ('active', 'on_notice')),
    'processed_employees', coalesce((
      select count(*) from payroll_items where payroll_run_id = v_run.id and status = 'processed'), 0),
    'pending_employees', coalesce((
      select count(*) from employees e
      where e.status in ('active', 'on_notice')
        and not exists (
          select 1 from payroll_items i
          where i.payroll_run_id = v_run.id and i.employee_id = e.id and i.status = 'processed')
    ), 0),
    'on_hold', coalesce((
      select count(*) from payroll_items where payroll_run_id = v_run.id and status = 'on_hold'), 0),
    'total_gross', coalesce(v_run.total_gross, 0),
    'total_net', coalesce(v_run.total_net, 0),
    'total_bonus', coalesce(v_run.total_bonus, 0),
    'total_deductions', coalesce(v_run.total_deductions, 0),
    'total_employer_cost', coalesce(v_run.total_employer_cost, 0),
    'pending_approvals', (
      select count(*) from payroll_runs where status in ('hr_review', 'accounts_verified')),
    'missing_bank_details', (
      select count(*) from employees e
      where e.status in ('active', 'on_notice')
        and not exists (
          select 1 from employee_bank_details b
          where b.employee_id = e.id and b.is_primary and b.verification_status = 'verified')),
    'missing_structures', (
      select count(*) from employees e
      where e.status in ('active', 'on_notice')
        and not exists (
          select 1 from salary_structures s where s.employee_id = e.id and s.status = 'active')),
    -- Chart series
    'department_salary', coalesce((
      select jsonb_agg(jsonb_build_object('department', t.name, 'gross', t.gross, 'net', t.net, 'headcount', t.n))
      from (
        select coalesce(d.name, 'Unassigned') as name,
               sum(i.gross_earnings) as gross, sum(i.net_pay) as net, count(*) as n
        from payroll_items i
        join employees e on e.id = i.employee_id
        left join departments d on d.id = e.department_id
        where i.payroll_run_id = v_run.id
        group by 1 order by 2 desc
      ) t), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', t.month, 'year', t.year, 'gross', t.total_gross, 'net', t.total_net))
      from (
        select month, year, total_gross, total_net
        from payroll_runs
        where status <> 'cancelled'
          and make_date(year, month, 1) <= make_date(p_year, p_month, 1)
        order by year desc, month desc limit 12
      ) t), '[]'::jsonb),
    'salary_distribution', coalesce((
      select jsonb_agg(jsonb_build_object('band', t.band, 'headcount', t.n) order by t.lo)
      from (
        select
          case
            when net_pay < 25000 then 'Under 25k'
            when net_pay < 50000 then '25k-50k'
            when net_pay < 100000 then '50k-1L'
            else 'Above 1L'
          end as band,
          min(case
            when net_pay < 25000 then 0 when net_pay < 50000 then 1
            when net_pay < 100000 then 2 else 3 end) as lo,
          count(*) as n
        from payroll_items where payroll_run_id = v_run.id group by 1
      ) t), '[]'::jsonb)
  );
end;
$$;

-- The statutory and management reports. One function, a `p_kind` switch, so the
-- Reports screen has a single call shape and adding a report does not add an API.
create or replace function public.payroll_report(p_kind text, p_run_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- Validated up front rather than in an ELSE branch: RAISE is a statement, and
  -- a CASE *expression* has nowhere to put one.
  if p_kind not in ('monthly', 'department', 'bonus', 'deduction', 'pf', 'esi', 'tax') then
    raise exception 'Unknown report: %', p_kind;
  end if;

  return case p_kind
    when 'monthly' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.employee_name)
      from (
        select e.full_name as employee_name, e.employee_code, d.name as department,
               i.payable_days, i.lop_days, i.gross_earnings, i.total_deductions, i.net_pay, i.status
        from payroll_items i
        join employees e on e.id = i.employee_id
        left join departments d on d.id = e.department_id
        where i.payroll_run_id = p_run_id
      ) t), '[]'::jsonb)

    when 'department' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.gross desc)
      from (
        select coalesce(d.name, 'Unassigned') as department, count(*) as headcount,
               sum(i.gross_earnings) as gross, sum(i.total_deductions) as deductions,
               sum(i.net_pay) as net
        from payroll_items i
        join employees e on e.id = i.employee_id
        left join departments d on d.id = e.department_id
        where i.payroll_run_id = p_run_id group by 1
      ) t), '[]'::jsonb)

    when 'bonus' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.total desc)
      from (
        select e.full_name as employee_name, e.employee_code,
               i.performance_bonus, i.project_bonus, i.overtime_amount,
               (i.performance_bonus + i.project_bonus + i.overtime_amount) as total
        from payroll_items i join employees e on e.id = i.employee_id
        where i.payroll_run_id = p_run_id
          and (i.performance_bonus + i.project_bonus + i.overtime_amount) > 0
      ) t), '[]'::jsonb)

    when 'deduction' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.employee_name)
      from (
        select e.full_name as employee_name, e.employee_code, i.pf_deduction, i.esi_deduction,
               i.professional_tax, i.income_tax, i.loan_deduction, i.advance_deduction,
               i.lop_deduction, i.other_deduction, i.total_deductions
        from payroll_items i join employees e on e.id = i.employee_id
        where i.payroll_run_id = p_run_id
      ) t), '[]'::jsonb)

    when 'pf' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.employee_name)
      from (
        select e.full_name as employee_name, e.employee_code, b.uan_number, b.pf_number,
               i.basic as pf_wages, i.pf_deduction as employee_share,
               i.employer_pf as employer_share, (i.pf_deduction + i.employer_pf) as total
        from payroll_items i
        join employees e on e.id = i.employee_id
        left join employee_bank_details b
          on b.employee_id = e.id and b.is_primary and b.verification_status = 'verified'
        where i.payroll_run_id = p_run_id and i.pf_deduction > 0
      ) t), '[]'::jsonb)

    when 'esi' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.employee_name)
      from (
        select e.full_name as employee_name, e.employee_code, b.esi_number,
               i.gross_earnings as esi_wages, i.esi_deduction as employee_share,
               i.employer_esi as employer_share, (i.esi_deduction + i.employer_esi) as total
        from payroll_items i
        join employees e on e.id = i.employee_id
        left join employee_bank_details b
          on b.employee_id = e.id and b.is_primary and b.verification_status = 'verified'
        where i.payroll_run_id = p_run_id and i.esi_deduction > 0
      ) t), '[]'::jsonb)

    when 'tax' then coalesce((
      select jsonb_agg(to_jsonb(t) order by t.employee_name)
      from (
        select e.full_name as employee_name, e.employee_code, b.pan_number,
               i.gross_earnings, i.professional_tax, i.income_tax
        from payroll_items i
        join employees e on e.id = i.employee_id
        left join employee_bank_details b
          on b.employee_id = e.id and b.is_primary and b.verification_status = 'verified'
        where i.payroll_run_id = p_run_id and (i.income_tax > 0 or i.professional_tax > 0)
      ) t), '[]'::jsonb)

    else '[]'::jsonb
  end;
end;
$$;

-- Salary revisions across a date range rather than a run, so it is separate.
create or replace function public.report_salary_revisions(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_can_view_payroll() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.effective_date desc)
    from (
      select e.full_name as employee_name, e.employee_code, d.name as department,
             v.previous_gross, v.new_gross, v.change_amount, v.change_percent,
             v.reason, v.effective_date,
             public.user_display_name(v.approved_by) as approved_by_name
      from salary_revisions v
      join employees e on e.id = v.employee_id
      left join departments d on d.id = e.department_id
      where v.effective_date between p_from and p_to
    ) t), '[]'::jsonb);
end;
$$;

-- The only place a full account number leaves the database. Restricted to the
-- roles that actually move money, and every call is written to audit_logs.
create or replace function public.report_bank_payment_file(p_run_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run payroll_runs;
  v_rows jsonb;
begin
  if not public.app_can_verify_payroll() then
    raise exception 'Only accounts or the founder can generate a payment file' using errcode = '42501';
  end if;

  select * into v_run from payroll_runs where id = p_run_id;
  if v_run is null then raise exception 'No payroll run with id %', p_run_id; end if;
  if v_run.status not in ('approved', 'locked', 'paid') then
    raise exception 'This run is % — a payment file is only issued once it is approved', v_run.status;
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.employee_name), '[]'::jsonb)
  into v_rows
  from (
    select e.full_name as employee_name, e.employee_code,
           i.bank_name, i.bank_account_number, i.bank_ifsc, i.net_pay as amount,
           v_run.payment_date as value_date,
           'Salary ' || to_char(make_date(v_run.year, v_run.month, 1), 'Mon YYYY') as narration
    from payroll_items i join employees e on e.id = i.employee_id
    where i.payroll_run_id = p_run_id and i.status = 'processed'
  ) t;

  insert into audit_logs (user_id, action, entity, entity_id, meta)
  values (public.app_user_id(), 'export_payment_file', 'payroll_runs', p_run_id,
          jsonb_build_object('rows', jsonb_array_length(v_rows)));

  return jsonb_build_object(
    'run_no', v_run.run_no,
    'payment_date', v_run.payment_date,
    'total_amount', (select coalesce(sum((r ->> 'amount')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'company', (select to_jsonb(c) from (
      select company_name, bank_name, account_number, ifsc_code
      from company_bank_details where is_primary limit 1) c),
    'rows', v_rows
  );
end;
$$;


-- =============================================================================
-- Execute grants
--
-- Functions are executable by PUBLIC on creation, which includes anon. Every
-- payroll routine authorises its caller through app_role(), and app_role()
-- returns null for anon — but an unauthenticated request should not reach the
-- check at all, so anon is stripped explicitly.
-- =============================================================================

revoke execute on function
  public.get_company_bank_details(),
  public.upsert_company_bank_details(integer, jsonb),
  public.verify_company_bank_details(integer),
  public.get_employee_bank_details(integer),
  public.list_employee_bank_details(text),
  public.submit_employee_bank_details(integer, jsonb),
  public.verify_employee_bank_details(integer, boolean, text),
  public.upsert_salary_structure(integer, jsonb),
  public.salary_history(integer),
  public.payroll_create_run(integer, integer),
  public.payroll_compute(integer),
  public.payroll_submit(integer, text),
  public.payroll_verify(integer, text),
  public.payroll_approve(integer, text),
  public.payroll_reject(integer, text),
  public.payroll_lock(integer),
  public.payroll_reopen(integer, text),
  public.payroll_hold_item(integer, text),
  public.payroll_generate_payslips(integer),
  public.payroll_mark_paid(integer, date, text),
  public.payroll_dashboard(integer, integer),
  public.payroll_report(text, integer),
  public.report_salary_revisions(date, date),
  public.report_bank_payment_file(integer)
from anon;
