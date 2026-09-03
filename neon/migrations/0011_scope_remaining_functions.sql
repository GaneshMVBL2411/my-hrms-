-- =============================================================================
-- Neon 0011 — Tenant-scope the last five SECURITY DEFINER functions
--
-- Closes the remainder of the set flagged when the tenancy work began. Each
-- bypasses row level security by design, so a missing company check is not
-- caught by any policy — it simply returns or writes across tenants.
--
-- With one company these were harmless. Prozonic exists now, so each one is
-- live exposure:
--
--   get_calendar             Prozonic's calendar would show Whhohh's birthdays,
--                            leave, task deadlines and project dates.
--   update_task              a task could be edited by id from another company.
--   assign_asset             hardware could be assigned across companies.
--   return_asset             and returned across them.
--   upsert_company_settings  `select ... limit 1` picked whichever settings row
--                            came first, so one company could overwrite another's.
--
-- The last is the clearest example of a single-company assumption surviving in
-- logic rather than in schema: nothing about the table said "one row", but the
-- query did.
-- =============================================================================

-- ------------------------------------------------------------------ calendar
create or replace function public.get_calendar(p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'utc')::integer);
  v_month integer := coalesce(p_month, extract(month from now() at time zone 'utc')::integer);
  v_company integer := public.app_company_id();
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_start := make_date(v_year, v_month, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;

  select coalesce(jsonb_agg(entry order by entry->>'date'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object('date', event_date, 'type', event_type, 'title', title) as entry
    from company_events
    where event_date between v_start and v_end
      and company_id = v_company

    union all

    select jsonb_build_object(
      'date', greatest(r.start_date, v_start),
      'type', 'leave',
      'title', e.full_name || ' on leave'
    )
    from leave_requests r
    join employees e on e.id = r.employee_id
    where r.status = 'approved' and r.start_date <= v_end and r.end_date >= v_start
      and r.company_id = v_company

    union all

    select jsonb_build_object('date', due_date, 'type', 'task_due', 'title', 'Task due: ' || title)
    from tasks
    where due_date between v_start and v_end
      and company_id = v_company

    union all

    select jsonb_build_object('date', deadline, 'type', 'project_deadline', 'title', 'Project deadline: ' || name)
    from projects
    where deadline between v_start and v_end
      and company_id = v_company

    union all

    select jsonb_build_object(
      'date', make_date(v_year, v_month, extract(day from dob)::integer),
      'type', 'birthday',
      'title', full_name || '''s birthday'
    )
    from employees
    where dob is not null
      and company_id = v_company
      and extract(month from dob) = v_month
      -- 29 Feb birthdays simply do not appear in a non-leap year
      and (extract(day from dob) <> 29 or v_month <> 2
           or extract(day from (make_date(v_year, 3, 1) - 1)) = 29)
  ) entries;

  return v_result;
end;
$$;


-- --------------------------------------------------------------------- tasks
create or replace function public.update_task(p_id integer, p_patch jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task tasks;
  v_extra_keys text[];
begin
  if public.app_user_id() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Scoped in the lookup, so a task in another company is "not found" rather
  -- than "forbidden" — the difference would confirm the id exists.
  select * into v_task from tasks
   where id = p_id and company_id = public.app_company_id();

  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if not public.app_manages_tasks() then
    select array_agg(k) into v_extra_keys
    from jsonb_object_keys(p_patch) k
    where k not in ('status', 'progress');

    if v_extra_keys is not null then
      raise exception 'You can only update a task''s status and progress' using errcode = '42501';
    end if;
  end if;

  if p_patch ? 'progress' and v_task.assigned_to is distinct from public.app_employee_id() then
    raise exception 'Only the assignee can update a task''s progress percentage' using errcode = '42501';
  end if;

  update tasks t set
    title       = case when p_patch ? 'title' then p_patch->>'title' else t.title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
    -- nullif('') because a cleared form field arrives as "" rather than as null
    project_id  = case when p_patch ? 'project_id' then nullif(p_patch->>'project_id', '')::integer else t.project_id end,
    assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::integer else t.assigned_to end,
    priority    = case when p_patch ? 'priority' then (p_patch->>'priority')::priority_enum else t.priority end,
    due_date    = case when p_patch ? 'due_date' then nullif(p_patch->>'due_date', '')::date else t.due_date end,
    status      = case when p_patch ? 'status' then (p_patch->>'status')::task_status_enum else t.status end,
    progress    = case when p_patch ? 'progress' then (p_patch->>'progress')::integer else t.progress end
  where t.id = p_id;

  return p_id;
end;
$$;


-- -------------------------------------------------------------------- assets
create or replace function public.assign_asset(p_asset_id integer, p_employee_id integer, p_notes text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_status asset_status_enum;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select status into v_status from assets
   where id = p_asset_id and company_id = v_company
     for update;

  if v_status is null then
    raise exception 'Asset not found' using errcode = 'P0002';
  end if;
  if v_status <> 'available' then
    raise exception 'Asset is currently % and cannot be assigned', v_status;
  end if;

  -- The employee must be in the same company as the asset. Without this an
  -- asset could be assigned to a person in another tenant, which would then
  -- appear on their record.
  if not exists (
    select 1 from employees where id = p_employee_id and company_id = v_company
  ) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  insert into asset_assignments (company_id, asset_id, employee_id, assigned_date, notes)
  values (v_company, p_asset_id, p_employee_id, (now() at time zone 'utc')::date, p_notes);

  update assets set status = 'assigned' where id = p_asset_id;
  return p_asset_id;
end;
$$;


create or replace function public.return_asset(p_asset_id integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_assignment_id integer;
begin
  if not public.app_is_hr() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;

  select id into v_assignment_id from asset_assignments
  where asset_id = p_asset_id and returned_date is null
    and company_id = v_company
  limit 1;

  if v_assignment_id is null then
    raise exception 'This asset is not currently assigned to anyone';
  end if;

  update asset_assignments set returned_date = (now() at time zone 'utc')::date
   where id = v_assignment_id;
  update assets set status = 'available'
   where id = p_asset_id and company_id = v_company;

  return p_asset_id;
end;
$$;


-- ------------------------------------------------------------------ settings
-- The single-company assumption lived in `limit 1`, not in the schema: with two
-- tenants it picked whichever row came first, so one company's founder could
-- overwrite another's settings without any error.
create or replace function public.upsert_company_settings(
  p_company_name text,
  p_address text default null,
  p_logo_url text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company integer := public.app_company_id();
  v_id integer;
begin
  if not public.app_is_founder() then
    raise exception 'You don''t have permission to perform this action' using errcode = '42501';
  end if;
  if v_company is null then
    raise exception 'No company in this session';
  end if;

  select id into v_id from company_settings where company_id = v_company limit 1;

  if v_id is null then
    insert into company_settings (company_id, company_name, address, logo_url)
    values (v_company, p_company_name, p_address, p_logo_url)
    returning id into v_id;
  else
    update company_settings
    set company_name = p_company_name, address = p_address, logo_url = p_logo_url, updated_at = now()
    where id = v_id;
  end if;

  return v_id;
end;
$$;


-- ------------------------------------------------------------- diagnostics
-- Every SECURITY DEFINER function in public. `false` must now be limited to
-- ones that genuinely need no tenant: the session helpers, the pre-auth
-- entry points, and the trigger functions.
select
  p.proname as function_name,
  pg_get_functiondef(p.oid) ilike '%company_id%'
    or pg_get_functiondef(p.oid) ilike '%app_company_id%' as tenant_aware
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.prosecdef
order by tenant_aware, p.proname;
