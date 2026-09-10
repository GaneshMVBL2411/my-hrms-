-- A photo on a punch made from the browser.
--
-- The web's Check In recorded a time and nothing else, while the phone
-- attached a selfie and coordinates. The gap was not deliberate — it is where
-- the two clients were built, not a decision about what a punch is worth.
--
-- WHY THIS STAYS 'manual' AND DOES NOT BECOME 'biometric'
--
-- Routing the browser through attendance_check_in_verified would have been
-- less work and would have written check_in_method = 'biometric'. That would
-- be false. Nothing in a browser punch is verified: there is no signed
-- challenge, no key held behind a fingerprint, nobody proved who they were.
-- A photograph is evidence attached to a punch, not the thing that authorises
-- one — the same reason the native app takes its selfie *after* the signature
-- rather than instead of it.
--
-- So the method stays what it honestly is. Someone reviewing attendance can
-- still tell the two apart, which is the entire point of recording the method
-- at all, and a photo now exists for both.

/**
 * Check in, optionally with a photograph and a place.
 *
 * Every parameter defaults to null and the method is untouched, so this
 * remains a manual punch that may carry evidence rather than a new kind of
 * punch. A caller with nothing to attach behaves exactly as before.
 */
create or replace function public.attendance_check_in(
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
$$;

create or replace function public.attendance_check_out(
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

-- The no-argument forms are shadowed by these, since every parameter has a
-- default. Dropped so there is one definition of what a manual punch writes,
-- and no older one a caller could reach that would quietly discard a photo.
drop function if exists public.attendance_check_in();
drop function if exists public.attendance_check_out();

revoke all on function public.attendance_check_in(uuid, numeric, numeric, numeric) from public;
revoke all on function public.attendance_check_out(uuid, numeric, numeric, numeric) from public;
grant execute on function public.attendance_check_in(uuid, numeric, numeric, numeric) to hrms_app;
grant execute on function public.attendance_check_out(uuid, numeric, numeric, numeric) to hrms_app;

-- ------------------------------------------------------------- diagnostics
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('attendance_check_in', 'attendance_check_out')
 order by p.proname;
