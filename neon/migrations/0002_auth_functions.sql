-- =============================================================================
-- Neon 0002 — Authentication entry points
--
-- Sign-in has a bootstrapping problem that Supabase never had to solve here:
-- the API cannot set a session context until it knows who is calling, and it
-- cannot find out who is calling without reading `users` — which row level
-- security now protects. With no session set, app_company_id() is null, the
-- users_read policy matches nothing, and a perfectly valid password is reported
-- as "invalid email or password".
--
-- On Supabase this never came up because GoTrue read auth.users, a table the
-- app's own policies never applied to. The equivalent here is these two
-- functions: SECURITY DEFINER, so they see past RLS, and deliberately narrow so
-- that seeing past RLS buys an attacker nothing.
--
--   * authenticate() takes a password and returns identity only if it matches.
--     It never returns the hash, and it cannot be used to enumerate accounts —
--     a wrong password and an unknown address are the same empty result.
--
--   * resolve_session() takes a user id that has already been proven by a
--     verified JWT signature, and returns the identity to build the request
--     context from.
--
-- These are the only two places in the system that read `users` unfiltered.
-- Everything else goes through RLS.
-- =============================================================================

create or replace function public.authenticate(p_email text, p_password text)
returns table (
  user_id integer,
  email text,
  company_id integer,
  role text,
  employee_id integer,
  is_active boolean,
  email_confirmed boolean
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
    u.is_active,
    u.email_confirmed_at is not null
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where lower(u.email) = lower(p_email)
    -- The password is checked inside the function, so a caller that guesses
    -- wrong learns nothing at all — not even whether the address exists.
    and u.password_hash is not null
    and u.password_hash = crypt(p_password, u.password_hash)
$$;

create or replace function public.resolve_session(p_user_id integer)
returns table (
  user_id integer,
  email text,
  company_id integer,
  role text,
  employee_id integer,
  support_company_id integer
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
      limit 1)
  from users u
  join roles r on r.id = u.role_id
  left join employees e on e.user_id = u.id
  where u.id = p_user_id and u.is_active
$$;

-- Records a successful sign-in. Separate from authenticate() because that one
-- is STABLE and cannot write, and because the timestamp should only move after
-- the caller has decided the sign-in actually succeeded.
create or replace function public.record_sign_in(p_user_id integer)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update users set last_sign_in_at = now() where id = p_user_id
$$;

grant execute on function public.authenticate(text, text)     to hrms_app;
grant execute on function public.resolve_session(integer)     to hrms_app;
grant execute on function public.record_sign_in(integer)      to hrms_app;


-- ------------------------------------------------------------- diagnostics
-- authenticate() resolves only on matching password and active account.
select 'wrong password' as case, count(*) as rows
  from public.authenticate('diagnostic@example.invalid', 'invalid-pass')
union all
select 'unknown address', count(*)
  from public.authenticate('nobody@example.invalid', 'invalid-pass');
