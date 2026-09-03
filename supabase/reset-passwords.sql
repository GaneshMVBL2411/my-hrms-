-- =============================================================================
-- Reset the seed accounts' passwords
--
-- Run this whole file in the Supabase SQL Editor, as the `postgres` role.
--
-- Why this exists: five of the six seeded logins stopped accepting the passwords
-- in seed.mjs. Supabase stores only a bcrypt hash of a password, so the current
-- one cannot be read back — it can only be overwritten, and overwriting
-- auth.users needs a privileged connection. Neither the anon key nor the app can
-- do it, which is why this is a file you paste rather than a screen in the HRMS.
--
-- GoTrue verifies auth.users.encrypted_password as bcrypt, so crypt(..., bf)
-- produces exactly what a dashboard password reset would.
--
-- Safe to re-run; it only touches passwords, and confirms any address that was
-- left unconfirmed (an unconfirmed email is refused at sign-in).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

update auth.users
set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(16), 'base64'), extensions.gen_salt('bf', 12)),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at         = now()
from (values
  ('ravi.shanker@whhoohhpath.com'),
  ('hr@whhoohhpath.com'),
  ('ganesh.pm@whhoohhpath.com'),
  ('tarak.lead@whhoohhpath.com'),
  ('pavan.dev@whhoohhpath.com'),
  ('avinash.ai@whhoohhpath.com')
) as v(email)
where lower(auth.users.email) = lower(v.email);


-- ------------------------------------------------------------- diagnostics
-- Expect six rows, each confirmed, each with a fresh updated_at. An address
-- missing from this list has no login at all — create it under
-- Authentication -> Users (tick Auto Confirm User) and then run
-- link-auth-user.sql to point the existing profile at it.
select
  au.email,
  au.email_confirmed_at is not null as confirmed,
  au.updated_at,
  u.id is not null                  as has_profile,
  coalesce(u.is_active, false)      as is_active,
  r.name                            as role
from auth.users au
left join public.users u on u.auth_id = au.id
left join public.roles r on r.id = u.role_id
order by au.email;
