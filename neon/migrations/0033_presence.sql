-- Who is actually online.
--
-- The chat header said "online" under every name, unconditionally. That is
-- worse than saying nothing: a status that is always the same carries no
-- information, and it is read as a claim about the other person. Someone
-- messaging a colleague at nine in the evening and seeing "online" reasonably
-- concludes they are there, and waits.
--
-- WHY A TIMESTAMP AND NOT A FLAG
--
-- A boolean has to be turned off by someone, and the cases where it matters
-- are exactly the ones where nobody will: the app is killed from the task
-- switcher, the phone loses signal, the battery goes. A flag left true after
-- any of those is the same lie in a different column.
--
-- A timestamp cannot be left behind. "Online" becomes a question about how
-- long ago rather than a state to maintain, and every failure mode decays into
-- the truth on its own — the app stops saying it is there, and shortly after,
-- so does everyone else's view of it.

alter table public.users
  add column if not exists last_seen_at timestamptz;

-- The lookup behind "is this person online", which is per-user and frequent.
create index if not exists ix_users_last_seen
  on public.users (company_id, last_seen_at desc)
  where last_seen_at is not null;

/**
 * Records that the caller's app is open, right now.
 *
 * SECURITY DEFINER because `users` is deliberately not writable — nor readable
 * — through the generic query endpoint: the table carries password_hash, and
 * the way to keep that safe is for the application role to have no path to the
 * table at all. This function is that path, narrowed to one column of one row,
 * and it takes no arguments precisely so there is nothing to point somewhere
 * else. It can only ever stamp whoever is asking.
 */
create or replace function public.touch_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user integer := public.app_user_id();
  v_now  timestamptz := now();
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.users set last_seen_at = v_now where id = v_user;
  return v_now;
end;
$$;

revoke all on function public.touch_presence() from public;
grant execute on function public.touch_presence() to hrms_app;

/**
 * How long a person counts as online after their last heartbeat.
 *
 * Comfortably more than the interval the app sends on, so an ordinary missed
 * beat — a slow network, a moment of GC — does not flicker somebody offline
 * and back. Short enough that closing the app is reflected in about a minute
 * rather than being visible for an hour.
 */
create or replace function public.presence_window()
returns interval
language sql
immutable
as $$ select interval '75 seconds' $$;

grant execute on function public.presence_window() to hrms_app;

/**
 * When someone was last seen, for the people the caller may message.
 *
 * Scoped to the caller's own company and returns nothing else about the user —
 * no email, no role, and certainly no hash. Presence is the one fact here.
 *
 * `last_seen_at` is returned alongside `is_online` rather than only the
 * boolean, because "last seen at 18:40" is the useful thing to show once
 * somebody is not online, and computing it here keeps one definition of the
 * window instead of a copy in each client.
 */
create or replace function public.presence_for(p_user_ids integer[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_result  jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.id,
           'last_seen_at', u.last_seen_at,
           'is_online', u.last_seen_at is not null
                        and u.last_seen_at > now() - public.presence_window()
         )), '[]'::jsonb)
    into v_result
    from public.users u
   where u.company_id = v_company
     and u.id = any(p_user_ids);

  return v_result;
end;
$$;

revoke all on function public.presence_for(integer[]) from public;
grant execute on function public.presence_for(integer[]) to hrms_app;

/**
 * The inbox list, now carrying presence.
 *
 * Added here rather than left to a second call because the thread list already
 * names everyone the caller talks to — asking again for their presence would
 * be the same set of ids sent back to the same database a moment later.
 *
 * Everything else is carried over unchanged from 0030, including the
 * withdrawn-message substitution, which is easy to lose by retyping.
 */
create or replace function public.message_threads()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user integer := public.app_user_id();
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row->>'last_at' desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'user_id', other,
      'name', public.user_display_name(other),
      'last_body', (array_agg(body order by created_at desc))[1],
      'last_at', max(created_at),
      'unread', count(*) filter (where recipient_id = v_user and read_at is null),
      'last_seen_at', (select u.last_seen_at from public.users u where u.id = other),
      'is_online', (
        select u.last_seen_at is not null
               and u.last_seen_at > now() - public.presence_window()
          from public.users u where u.id = other
      )
    ) as row
    from (
      select case when sender_id = v_user then recipient_id else sender_id end as other,
             case when deleted_at is null then body else 'This message was deleted' end as body,
             created_at, recipient_id, read_at
        from messages
       where company_id = v_company
         and (sender_id = v_user or recipient_id = v_user)
    ) pairs
    group by other
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.message_threads() from public;
grant execute on function public.message_threads() to hrms_app;

-- ------------------------------------------------------------- diagnostics
select count(*) filter (where column_name = 'last_seen_at') as presence_column
  from information_schema.columns
 where table_schema = 'public' and table_name = 'users';
