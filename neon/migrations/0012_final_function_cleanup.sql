-- =============================================================================
-- Neon 0012 — Two things the audit in 0011 exposed
--
-- Listing every SECURITY DEFINER function and whether it mentions a company is
-- a cheap check that turned out to be worth running: it found one function
-- nobody had scoped, and one that existed twice.
--
--   1. attendance_check_out — missed by every earlier pass. Less exposed than
--      it looks, because it resolves the row through app_employee_id() and an
--      employee belongs to exactly one company. Scoped anyway: relying on a
--      second table's uniqueness to keep a tenant boundary is the kind of
--      reasoning that stops being true after a schema change nobody connects
--      to this function.
--
--   2. next_employee_code — the zero-argument original from 0003 still exists
--      alongside the per-company version. Postgres overloads on signature, so
--      both are live, and the old one still numbers from a global count. Any
--      caller that has not been updated silently produces WP-1008 for a second
--      company's first hire. Dropped, so such a call fails loudly instead.
-- =============================================================================

create or replace function public.attendance_check_out()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_company integer := public.app_company_id();
  v_today date := (now() at time zone 'utc')::date;
  v_record attendance_records;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  select * into v_record from attendance_records
  where employee_id = v_employee_id and date = v_today
    and company_id = v_company;

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


-- The old signature. Dropping it means a stale caller gets
-- "function next_employee_code() does not exist" rather than a wrong code.
drop function if exists public.next_employee_code();


-- ------------------------------------------------------------- diagnostics
-- What remains unscoped, and why each is legitimate:
--   app_employee_id, app_role, app_is_hr, app_is_founder, app_manages_*
--                        resolve the caller, not tenant data
--   record_sign_in, set_own_password
--                        act on the caller's own row, keyed by app_user_id()
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.prosecdef
  and pg_get_functiondef(p.oid) not ilike '%company_id%'
order by p.proname;
