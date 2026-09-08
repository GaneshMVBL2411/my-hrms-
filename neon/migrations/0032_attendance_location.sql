-- Where a punch was made from.
--
-- 0014 gave an attendance record a method and a photograph — proof that a
-- particular person marked it. This adds the other half of the question a
-- reviewer actually asks: not only who, but where from.
--
-- Stored as plain latitude, longitude and accuracy rather than a geography
-- type, because nothing here does geometry. The only questions asked of it are
-- "where was this" and "how much should I trust that", and PostGIS would be a
-- dependency added to hold two numbers.
--
-- ACCURACY IS STORED, AND THAT IS THE POINT
--
-- A phone indoors can be a hundred metres out, and a fix taken from wifi or a
-- cell tower can be far worse. A pair of coordinates on their own invites
-- someone to read a punch as "not at the office" when the reading was never
-- good enough to say so. Keeping the radius the device reported means the
-- record carries its own uncertainty instead of implying a precision it does
-- not have.
--
-- A NULL LOCATION IS A NORMAL RECORD, NOT A SUSPICIOUS ONE
--
-- Location permission is the employee's to refuse, and it is refused for
-- reasons that have nothing to do with attendance. A punch with no coordinates
-- is still a punch: the biometric signature is what authorises it, and that is
-- unchanged here. Nothing below makes a location required, and the columns are
-- nullable for that reason rather than by omission.

alter table public.attendance_records
  add column if not exists check_in_latitude   numeric(9, 6),
  add column if not exists check_in_longitude  numeric(9, 6),
  add column if not exists check_in_accuracy_m numeric(7, 1),
  add column if not exists check_out_latitude   numeric(9, 6),
  add column if not exists check_out_longitude  numeric(9, 6),
  add column if not exists check_out_accuracy_m numeric(7, 1);

-- Refuses a reading that is not a point on Earth. A client sending nonsense
-- should fail here rather than be plotted somewhere in the Pacific.
alter table public.attendance_records
  drop constraint if exists attendance_records_location_range;
alter table public.attendance_records
  add constraint attendance_records_location_range check (
    (check_in_latitude is null or check_in_latitude between -90 and 90)
    and (check_in_longitude is null or check_in_longitude between -180 and 180)
    and (check_out_latitude is null or check_out_latitude between -90 and 90)
    and (check_out_longitude is null or check_out_longitude between -180 and 180)
  );

/**
 * Check in, with the place it happened.
 *
 * The location parameters default to null and sit at the end of the argument
 * list, so the existing two-argument call still resolves and any caller that
 * has nothing to say about location keeps working unchanged.
 *
 * Written by the same SECURITY DEFINER function that writes the punch, so a
 * caller cannot record a check-in and then separately amend where it came
 * from: the coordinates arrive with the punch or not at all.
 */
create or replace function public.attendance_check_in_verified(
  p_method     public.attendance_method_enum,
  p_photo_id   uuid default null,
  p_latitude   numeric default null,
  p_longitude  numeric default null,
  p_accuracy_m numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_company_id  integer := public.app_company_id();
  v_today       date    := (now() at time zone 'utc')::date;
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
$$;

create or replace function public.attendance_check_out_verified(
  p_method     public.attendance_method_enum,
  p_photo_id   uuid default null,
  p_latitude   numeric default null,
  p_longitude  numeric default null,
  p_accuracy_m numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id integer := public.app_employee_id();
  v_today       date    := (now() at time zone 'utc')::date;
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
$$;

-- The two-argument forms are now shadowed by these. Dropped rather than left
-- in place, so there is one definition of what a verified punch writes and no
-- chance of a caller reaching an older one that silently discards a location.
drop function if exists public.attendance_check_in_verified(public.attendance_method_enum, uuid);
drop function if exists public.attendance_check_out_verified(public.attendance_method_enum, uuid);

revoke all on function public.attendance_check_in_verified(
  public.attendance_method_enum, uuid, numeric, numeric, numeric) from public;
revoke all on function public.attendance_check_out_verified(
  public.attendance_method_enum, uuid, numeric, numeric, numeric) from public;
grant execute on function public.attendance_check_in_verified(
  public.attendance_method_enum, uuid, numeric, numeric, numeric) to hrms_app;
grant execute on function public.attendance_check_out_verified(
  public.attendance_method_enum, uuid, numeric, numeric, numeric) to hrms_app;

-- The reviewer's view carries the coordinates so the attendance page can show
-- where a punch came from without a second query. working_hours and is_late are
-- carried over character for character rather than retyped: each has a
-- correction in it that is easy to lose that way.
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
       coalesce((a.check_in at time zone 'utc'::text)::time without time zone > '09:30:00'::time without time zone, false) as is_late,
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

-- ------------------------------------------------------------- diagnostics
select count(*) filter (where column_name like 'check_in_l%' or column_name like 'check_out_l%') as location_columns,
       count(*) filter (where column_name like '%accuracy%') as accuracy_columns
  from information_schema.columns
 where table_schema = 'public' and table_name = 'attendance_records';
