-- =============================================================================
-- Neon 0042 — Attendance runs on the office's clock, not on UTC
--
-- Every attendance date and the lateness flag were computed as
-- `(now() at time zone 'utc')`, which treats the stored UTC instant as though
-- it were local. The office is UTC+05:30, so:
--
--   * is_late compared a UTC time to 09:30. Someone arriving at 12:09 IST
--     punches at 06:39 UTC, and the view called that on time. Practically
--     every real late arrival was reported as punctual.
--   * A punch before 05:30 IST resolved to the previous calendar day, so an
--     early check-in opened — or reopened — yesterday's row, and the
--     check-out that evening then failed to find an open punch for "today".
--
-- Both become right by asking for the date and the time in the zone the
-- office actually keeps. That zone is a function rather than a literal so a
-- company in another one has a single line to change, here and in the Excel
-- report (see OFFICE.timeZone in server/src/attendance-report.ts, which
-- already computed this correctly and disagreed with the view as a result).
--
-- The four punch functions are reproduced from their live definitions with
-- only that expression changed; nothing else about what they write moves.
-- =============================================================================

create or replace function public.office_time_zone()
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$ select 'Asia/Kolkata'::text $$;

revoke all on function public.office_time_zone() from public;
grant execute on function public.office_time_zone() to hrms_app;

-- ------------------------------------------------------------------ punches
CREATE OR REPLACE FUNCTION public.attendance_check_in(p_photo_id uuid DEFAULT NULL::uuid, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id  integer := public.app_company_id();
  v_today       date    := (now() at time zone public.office_time_zone())::date;
  v_id          integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  insert into attendance_records
    (company_id, employee_id, date, check_in, status,
     check_in_photo_id, check_in_latitude, check_in_longitude, check_in_accuracy_m)
  values
    (v_company_id, v_employee_id, v_today, now(), 'present',
     p_photo_id, p_latitude, p_longitude, p_accuracy_m)
  on conflict (employee_id, date) do update
    set check_in            = excluded.check_in,
        status              = 'present',
        check_in_photo_id   = excluded.check_in_photo_id,
        check_in_latitude   = excluded.check_in_latitude,
        check_in_longitude  = excluded.check_in_longitude,
        check_in_accuracy_m = excluded.check_in_accuracy_m
    where attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Already checked in today';
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_check_out(p_photo_id uuid DEFAULT NULL::uuid, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id integer := public.app_employee_id();
  v_today       date    := (now() at time zone public.office_time_zone())::date;
  v_id          integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  update attendance_records
     set check_out            = now(),
         check_out_photo_id   = p_photo_id,
         check_out_latitude   = p_latitude,
         check_out_longitude  = p_longitude,
         check_out_accuracy_m = p_accuracy_m
   where employee_id = v_employee_id
     and date = v_today
     and check_in is not null
     and check_out is null
  returning id into v_id;

  if v_id is null then
    raise exception 'No open check-in to close today';
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_check_in_verified(p_method attendance_method_enum, p_photo_id uuid DEFAULT NULL::uuid, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id  integer := public.app_company_id();
  v_today       date    := (now() at time zone public.office_time_zone())::date;
  v_id          integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  insert into attendance_records
    (employee_id, date, check_in, status, company_id, check_in_method, check_in_photo_id,
     check_in_latitude, check_in_longitude, check_in_accuracy_m)
  values
    (v_employee_id, v_today, now(), 'present', v_company_id, p_method, p_photo_id,
     p_latitude, p_longitude, p_accuracy_m)
  on conflict (employee_id, date) do update
    set check_in            = excluded.check_in,
        status              = 'present',
        check_in_method     = excluded.check_in_method,
        check_in_photo_id   = excluded.check_in_photo_id,
        check_in_latitude   = excluded.check_in_latitude,
        check_in_longitude  = excluded.check_in_longitude,
        check_in_accuracy_m = excluded.check_in_accuracy_m
    where attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Already checked in today';
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_check_out_verified(p_method attendance_method_enum, p_photo_id uuid DEFAULT NULL::uuid, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_accuracy_m numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id integer := public.app_employee_id();
  v_today       date    := (now() at time zone public.office_time_zone())::date;
  v_id          integer;
begin
  if v_employee_id is null then
    raise exception 'No employee profile linked to this account';
  end if;

  update attendance_records
     set check_out            = now(),
         check_out_method     = p_method,
         check_out_photo_id   = p_photo_id,
         check_out_latitude   = p_latitude,
         check_out_longitude  = p_longitude,
         check_out_accuracy_m = p_accuracy_m
   where employee_id = v_employee_id
     and date = v_today
     and check_in is not null
     and check_out is null
  returning id into v_id;

  if v_id is null then
    raise exception 'No open check-in to close today';
  end if;

  return v_id;
end;
$function$;

-- --------------------------------------------------------------------- view
-- Rebuilt only to move is_late onto the office clock. working_hours is a
-- difference between two instants and was never affected by the zone.
create or replace view public.attendance_detail as
select a.id,
       a.employee_id,
       e.full_name as employee_name,
       a.date,
       a.check_in,
       a.check_out,
       a.break_minutes,
       a.status,
       case
         when a.check_in is null or a.check_out is null then null::numeric
         else round(greatest(extract(epoch from a.check_out - a.check_in) - (a.break_minutes * 60)::numeric, 0::numeric) / 3600.0, 2)
       end as working_hours,
       coalesce((a.check_in at time zone public.office_time_zone())::time without time zone > '09:30:00'::time without time zone, false) as is_late,
       a.check_in_method,
       a.check_out_method,
       a.check_in_photo_id,
       a.check_out_photo_id,
       a.check_in_latitude,
       a.check_in_longitude,
       a.check_in_accuracy_m,
       a.check_out_latitude,
       a.check_out_longitude,
       a.check_out_accuracy_m
  from public.attendance_records a
  join public.employees e on e.id = a.employee_id;

alter view public.attendance_detail set (security_invoker = true);
grant select on public.attendance_detail to hrms_app;

-- ------------------------------------------------------------------ summary
-- "Today" on the dashboard means today in the office. Reproduced from the
-- live definition with only the default date changed.
create or replace function public.attendance_summary(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone public.office_time_zone())::date);
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

-- ------------------------------------------------------------- diagnostics
select public.office_time_zone() as office_zone,
       (now() at time zone public.office_time_zone())::date as office_today,
       (now() at time zone 'utc')::date as utc_today;
