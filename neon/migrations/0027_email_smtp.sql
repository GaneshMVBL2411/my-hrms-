-- ---------------------------------------------------------------------------
-- Email: delivery log, password reset tokens, and per-tenant SMTP settings.
--
-- Three tables, and the interesting thing about all three is how little the
-- application role may do to them directly. Every write goes through a
-- SECURITY DEFINER function, and `password_reset_tokens` is not readable by
-- the application role at all — a table the API cannot select from cannot leak
-- through the generic /query endpoint, however that endpoint changes later.
--
-- The default privileges on this schema grant select/insert/update/delete to
-- hrms_app the moment a table is created (see 0026, where that quietly made a
-- message table editable). So every grant here is preceded by a revoke, and
-- the revoke is the part that matters.
-- ---------------------------------------------------------------------------

-- ================================================================ email log
/**
 * One row per email the system tried to send.
 *
 * Deliberately holds no body and no recipient-visible content beyond the
 * subject. An email log that stored message bodies would accumulate payslip
 * figures, reset links and personal notes in a table whose whole purpose is to
 * be read by an administrator debugging delivery — which is a worse breach
 * surface than the mail itself.
 *
 * `template` records which template was used, so "did the payslip mail go out"
 * is answerable without keeping what it said.
 */
create table if not exists public.email_logs (
  id                  serial primary key,
  -- Null for platform-level mail that belongs to no tenant: a super admin's
  -- SMTP test, or a password reset for someone whose company is not yet known.
  company_id          integer references public.companies(id) on delete cascade,
  recipient           varchar(320) not null,
  sender              varchar(320) not null,
  subject             varchar(500) not null,
  template            varchar(64),
  status              varchar(16) not null default 'queued',
  provider_message_id varchar(255),
  error_code          varchar(64),
  -- Truncated by the writer. A provider's failure text is diagnostic, not a
  -- place to accumulate whatever the far end decided to say.
  error_message       varchar(1000),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  constraint email_logs_status check (status in ('queued', 'sending', 'sent', 'failed'))
);

create index if not exists ix_email_logs_company on public.email_logs (company_id, created_at desc);
create index if not exists ix_email_logs_status on public.email_logs (status, created_at desc);

alter table public.email_logs enable row level security;

-- HR reads their own company's delivery history. Nobody writes through this
-- path: inserts and updates come from log_email_attempt / mark_email_result.
drop policy if exists email_logs_read on public.email_logs;
create policy email_logs_read on public.email_logs
  for select
  using (
    company_id = (select public.app_company_id())
    and (select public.app_is_hr())
  );

revoke all on public.email_logs from hrms_app;
grant select on public.email_logs to hrms_app;

/**
 * Records that an email is about to be attempted, and returns the row id.
 *
 * SECURITY DEFINER because the application role has no insert on the table:
 * the log must record what the server did, and a role that could write it
 * freely could also write a delivery that never happened.
 */
create or replace function public.log_email_attempt(
  p_company_id integer,
  p_recipient text,
  p_sender text,
  p_subject text,
  p_template text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id integer;
begin
  insert into email_logs (company_id, recipient, sender, subject, template, status)
  values (p_company_id, left(p_recipient, 320), left(p_sender, 320), left(p_subject, 500),
          left(p_template, 64), 'sending')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.log_email_attempt(integer, text, text, text, text) from public;
grant execute on function public.log_email_attempt(integer, text, text, text, text) to hrms_app;

/** Closes an attempt out as sent or failed. */
create or replace function public.mark_email_result(
  p_id integer,
  p_status text,
  p_message_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid email status %', p_status using errcode = '22023';
  end if;

  update email_logs
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         provider_message_id = left(p_message_id, 255),
         error_code = left(p_error_code, 64),
         error_message = left(p_error_message, 1000)
   where id = p_id;
end;
$$;

revoke all on function public.mark_email_result(integer, text, text, text, text) from public;
grant execute on function public.mark_email_result(integer, text, text, text, text) to hrms_app;

-- ==================================================== password reset tokens
/**
 * A pending password reset.
 *
 * Only the SHA-256 of the token is stored, never the token. Anyone reading
 * this table — a backup, a support query, a compromised read replica — holds
 * nothing that can reset an account, which is the difference between a table
 * of hashes and a table of keys.
 *
 * The application role has no privilege on this table at all. Both operations
 * are SECURITY DEFINER functions, so there is no path from a query endpoint to
 * these rows however the endpoint's allow-lists evolve.
 */
create table if not exists public.password_reset_tokens (
  id         serial primary key,
  user_id    integer not null references public.users(id) on delete cascade,
  token_hash varchar(64) not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  -- Recorded to make a burst of resets against one account visible. The
  -- address is already in audit_logs; this ties it to the token that was
  -- actually issued.
  requested_ip varchar(64)
);

create index if not exists ix_password_reset_user on public.password_reset_tokens (user_id, created_at desc);

alter table public.password_reset_tokens enable row level security;
-- No policy, and no grant: nothing reaches these rows except the two functions
-- below. An empty policy set with RLS on denies everything, which is the
-- intent stated twice rather than once.
revoke all on public.password_reset_tokens from hrms_app;

/**
 * Issues a reset token for an address, if it belongs to an active account.
 *
 * Returns null when it does not, and the caller must respond identically
 * either way — the route does. Telling an anonymous caller whether an address
 * has an account here would turn this into an account enumeration oracle,
 * which is the most common way this feature is got wrong.
 *
 * Existing unused tokens for the account are burned first, so a second request
 * invalidates the first link rather than leaving several live at once.
 */
create or replace function public.create_password_reset(
  p_email text,
  p_token_hash text,
  p_ttl_minutes integer default 30,
  p_ip text default null
)
returns table (user_id integer, company_id integer, full_name text, company_name text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user record;
begin
  select u.id, u.company_id into v_user
    from users u
   where lower(u.email) = lower(btrim(p_email))
     and u.is_active
   limit 1;

  if v_user is null then
    return;
  end if;

  update password_reset_tokens
     set used_at = now()
   where password_reset_tokens.user_id = v_user.id and used_at is null;

  insert into password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
  values (v_user.id, p_token_hash, now() + make_interval(mins => greatest(p_ttl_minutes, 1)),
          left(p_ip, 64));

  return query
    select v_user.id,
           v_user.company_id,
           coalesce(e.full_name, '')::text,
           coalesce(cs.company_name, c.name, '')::text
      from (select 1) _
      left join employees e on e.user_id = v_user.id
      left join companies c on c.id = v_user.company_id
      left join company_settings cs on cs.company_id = v_user.company_id;
end;
$$;

revoke all on function public.create_password_reset(text, text, integer, text) from public;
grant execute on function public.create_password_reset(text, text, integer, text) to hrms_app;

/**
 * Spends a reset token and sets the new password.
 *
 * Single use and time limited, both checked here rather than by the caller.
 * Bumping token_version signs every existing session out: someone resetting a
 * password they believe was stolen expects the thief to be logged out, and a
 * reset that left live sessions alone would quietly not do that.
 */
create or replace function public.consume_password_reset(
  p_token_hash text,
  p_new_password text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token record;
begin
  select * into v_token
    from password_reset_tokens
   where token_hash = p_token_hash
   limit 1;

  -- One message for every failure. Distinguishing "no such token" from
  -- "expired" from "already used" tells someone holding a stolen link which
  -- of those it is, and none of the three is actionable for a legitimate user
  -- beyond "ask for another".
  if v_token is null or v_token.used_at is not null or v_token.expires_at < now() then
    raise exception 'This reset link is no longer valid' using errcode = '42501';
  end if;

  perform public.assert_password_policy(p_new_password);

  update users
     set password_hash = crypt(p_new_password, gen_salt('bf', 12)),
         password_changed_at = now(),
         token_version = coalesce(token_version, 1) + 1
   where id = v_token.user_id;

  update password_reset_tokens set used_at = now() where id = v_token.id;

  perform public.log_security_event(
    'password.reset', 'users', v_token.user_id,
    jsonb_build_object('via', 'email_token'), null, null, 'success'
  );

  return v_token.user_id;
end;
$$;

revoke all on function public.consume_password_reset(text, text) from public;
grant execute on function public.consume_password_reset(text, text) to hrms_app;

-- ==================================================== tenant SMTP settings
/**
 * Per-company SMTP, for tenants that want mail to come from their own server.
 *
 * The password is stored as ciphertext produced by the API with a key held in
 * the server's environment — `EMAIL_ENCRYPTION_KEY`, which is deliberately not
 * in this database. A dump of this table therefore contains no usable
 * credential, and restoring it somewhere without the key yields settings that
 * cannot send.
 *
 * The column is named for what it holds. `password_encrypted` invites someone
 * to select it into an API response some day; `password_ciphertext` reads as
 * something you would have to decrypt on purpose.
 *
 * No policy grants write access, and the application role gets no privilege on
 * the table at all. Reading and writing go through the two functions below, so
 * a tenant's SMTP settings can never be reached from the generic /query
 * endpoint — the requirement that the API must not expose a way to change SMTP
 * settings by table write.
 */
create table if not exists public.company_email_settings (
  company_id           integer primary key references public.companies(id) on delete cascade,
  host                 varchar(255) not null,
  port                 integer not null default 587,
  secure               boolean not null default false,
  username             varchar(255),
  password_ciphertext  text,
  from_email           varchar(320) not null,
  from_name            varchar(120),
  reply_to             varchar(320),
  enabled              boolean not null default false,
  updated_at           timestamptz not null default now(),
  updated_by           integer references public.users(id),
  constraint company_email_settings_port check (port between 1 and 65535)
);

alter table public.company_email_settings enable row level security;
revoke all on public.company_email_settings from hrms_app;

/**
 * This company's SMTP settings, without the secret.
 *
 * There is no function that returns the password, and that is the point: the
 * settings screen shows a masked field and preserves the stored value when the
 * administrator leaves it blank, so the plaintext never needs to travel back
 * to a browser. `has_password` is what the UI actually needs to know.
 */
create or replace function public.get_company_email_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company integer := public.app_company_id();
  v_row record;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_row from company_email_settings where company_id = v_company;
  if v_row is null then
    return jsonb_build_object('configured', false);
  end if;

  return jsonb_build_object(
    'configured', true,
    'host', v_row.host,
    'port', v_row.port,
    'secure', v_row.secure,
    'username', v_row.username,
    'has_password', v_row.password_ciphertext is not null,
    'from_email', v_row.from_email,
    'from_name', v_row.from_name,
    'reply_to', v_row.reply_to,
    'enabled', v_row.enabled,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_company_email_settings() from public;
grant execute on function public.get_company_email_settings() to hrms_app;

/**
 * Saves this company's SMTP settings.
 *
 * `p_password_ciphertext` null means "leave the stored one alone", which is
 * what makes the masked field on the settings screen work without the browser
 * ever holding the real value.
 *
 * The company comes from the session, never from an argument. That is the only
 * reason one tenant cannot write another's row, and it is why this is a
 * function rather than a table grant.
 */
create or replace function public.upsert_company_email_settings(
  p_host text,
  p_port integer,
  p_secure boolean,
  p_username text,
  p_password_ciphertext text,
  p_from_email text,
  p_from_name text,
  p_reply_to text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company integer := public.app_company_id();
  v_user integer := public.app_user_id();
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if v_company is null then
    raise exception 'No company in this session' using errcode = '42501';
  end if;

  insert into company_email_settings as s
    (company_id, host, port, secure, username, password_ciphertext,
     from_email, from_name, reply_to, enabled, updated_at, updated_by)
  values
    (v_company, p_host, coalesce(p_port, 587), coalesce(p_secure, false), p_username,
     p_password_ciphertext, p_from_email, p_from_name, p_reply_to,
     coalesce(p_enabled, false), now(), v_user)
  on conflict (company_id) do update
    set host = excluded.host,
        port = excluded.port,
        secure = excluded.secure,
        username = excluded.username,
        -- Null means unchanged, so a save that does not retype the password
        -- keeps the one already stored.
        password_ciphertext = coalesce(excluded.password_ciphertext, s.password_ciphertext),
        from_email = excluded.from_email,
        from_name = excluded.from_name,
        reply_to = excluded.reply_to,
        enabled = excluded.enabled,
        updated_at = now(),
        updated_by = v_user;

  perform public.log_security_event(
    'email.settings_changed', 'company_email_settings', v_company,
    jsonb_build_object('host', p_host, 'port', p_port, 'enabled', p_enabled,
                       'password_changed', p_password_ciphertext is not null),
    null, null, 'success'
  );
end;
$$;

revoke all on function public.upsert_company_email_settings(text, integer, boolean, text, text, text, text, text, boolean) from public;
grant execute on function public.upsert_company_email_settings(text, integer, boolean, text, text, text, text, text, boolean) to hrms_app;

/**
 * The settings the *server* needs in order to send, including the ciphertext.
 *
 * Separate from the function above and not exposed through any route: this is
 * called by the email service to decide whether a tenant has its own transport,
 * and the value it returns is decrypted in Node and never leaves it.
 *
 * The company id is an argument, which makes the guard below the only thing
 * standing between tenants. Without it, an administrator of one company could
 * ask for another's — SECURITY DEFINER means the function's own privileges
 * apply, not the caller's, so the row comes back regardless of who asked.
 * Tested by making that exact call as a genuine admin of a different tenant,
 * which returned company A's host, username and stored credential.
 *
 * Two callers are legitimate:
 *
 *   the email service, which runs outside any session (withoutSession) and so
 *   has no app.user_id — this is the only path that needs the ciphertext, and
 *   it is server-initiated by definition;
 *
 *   a session asking about its own company, which is harmless and keeps the
 *   function usable for a health check.
 *
 * Anything else is a tenant asking about a tenant that is not theirs.
 */
create or replace function public.get_company_smtp_transport(p_company_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row record;
  v_caller integer := public.app_user_id();
begin
  if v_caller is not null and public.app_company_id() is distinct from p_company_id then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_row
    from company_email_settings
   where company_id = p_company_id and enabled;

  if v_row is null then
    return null;
  end if;

  return jsonb_build_object(
    'host', v_row.host,
    'port', v_row.port,
    'secure', v_row.secure,
    'username', v_row.username,
    'password_ciphertext', v_row.password_ciphertext,
    'from_email', v_row.from_email,
    'from_name', v_row.from_name,
    'reply_to', v_row.reply_to
  );
end;
$$;

revoke all on function public.get_company_smtp_transport(integer) from public;
grant execute on function public.get_company_smtp_transport(integer) to hrms_app;

/**
 * The company's own name and branding, for a template's header.
 *
 * Tenant email must not say "Whhoohh Path LLP" to a customer's employees, and
 * the only way to guarantee that is for the template never to know a company
 * name of its own — it is passed one, from here.
 */
create or replace function public.get_email_branding(p_company_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_name text;
  v_logo text;
begin
  select coalesce(cs.company_name, c.name), cs.logo_url
    into v_name, v_logo
    from companies c
    left join company_settings cs on cs.company_id = c.id
   where c.id = p_company_id;

  return jsonb_build_object('company_name', coalesce(v_name, ''), 'logo_url', v_logo);
end;
$$;

revoke all on function public.get_email_branding(integer) from public;
grant execute on function public.get_email_branding(integer) to hrms_app;
