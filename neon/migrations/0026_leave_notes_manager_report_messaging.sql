-- ---------------------------------------------------------------------------
-- Three requested features.
--
--   1. A reporting-manager report, so the org chart can be read as numbers.
--   2. A note on a leave decision — when HR turns a request down, the person
--      is told why, in HR's own words.
--   3. Direct messages between HR and an employee, for the conversation that
--      currently has to happen by walking to someone's desk.
-- ---------------------------------------------------------------------------

-- ================================================== 1. reporting manager report
/**
 * Each manager with the team that reports to them.
 *
 * Modelled on report_employees, including its HR check: an org chart with
 * headcounts is management information, and the other four reports are already
 * drawn at that line.
 *
 * Employees with no manager are grouped under "Unassigned" rather than dropped.
 * A missing reporting line is the single most useful thing this report can
 * show, and omitting those rows would hide exactly what someone runs it to find.
 */
create or replace function public.report_reporting_manager()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company integer := public.app_company_id();
  v_result jsonb;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  -- Unassigned last, then managers by name: the people with no reporting line
  -- are the finding, and a reader scanning alphabetically should not meet them
  -- in the middle of the list.
  select coalesce(
           jsonb_agg(row order by (row->>'manager_id') is null, row->>'manager_name'),
           '[]'::jsonb
         ) into v_result
  from (
    select jsonb_build_object(
      'manager_id', m.id,
      'manager_name', coalesce(m.full_name, 'Unassigned'),
      'manager_designation', coalesce(g.title, ''),
      -- The manager's own department. Deriving it from the report's department
      -- when there is no manager split "Unassigned" into one row per
      -- department, each labelled identically — three rows that all looked
      -- like the same group. Everyone without a reporting line belongs in one
      -- row, which is the whole point of showing them.
      'department_name', coalesce(d.name, '—'),
      'team_size', count(*) filter (where e.status = 'active'),
      'inactive_count', count(*) filter (where e.status <> 'active'),
      -- Who reports to them, so the report answers "who" and not only "how
      -- many" — the question anyone reading it asks next.
      'reports', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'employee_id', e.id,
            'full_name', e.full_name,
            'status', e.status,
            'department_name', coalesce(ed.name, '—')
          )
          order by e.full_name
        ) filter (where e.id is not null),
        '[]'::jsonb
      )
    ) as row
    from employees e
    left join employees m on m.id = e.reporting_manager_id
    left join designations g on g.id = m.designation_id
    left join departments d on d.id = m.department_id
    left join departments ed on ed.id = e.department_id
    where e.company_id = v_company
    group by m.id, m.full_name, g.title, d.name
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.report_reporting_manager() from public;
grant execute on function public.report_reporting_manager() to hrms_app;

-- ===================================================== 2. leave decision note
alter table public.leave_requests
  add column if not exists decision_note varchar(500);

comment on column public.leave_requests.decision_note is
  'Why HR approved or refused, in their words. Shown to the employee.';

/**
 * Decide a leave request, optionally saying why.
 *
 * The note is optional on approval and, by convention in the UI, required on a
 * refusal — enforced there rather than here because "why" is a conversation
 * rule, not a data one, and a rejection that must be explained should not be
 * blocked by the database at 6pm when the reason is obvious to everyone.
 *
 * Replaces the two-argument version rather than sitting beside it: an overload
 * differing only by an optional argument is an ambiguity waiting to resolve the
 * wrong way.
 */
drop function if exists public.decide_leave_request(integer, boolean);

create or replace function public.decide_leave_request(
  p_id integer,
  p_approve boolean,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_company integer := public.app_company_id();
  v_user_id integer := public.app_user_id();
  v_request record;
  v_employee_user integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select * into v_request
    from leave_requests
   where id = p_id and company_id = v_company;

  if v_request is null then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = '22023';
  end if;

  -- Segregation of duties: nobody decides their own request, whatever their
  -- role. Carried over from 0020, which established the rule.
  select user_id into v_employee_user from employees where id = v_request.employee_id;
  if v_employee_user = v_user_id then
    raise exception 'You cannot decide your own leave request' using errcode = '42501';
  end if;

  update leave_requests
     set status        = case when p_approve then 'approved' else 'rejected' end::leave_status_enum,
         decided_by    = v_user_id,
         decided_at    = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  -- Only approved leave spends the balance. A refusal must not deduct days,
  -- and 0022 established the check that the balance covers the request.
  if p_approve then
    update leave_balances
       set used_days = used_days + v_request.days_count
     where employee_id = v_request.employee_id
       and leave_type_id = v_request.leave_type_id
       and year = extract(year from v_request.start_date);
  end if;

  perform public.log_security_event(
    case when p_approve then 'leave.approved' else 'leave.rejected' end,
    'leave_requests', p_id,
    jsonb_build_object('employee_id', v_request.employee_id, 'note_given', p_note is not null),
    null, null, 'success'
  );

  return p_id;
end;
$$;

revoke all on function public.decide_leave_request(integer, boolean, text) from public;
grant execute on function public.decide_leave_request(integer, boolean, text) to hrms_app;

-- The note has to reach the employee, so it joins the view they already read.
-- Appended at the end: create or replace cannot reorder or remove columns.
create or replace view public.leave_request_detail as
select r.id,
       r.employee_id,
       e.full_name as employee_name,
       r.leave_type_id,
       t.name as leave_type_name,
       r.start_date,
       r.end_date,
       r.days_count,
       r.reason,
       r.status,
       user_display_name(r.decided_by) as decided_by_name,
       r.decided_at,
       r.created_at,
       r.decision_note
  from leave_requests r
  join employees e on e.id = r.employee_id
  join leave_types t on t.id = r.leave_type_id;

alter view public.leave_request_detail set (security_invoker = true);
grant select on public.leave_request_detail to hrms_app;

-- ========================================================== 3. direct messages
/**
 * One-to-one messages between two people in the same company.
 *
 * Deliberately not a chat product: no rooms, no groups, no attachments. The
 * need is an HR admin and an employee settling something without walking to a
 * desk, and every one of those features would add a way for the wrong person to
 * end up in a conversation.
 *
 * Both participants are stored explicitly rather than as a thread id, because
 * the security rule is "you can read a message you sent or received" and that
 * is a predicate over two columns — the simplest thing RLS can enforce, and
 * therefore the hardest to get wrong.
 */
create table if not exists public.messages (
  id          serial primary key,
  company_id  integer not null references public.companies(id) on delete cascade,
  sender_id   integer not null references public.users(id) on delete cascade,
  recipient_id integer not null references public.users(id) on delete cascade,
  body        varchar(2000) not null,
  -- When the recipient opened it. Null means unread, which is what the badge
  -- counts; a separate boolean would let "read" and "read_at" disagree.
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint messages_not_to_self check (sender_id <> recipient_id),
  constraint messages_body_not_blank check (btrim(body) <> '')
);

create index if not exists ix_messages_pair
  on public.messages (company_id, sender_id, recipient_id, created_at desc);
create index if not exists ix_messages_recipient_unread
  on public.messages (recipient_id, read_at) where read_at is null;

alter table public.messages enable row level security;

-- Read what you sent or were sent. Not "everyone in the company", and not HR
-- reading everyone's — an internal message between two colleagues is theirs.
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select
  using (
    company_id = (select public.app_company_id())
    and (sender_id = (select public.app_user_id()) or recipient_id = (select public.app_user_id()))
  );

-- Send only as yourself, and only to someone in your own company. Without the
-- recipient check a message could be addressed across tenants.
drop policy if exists messages_send on public.messages;
create policy messages_send on public.messages
  for insert
  with check (
    company_id = (select public.app_company_id())
    and sender_id = (select public.app_user_id())
    and exists (
      select 1 from public.users u
       where u.id = recipient_id and u.company_id = (select public.app_company_id())
    )
  );

-- The only permitted update is the recipient marking it read. A sender cannot
-- edit a message after sending it, which keeps the record of what was said.
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update
  using (company_id = (select public.app_company_id()) and recipient_id = (select public.app_user_id()))
  with check (recipient_id = (select public.app_user_id()));

-- The sender is the session, never the payload. The insert policy already
-- refuses any other value, but a default means the client has no reason to send
-- one at all — the field simply is not part of the wire format, so there is
-- nothing to forge and nothing to validate. (company_id is stamped by the API
-- for every tenanted table; sender_id is ours alone, so it is set here.)
alter table public.messages alter column sender_id set default public.app_user_id();

-- Revoke before granting, and do not assume a new table starts with none.
--
-- `alter default privileges ... grant select, insert, update, delete on tables
-- to hrms_app` is set on this schema, so the moment this table was created it
-- carried table-wide UPDATE and DELETE. The column grant below was therefore
-- decoration: the wider table grant already covered every column, and either
-- party could edit or delete a message after sending it — which is the one
-- thing a record of a conversation must not allow. Tested by trying it, not by
-- reading the grant.
revoke update, delete on public.messages from hrms_app;

grant select, insert on public.messages to hrms_app;
-- The only permitted change to a sent message: the recipient marking it read.
grant update (read_at) on public.messages to hrms_app;
grant usage, select on sequence public.messages_id_seq to hrms_app;

/** A message with both names resolved, so the UI needs no second lookup. */
create or replace view public.message_detail as
select m.id,
       m.company_id,
       m.sender_id,
       public.user_display_name(m.sender_id) as sender_name,
       m.recipient_id,
       public.user_display_name(m.recipient_id) as recipient_name,
       m.body,
       m.read_at,
       m.created_at
  from public.messages m;

alter view public.message_detail set (security_invoker = true);
grant select on public.message_detail to hrms_app;

/**
 * Everyone the caller has a conversation with, most recent first, with the
 * unread count — the inbox list.
 *
 * A function rather than a view because it needs the caller on both sides of
 * the pair to collapse a two-way conversation into one row per person.
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
             body, created_at, recipient_id, read_at
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

/**
 * Who the caller can message: everyone else in their company.
 *
 * A function rather than a select on `users`, because `users` is deliberately
 * unreadable through the generic query endpoint — it carries password_hash, and
 * a column that must never be read is not something to guard with a careful
 * column list at every call site. This returns four fields and no secrets.
 *
 * `employee_directory` cannot answer it either: it is keyed on employees.id and
 * does not carry user_id, while a message is addressed to a user.
 *
 * Not restricted to HR. An employee needs the same list to start a conversation
 * with HR, and the RLS on `messages` is what decides who may read what — a
 * shorter contact list would not add a security property, only a dead end.
 */
create or replace function public.message_contacts()
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

  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'user_id', u.id,
      'name', coalesce(e.full_name, u.email),
      'role', coalesce(r.name, ''),
      'designation', coalesce(g.title, ''),
      'department', coalesce(d.name, '')
    ) as row
    from users u
    left join roles r on r.id = u.role_id
    left join employees e on e.user_id = u.id and e.company_id = v_company
    left join designations g on g.id = e.designation_id
    left join departments d on d.id = e.department_id
    where u.company_id = v_company
      and u.id <> v_user
      and u.is_active
      -- Someone who has left keeps their history but should not appear as
      -- somebody to start a new conversation with.
      and coalesce(e.status, 'active') = 'active'
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.message_contacts() from public;
grant execute on function public.message_contacts() to hrms_app;
