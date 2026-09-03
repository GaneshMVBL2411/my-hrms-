-- ---------------------------------------------------------------------------
-- Biometric attendance: WebAuthn credentials, and a check-in that records how
-- it was verified.
--
-- What is stored, and what deliberately is not
--
-- No fingerprint, no face, no biometric template of any kind lands in this
-- database. The phone keeps those in its secure element and never releases
-- them; what it hands over is a public key and, on each check-in, a signature
-- over a challenge this server issued. So the server can prove a specific
-- enrolled device consented, without ever holding anything that could identify
-- a person biometrically — which keeps the whole feature outside the sensitive
-- personal data obligations that storing face templates would bring with it,
-- under India's DPDP Act and the GDPR alike.
--
-- The selfie taken at check-in is a different thing and is treated as one: it
-- is evidence for a human reviewing the log, not the gate. Nothing authorises
-- on the strength of it.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------- webauthn_credentials
create table if not exists public.webauthn_credentials (
  id             serial primary key,
  user_id        integer not null references public.users(id) on delete cascade,
  -- The credential id the authenticator generated, base64url as the browser
  -- reports it. Unique across the table: one physical authenticator enrols
  -- once, and a replay from another account has nowhere to land.
  credential_id  text not null unique,
  public_key     bytea not null,
  -- Bumped by the authenticator on every assertion. A counter that fails to
  -- advance is the signal of a cloned credential, so it is checked and stored
  -- on each verification rather than merely recorded.
  counter        bigint not null default 0,
  -- 'platform' is the phone's own Face ID / Touch ID / Android biometrics;
  -- 'cross-platform' would be a security key. Kept for display, so someone can
  -- tell their devices apart when revoking one.
  transports     text,
  device_label   text,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  company_id     integer not null references public.companies(id) on delete cascade
);

create index if not exists idx_webauthn_credentials_user on public.webauthn_credentials(user_id);

alter table public.webauthn_credentials enable row level security;

-- A credential is only ever the business of the person it belongs to. Not HR,
-- not the founder: there is nothing here anyone else needs, and a policy that
-- let an admin read the table would be a policy that let them enrol a device
-- against someone else's account.
drop policy if exists webauthn_credentials_own on public.webauthn_credentials;
create policy webauthn_credentials_own on public.webauthn_credentials
  for all
  using (user_id = public.app_user_id())
  with check (user_id = public.app_user_id() and company_id = public.app_company_id());

-- ------------------------------------------- how a check-in was verified
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_method_enum') then
    create type public.attendance_method_enum as enum ('manual', 'biometric');
  end if;
end
$$;

alter table public.attendance_records
  add column if not exists check_in_method  public.attendance_method_enum not null default 'manual',
  add column if not exists check_out_method public.attendance_method_enum not null default 'manual',
  -- The selfie, held as a files row rather than bytes in this table: the photos
  -- are large, and the attendance record is read constantly by summaries and
  -- reports that have no use for them.
  add column if not exists check_in_photo_id  uuid references public.files(id) on delete set null,
  add column if not exists check_out_photo_id uuid references public.files(id) on delete set null;

-- ------------------------------------------------------- check in and out
-- Both mirror the existing manual functions exactly, and differ only in
-- recording how the punch was verified and what it was photographed with.
-- Deliberately separate rather than adding parameters to the originals: the
-- manual ones are called from the desktop app and must keep working untouched,
-- and a caller that cannot say "this was biometric" cannot accidentally claim
-- that it was.
create or replace function public.attendance_check_in_verified(
  p_method   public.attendance_method_enum,
  p_photo_id uuid default null
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
    (employee_id, date, check_in, status, company_id, check_in_method, check_in_photo_id)
  values
    (v_employee_id, v_today, now(), 'present', v_company_id, p_method, p_photo_id)
  on conflict (employee_id, date) do update
    set check_in           = excluded.check_in,
        status             = 'present',
        check_in_method    = excluded.check_in_method,
        check_in_photo_id  = excluded.check_in_photo_id
    where attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Already checked in today';
  end if;

  return v_id;
end;
$$;

create or replace function public.attendance_check_out_verified(
  p_method   public.attendance_method_enum,
  p_photo_id uuid default null
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
     set check_out           = now(),
         check_out_method    = p_method,
         check_out_photo_id  = p_photo_id
   where employee_id = v_employee_id
     and date = v_today
     and check_in is not null
     and check_out is null
  returning id into v_id;

  if v_id is null then
    raise exception 'Not checked in, or already checked out today';
  end if;

  return v_id;
end;
$$;

revoke all on function public.attendance_check_in_verified(public.attendance_method_enum, uuid) from public;
revoke all on function public.attendance_check_out_verified(public.attendance_method_enum, uuid) from public;
grant execute on function public.attendance_check_in_verified(public.attendance_method_enum, uuid) to hrms_app;
grant execute on function public.attendance_check_out_verified(public.attendance_method_enum, uuid) to hrms_app;

-- The detail view feeds the attendance page; add the new columns so a reviewer
-- can see which punches were biometric without a second query.
--
-- working_hours and is_late are carried over character for character from the
-- existing view, not rewritten. Both have corrections in them that are easy to
-- drop by retyping: working_hours clamps at zero with GREATEST, so a check-out
-- edited to before the check-in reports 0 rather than a negative shift, and
-- is_late coalesces to false, so a row with no check-in is "not late" rather
-- than null — which is what the page's badge logic expects.
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
       a.check_out_photo_id
  from public.attendance_records a
  join public.employees e on e.id = a.employee_id;

alter view public.attendance_detail set (security_invoker = true);
grant select on public.attendance_detail to hrms_app;
grant select, insert, update, delete on public.webauthn_credentials to hrms_app;
grant usage, select on sequence public.webauthn_credentials_id_seq to hrms_app;
