-- =============================================================================
-- Neon 0019 — Secure Password Change and Session Invalidation
--
-- C2 finding: password change endpoint previously accepted new password only,
-- without server-side verification of current password.
-- This migration:
--   1. Adds password_changed_at and token_version to users for session revocation.
--   2. Adds change_own_password(current_password, new_password) requiring proof
--      of current password before altering hash.
--   3. Logs security events on success and failure.
--   4. Updates resolve_session() to return session validation timestamps.
-- =============================================================================

alter table public.users add column if not exists password_changed_at timestamptz;
alter table public.users add column if not exists token_version integer not null default 1;

-- Update resolve_session to include password_changed_at and token_version
drop function if exists public.resolve_session(integer);

create or replace function public.resolve_session(p_user_id integer)
returns table (
  user_id integer,
  email text,
  company_id integer,
  role text,
  employee_id integer,
  support_company_id integer,
  password_changed_at timestamptz,
  token_version integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    u.id,
    u.email::text,
    u.company_id,
    r.name::text,
    e.id,
    (select s.company_id
       from support_sessions s
      where s.super_admin_user_id = u.id and s.ended_at is null
      order by s.started_at desc
      limit 1),
    u.password_changed_at,
    coalesce(u.token_version, 1)
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where u.id = p_user_id and u.is_active
$$;

grant execute on function public.resolve_session(integer) to hrms_app;

-- Secure password change function requiring current password
create or replace function public.change_own_password(
  p_current_password text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer := public.app_user_id();
  v_hash text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_current_password is null or length(p_current_password) = 0 then
    raise exception 'Current password is required' using errcode = '42501';
  end if;

  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'New password must be at least 8 characters' using errcode = '22023';
  end if;

  if p_current_password = p_new_password then
    raise exception 'New password must be different from current password' using errcode = '22023';
  end if;

  select password_hash into v_hash
    from public.users
   where id = v_user_id;

  if v_hash is null or v_hash <> crypt(p_current_password, v_hash) then
    perform public.log_security_event('password.change_failed', 'users', v_user_id, jsonb_build_object('reason', 'incorrect_password'), null, null, 'failure');
    raise exception 'Current password is incorrect' using errcode = '42501';
  end if;

  update public.users
     set password_hash = crypt(p_new_password, gen_salt('bf', 12)),
         password_changed_at = clock_timestamp(),
         token_version = coalesce(token_version, 1) + 1
   where id = v_user_id;

  perform public.log_security_event('password.changed', 'users', v_user_id, null, null, null, 'success');
end;
$$;

revoke all on function public.change_own_password(text, text) from public;
grant execute on function public.change_own_password(text, text) to hrms_app;

-- Deprecate the old 1-argument set_own_password so it cannot bypass verification
create or replace function public.set_own_password(p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'set_own_password is deprecated. Use change_own_password(current_password, new_password).'
    using errcode = '42501';
end;
$$;
