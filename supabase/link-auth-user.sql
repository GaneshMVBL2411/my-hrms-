-- =============================================================================
-- Link a hand-made login to an app user
--
-- Use this when `seed.mjs` isn't an option (no Node, no service key). Create the
-- account first under Authentication -> Users -> Add user, with **Auto Confirm
-- User** ticked — an unconfirmed email is refused at sign-in. Then edit the four
-- values below and run this whole file in the SQL Editor.
--
-- Signing in needs BOTH halves: the auth identity (credentials) and the
-- public.users row (role, active flag). A 400 on /auth/v1/token means the first
-- is missing; "This account is not active" means the second is.
-- =============================================================================

do $$
declare
  v_email text := 'hr@whhohhpath.com';
  v_role  text := 'hr_admin';   -- founder | hr_admin | project_manager | team_lead | employee
  v_first text := 'Bhavya';
  v_last  text := 'Sri';        -- '' if they go by a single name

  v_auth_id uuid;
begin
  select id into v_auth_id from auth.users where lower(email) = lower(v_email);

  if v_auth_id is null then
    raise exception
      'No login exists for %. Create it under Authentication -> Users (tick Auto Confirm User), then re-run this.',
      v_email;
  end if;

  if exists (select 1 from public.users where lower(email) = lower(v_email)) then
    -- The profile is already there; point it at this login and re-enable it.
    update public.users set auth_id = v_auth_id, is_active = true
    where lower(email) = lower(v_email);
    raise notice 'Re-linked the existing profile for %', v_email;
  else
    perform public.create_employee_profile(
      v_auth_id, v_email, v_role,
      jsonb_build_object('first_name', v_first, 'last_name', v_last)
    );
    raise notice 'Created % as %', v_email, v_role;
  end if;
end $$;


-- ------------------------------------------------------------- diagnostics
-- Who can actually sign in, and is each login wired to a profile?
select
  au.email,
  au.id is not null                       as has_login,
  u.id is not null                        as has_profile,
  coalesce(u.is_active, false)            as is_active,
  r.name                                  as role,
  e.full_name
from auth.users au
full outer join public.users u on u.auth_id = au.id
left join roles r on r.id = u.role_id
left join employees e on e.user_id = u.id
order by au.email nulls last;
