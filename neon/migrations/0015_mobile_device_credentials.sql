-- ---------------------------------------------------------------------------
-- Device credentials for the native app.
--
-- Separate from webauthn_credentials rather than shoehorned into it. The two
-- store different things — a WebAuthn credential has a credential id and a
-- signature counter that this scheme has no equivalent of — and a shared table
-- would mean columns that are meaningless for half its rows, plus verification
-- code that has to ask which kind it is holding before it can do anything.
--
-- What it holds is a public key. The private half never leaves the phone's
-- keystore, so this table is not a secret: leaking it in full would let an
-- attacker verify signatures, not produce them.
-- ---------------------------------------------------------------------------

create table if not exists public.mobile_device_credentials (
  id           serial primary key,
  user_id      integer not null references public.users(id) on delete cascade,
  -- ed25519 public key, hex. Unique so the same key cannot be registered
  -- against two accounts and used to punch for either.
  public_key   text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  company_id   integer not null references public.companies(id) on delete cascade
);

create index if not exists idx_mobile_device_credentials_user
  on public.mobile_device_credentials(user_id);

alter table public.mobile_device_credentials enable row level security;

-- Same reasoning as the WebAuthn table: a device is the business of its owner
-- alone. A policy letting an admin write here would be a policy letting them
-- enrol a device that punches in as someone else.
drop policy if exists mobile_device_credentials_own on public.mobile_device_credentials;
create policy mobile_device_credentials_own on public.mobile_device_credentials
  for all
  using (user_id = public.app_user_id())
  with check (user_id = public.app_user_id() and company_id = public.app_company_id());

grant select, insert, update, delete on public.mobile_device_credentials to hrms_app;
grant usage, select on sequence public.mobile_device_credentials_id_seq to hrms_app;
