-- ---------------------------------------------------------------------------
-- Technical controls for ISO/IEC 27001:2022 Annex A.
--
-- Three findings from assessing the running system, and the fix for each. The
-- standard itself is a management system — risk assessment, policy, internal
-- audit, management review — and none of that lives in SQL. What follows is
-- only the part a database can be responsible for.
--
--   A.8.24  Use of cryptography
--           Every one of the nine stored passwords is bcrypt cost 6. That is
--           64 rounds where current guidance is 4,096 or more, and it is not a
--           historical accident: the functions that set passwords all call
--           gen_salt('bf') with no cost, and this server's default is 6. New
--           passwords were being created just as weak as the old ones.
--
--   A.8.15  Logging
--           audit_logs exists, is append-only, and is readable by HR — a
--           thoroughly sensible design that nothing has ever written a row to.
--           An audit table with no rows provides no accountability and no
--           detection; it only looks like it does, which is worse than an
--           obvious absence.
--
--   A.5.17  Authentication information
--           Passwords upgrade only when someone changes one. Since nobody will,
--           the rehash has to happen at sign-in, where the plaintext is briefly
--           available and can be re-stored at the stronger cost.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------- A.8.24 cost 12
-- 12 is the usual recommendation: roughly a quarter-second per verification on
-- current hardware, which is unnoticeable at sign-in and expensive enough to
-- make offline cracking of a stolen hash impractical. Stated explicitly rather
-- than relying on gen_salt's default, which is what produced cost 6 here and
-- would silently produce something else on another server.
create or replace function public.set_own_password(p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id integer := public.app_user_id();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  update users
     set password_hash = crypt(p_new_password, gen_salt('bf', 12))
   where id = v_user_id;

  perform public.log_security_event('password.changed', 'users', v_user_id, null);
end;
$$;

create or replace function public.set_employee_password(p_employee_id integer, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_user_id integer;
begin
  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  select e.user_id into v_user_id
    from employees e
   where e.id = p_employee_id and e.company_id = v_company;

  if v_user_id is null then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  if not public.app_is_hr() and v_user_id <> public.app_user_id() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  update users set password_hash = crypt(p_new_password, gen_salt('bf', 12)) where id = v_user_id;

  -- Worth its own action name: someone resetting another person's password is
  -- a different event from changing your own, and an auditor reviewing the log
  -- should not have to infer which happened.
  perform public.log_security_event('password.reset_by_admin', 'users', v_user_id, null);
end;
$$;

-- ------------------------------------------------- A.8.15 security logging
/**
 * Records a security-relevant event.
 *
 * SECURITY DEFINER because the most important events happen when there is no
 * session to attribute them to. audit_logs_insert requires
 * user_id = app_user_id(), which a failed sign-in cannot satisfy — and a failed
 * sign-in is precisely what an auditor most wants to see. This writes past that
 * policy deliberately, and is the only thing that may.
 *
 * The table is already append-only: update and delete are revoked, so a row
 * written here cannot later be edited or quietly removed, including by whoever
 * caused it.
 */
-- The four-argument first attempt is replaced, not left beside this one: two
-- overloads differing only in optional arguments is an ambiguity waiting to
-- pick the wrong one.
drop function if exists public.log_security_event(text, text, integer, jsonb);

create or replace function public.log_security_event(
  p_action text,
  p_entity text,
  p_entity_id integer default null,
  p_meta jsonb default null,
  -- Lets a failed sign-in be attributed to a company when there is no session
  -- to read one from.
  p_email text default null,
  p_ip text default null,
  p_result text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_user_id integer := public.app_user_id();
begin
  -- audit_logs.company_id is NOT NULL, and a sign-in that failed has no
  -- session to take a company from. The address is the only thing known at
  -- that point, so it is what resolves the tenant.
  if v_company is null and p_email is not null then
    select u.company_id, coalesce(v_user_id, u.id)
      into v_company, v_user_id
      from users u
     where lower(u.email) = lower(p_email);
  end if;

  -- An attempt against an address that belongs to no company — a guessed or
  -- invented one — cannot be filed against a tenant, and this table is
  -- per-tenant by design. Dropping it is the honest outcome; the alternative
  -- is inventing a company for a row that belongs to none.
  if v_company is null then return; end if;

  insert into audit_logs (user_id, action, entity, entity_id, meta, company_id, ip_address, result)
  values (
    v_user_id, p_action, p_entity, p_entity_id, p_meta, v_company,
    -- A malformed forwarded header must not cost the log its row.
    case when p_ip is null then null else
      (select case when p_ip ~ '^[0-9a-fA-F:.]+$' then p_ip::inet else null end)
    end,
    p_result
  );
exception
  -- Logging must never be the reason an operation fails. A full disk or a
  -- constraint change should cost the audit trail a row, not stop someone
  -- signing in — the alternative is a logging bug becoming an outage.
  --
  -- It is also why the first version of this function failed invisibly: it
  -- omitted company_id, the NOT NULL rejected every row, and this handler
  -- swallowed it. Anything relying on these events must verify they arrive
  -- rather than trust that the call returned.
  when others then null;
end;
$$;

revoke all on function public.log_security_event(text, text, integer, jsonb, text, text, text) from public;
grant execute on function public.log_security_event(text, text, integer, jsonb, text, text, text) to hrms_app;

-- --------------------------------------------- A.5.17 rehash on sign-in
/**
 * Re-stores a password at the current cost, if it is stored below it.
 *
 * Called by the API immediately after a successful sign-in, which is the only
 * moment the plaintext exists to hash again. Verifies the password itself
 * rather than trusting the caller: this function can set a password hash, so
 * it must not be usable to set one for an account whose password is unknown.
 *
 * Returns true only when an upgrade actually happened, so the caller can log it
 * without inventing an event that did not occur.
 */
create or replace function public.upgrade_password_hash(p_email text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
  v_hash text;
  v_cost integer;
  v_company integer;
begin
  select u.id, u.password_hash, u.company_id into v_id, v_hash, v_company
    from users u
   where lower(u.email) = lower(p_email) and u.password_hash is not null;

  if v_id is null then return false; end if;

  -- Proof the caller holds the password. Without this, anyone able to call the
  -- function could rewrite any account's hash.
  if v_hash <> crypt(p_password, v_hash) then return false; end if;

  -- '$2a$06$...' — the cost is the two digits in the fourth field.
  v_cost := nullif(substring(v_hash from 5 for 2), '')::integer;
  if v_cost is null or v_cost >= 12 then return false; end if;

  update users set password_hash = crypt(p_password, gen_salt('bf', 12)) where id = v_id;

  -- A super admin has no company of their own, so their rehash cannot be filed
  -- against a tenant. The upgrade still happens; only the log entry is skipped.
  if v_company is not null then
    insert into audit_logs (user_id, action, entity, entity_id, meta, company_id, result)
    values (v_id, 'password.rehashed', 'users', v_id,
            jsonb_build_object('from_cost', v_cost, 'to_cost', 12), v_company, 'success');
  end if;

  return true;
end;
$$;

revoke all on function public.upgrade_password_hash(text, text) from public;
grant execute on function public.upgrade_password_hash(text, text) to hrms_app;
