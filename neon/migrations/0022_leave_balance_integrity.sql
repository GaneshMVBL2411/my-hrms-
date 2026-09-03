-- =============================================================================
-- Neon 0022 — Check the balance before approving leave
--
-- M6 finding, left open by 0020. That migration correctly stopped HR approving
-- their own requests and started logging the decision, but the deduction below
-- it was untouched:
--
--   update leave_balances set used_days = used_days + v_request.days_count
--    where employee_id = ... and leave_type_id = ... and year = ...
--
-- Nothing read the balance first, and nothing checked the update hit anything.
-- Two ways that goes wrong, and the quiet one is the worse one:
--
--   Overdraw  used_days climbs past allocated_days, so leave_balance_detail —
--             which computes allocated_days - used_days — reports a NEGATIVE
--             remaining balance. Nobody is stopped; it is discovered later.
--
--   No-op     if no row matches (the request spans into a year with no balance
--             row, or the leave type was added after balances were seeded) the
--             UPDATE affects ZERO rows. The leave is approved, the audit entry
--             says approved, and NOTHING IS DEDUCTED. Silently, with no error
--             and no way to notice except by reconciling by hand.
--
-- Both are fixed by reading the row first, locking it, and refusing rather than
-- guessing. A missing balance row is now an error the approver can act on
-- ("no leave balance configured") instead of a free holiday.
--
-- On the deliberate strictness: leave beyond the allocation is refused rather
-- than allowed-and-flagged. A company that wants unpaid leave models it as a
-- leave type with its own allocation, which is how the rest of this schema
-- already works — it should not arrive as an unexplained negative number.
-- =============================================================================

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
  v_balance leave_balances;
  v_year integer;
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

  -- M6: everything that can refuse the approval runs BEFORE anything is
  -- written, so a refusal leaves the request pending rather than approved-but-
  -- undeducted. Only reached when approving; a rejection touches no balance.
  if p_approve then
    v_year := extract(year from v_request.start_date);

    -- Locked for the same reason the request is: two approvers acting at once
    -- would otherwise both read the same used_days and both write it back.
    select * into v_balance from leave_balances
     where employee_id  = v_request.employee_id
       and leave_type_id = v_request.leave_type_id
       and year          = v_year
       and company_id    = v_request.company_id
     for update;

    if v_balance.id is null then
      raise exception
        'No % leave balance is configured for this employee for %. Add one before approving.',
        (select name from leave_types where id = v_request.leave_type_id), v_year
        using errcode = 'P0002';
    end if;

    if v_balance.used_days + v_request.days_count > v_balance.allocated_days then
      raise exception
        'Not enough leave balance: % day(s) requested, % of % remaining.',
        v_request.days_count,
        v_balance.allocated_days - v_balance.used_days,
        v_balance.allocated_days;
    end if;
  end if;

  update leave_requests set
    status = case when p_approve then 'approved'::leave_status_enum else 'rejected'::leave_status_enum end,
    decided_by = v_caller_user_id,
    decided_at = clock_timestamp()
  where id = p_id;

  if p_approve then
    -- Addressed by primary key: the row was located and locked above, so this
    -- cannot silently match nothing the way the predicate-based update could.
    update leave_balances
       set used_days = used_days + v_request.days_count
     where id = v_balance.id;
  end if;

  -- H5: Mandatory compliance audit logging
  perform public.log_security_event(
    case when p_approve then 'leave.approved' else 'leave.rejected' end,
    'leave_requests',
    p_id,
    jsonb_build_object(
      'days', v_request.days_count,
      'employee_id', v_request.employee_id,
      'decided_by', v_caller_user_id,
      -- Recorded so the trail shows what the balance was at the moment of the
      -- decision, not merely that a decision happened.
      'balance_after', case when p_approve
        then v_balance.allocated_days - (v_balance.used_days + v_request.days_count)
        else null end
    )
  );

  return p_id;
end;
$$;

revoke all on function public.decide_leave_request(integer, boolean) from public;
grant execute on function public.decide_leave_request(integer, boolean) to authenticated, hrms_app;


-- ------------------------------------------------------------- diagnostics
-- Any row here is an employee already carrying a negative balance from before
-- this migration — approved leave that was never covered by an allocation.
select b.employee_id, t.name as leave_type, b.year,
       b.allocated_days, b.used_days,
       b.allocated_days - b.used_days as remaining
from leave_balances b
join leave_types t on t.id = b.leave_type_id
where b.used_days > b.allocated_days
order by remaining;
