-- Editing and deleting a message, without losing the record of what was said.
--
-- 0026 revoked UPDATE and DELETE on public.messages outright, with the note
-- that either party editing or deleting after the fact is "the one thing a
-- record of a conversation must not allow". That reasoning still holds, and
-- this migration does not reverse it — a hard DELETE is still impossible and
-- the original text of every edited message is still kept.
--
-- What changes is the difference between the record and the view of it. The
-- two participants get the WhatsApp behaviour they expect: a slip can be
-- corrected, a message sent to the wrong person can be withdrawn. Underneath,
-- the row survives, the prior text is copied into message_edits, and a delete
-- is a timestamp rather than a DELETE. HR's record is intact; what changed is
-- that the conversation no longer has to display every typo forever.
--
-- Both windows are enforced in the database, not the client, because a limit a
-- caller can choose to ignore is not a limit.

alter table public.messages
  add column if not exists edited_at  timestamptz,
  add column if not exists deleted_at timestamptz;

/**
 * Every previous version of an edited message.
 *
 * Deliberately unreachable from the API: no grants, RLS on, and no policy. It
 * is written only by the trigger below, which is SECURITY DEFINER, so neither
 * participant can read the history back nor tamper with it. It exists so an
 * edit is recoverable in an investigation, not so it can be browsed.
 */
create table if not exists public.message_edits (
  id            serial primary key,
  message_id    integer not null references public.messages(id) on delete cascade,
  previous_body varchar(2000) not null,
  edited_by     integer not null references public.users(id),
  edited_at     timestamptz not null default now()
);

create index if not exists ix_message_edits_message
  on public.message_edits (message_id, edited_at desc);

alter table public.message_edits enable row level security;
revoke all on public.message_edits from hrms_app;
revoke all on sequence public.message_edits_id_seq from hrms_app;

/**
 * The rules an amendment has to obey, enforced where they cannot be skipped.
 *
 * RLS decides *which rows* a caller may touch; it cannot express "only this
 * column, only for this long, and copy the old value aside first". That is what
 * this trigger is for. Every branch ends in either a return or an exception, so
 * an UPDATE that matches no case is refused rather than quietly permitted.
 */
create or replace function public.messages_guard_amend()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user integer := public.app_user_id();
begin
  -- Identity and routing are never amendable, by anyone. Re-pointing a message
  -- at a different recipient after the fact would rewrite history rather than
  -- correct it.
  if new.id          is distinct from old.id
  or new.company_id  is distinct from old.company_id
  or new.sender_id   is distinct from old.sender_id
  or new.recipient_id is distinct from old.recipient_id
  or new.created_at  is distinct from old.created_at then
    raise exception 'A message''s identity and routing cannot be changed'
      using errcode = '42501';
  end if;

  -- The recipient's only power, unchanged from 0026.
  if v_user = old.recipient_id then
    if new.body       is distinct from old.body
    or new.edited_at  is distinct from old.edited_at
    or new.deleted_at is distinct from old.deleted_at then
      raise exception 'The recipient may only mark a message read'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if v_user is distinct from old.sender_id then
    raise exception 'Only the sender may amend a message' using errcode = '42501';
  end if;

  if new.read_at is distinct from old.read_at then
    raise exception 'Only the recipient marks a message read' using errcode = '42501';
  end if;

  -- A withdrawn message is final. Allowing an edit afterwards would let someone
  -- delete, wait for the other side to stop looking, and then put words back.
  if old.deleted_at is not null then
    raise exception 'That message was deleted' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------- withdrawing
  if new.deleted_at is not null then
    if old.created_at < now() - interval '60 minutes' then
      raise exception 'A message can only be deleted within an hour of sending'
        using errcode = 'P0001';
    end if;
    -- The caller's timestamp is not trusted; nor is any body it sent alongside.
    -- The text stays in the row — message_detail is what stops the participants
    -- seeing it, and that is the line between hiding and destroying.
    new.deleted_at := now();
    new.body := old.body;
    return new;
  end if;

  -- ------------------------------------------------------------------ edits
  if new.body is distinct from old.body then
    if old.created_at < now() - interval '15 minutes' then
      raise exception 'A message can only be edited within 15 minutes of sending'
        using errcode = 'P0001';
    end if;
    insert into public.message_edits (message_id, previous_body, edited_by)
      values (old.id, old.body, v_user);
    new.edited_at := now();
    return new;
  end if;

  -- Nothing else is an amendment. Setting edited_at by hand to fake a history,
  -- in particular, is not.
  raise exception 'No permitted change was made to this message'
    using errcode = '42501';
end;
$$;

drop trigger if exists messages_guard_amend on public.messages;
create trigger messages_guard_amend
  before update on public.messages
  for each row execute function public.messages_guard_amend();

-- The sender may now reach their own rows. The trigger above is what decides
-- what they may actually do to them.
drop policy if exists messages_amend on public.messages;
create policy messages_amend on public.messages
  for update
  using (
    company_id = (select public.app_company_id())
    and sender_id = (select public.app_user_id())
  )
  with check (sender_id = (select public.app_user_id()));

-- Column grants stay narrow: `edited_at` is deliberately absent, because the
-- trigger sets it and no caller has a reason to assign it.
grant update (body, deleted_at) on public.messages to hrms_app;

/**
 * The two participants' view of the conversation.
 *
 * A withdrawn message keeps its place in the thread and loses its text — the
 * same thing WhatsApp does, and the reason the row is still there to be counted
 * and ordered. `deleted_at` is what the client renders "This message was
 * deleted" from.
 */
drop view if exists public.message_detail;
create view public.message_detail as
select m.id,
       m.company_id,
       m.sender_id,
       public.user_display_name(m.sender_id) as sender_name,
       m.recipient_id,
       public.user_display_name(m.recipient_id) as recipient_name,
       case when m.deleted_at is null then m.body else null end as body,
       m.read_at,
       m.created_at,
       m.edited_at,
       m.deleted_at
  from public.messages m;

alter view public.message_detail set (security_invoker = true);
grant select on public.message_detail to hrms_app;

/**
 * The inbox preview, with withdrawn messages no longer quoting themselves.
 *
 * Without this the thread list kept showing the text of a message the
 * conversation itself had stopped showing — the most visible place a "deleted"
 * message could still be read.
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
      'unread', count(*) filter (where recipient_id = v_user and read_at is null)
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
