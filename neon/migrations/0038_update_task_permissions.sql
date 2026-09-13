-- =============================================================================
-- 0038 — Update Task Permissions
--
-- Allows both assignees and task managers (PM, Team Lead, HR, Founder)
-- to update task progress percentage.
-- =============================================================================

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

  select * into v_task from tasks where id = p_id;
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

  if p_patch ? 'progress' and not public.app_manages_tasks() and v_task.assigned_to is distinct from public.app_employee_id() then
    raise exception 'Only the assignee or task managers can update progress percentage' using errcode = '42501';
  end if;

  update tasks t set
    title       = case when p_patch ? 'title' then p_patch->>'title' else t.title end,
    description = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
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
