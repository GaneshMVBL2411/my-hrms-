-- =============================================================================
-- 0037 — Task Progress and Creator Details
--
-- Exposes creator details (creator_name, creator_role) and project_progress
-- on task_directory, and adds trigger to sync overall project progress from tasks.
-- =============================================================================

-- 1. Sync task status when progress changes
create or replace function public.sync_task_progress()
returns trigger
language plpgsql
as $$
begin
  if new.progress >= 100 then
    new.status = 'completed';
  elsif new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.progress = 100;
  elsif new.progress > 0 and new.status in ('assigned', 'todo', 'to_do') then
    new.status = 'in_progress';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Automatically sync overall project progress as the average of task progress
create or replace function public.sync_project_progress()
returns trigger
language plpgsql
as $$
declare
  v_proj_id integer := coalesce(new.project_id, old.project_id);
  v_avg integer;
begin
  if v_proj_id is not null then
    select coalesce(round(avg(progress)), 0) into v_avg
    from tasks
    where project_id = v_proj_id;

    update projects
    set progress = v_avg,
        status = case
          when v_avg >= 100 then 'completed'::project_status_enum
          when v_avg > 0 and status = 'planning' then 'active'::project_status_enum
          else status
        end,
        updated_at = now()
    where id = v_proj_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tasks_sync_project_progress on tasks;
create trigger tasks_sync_project_progress
after insert or update of progress, project_id or delete on tasks
for each row execute function public.sync_project_progress();

-- 3. Recreate task_directory view with creator details & project_progress
drop view if exists public.task_directory;

create view public.task_directory with (security_invoker = on) as
select
  t.id,
  t.title,
  t.description,
  t.project_id,
  p.name as project_name,
  p.progress as project_progress,
  t.assigned_to,
  e.full_name as assignee_name,
  t.priority,
  t.due_date,
  t.status,
  t.progress,
  t.is_active,
  t.project_stage,
  t.start_date,
  t.end_date,
  t.task_file_url,
  t.task_file_name,
  t.task_managers,
  t.task_members,
  t.created_by,
  coalesce(ce.full_name, cu.email) as creator_name,
  cr.name as creator_role,
  t.created_at,
  t.updated_at
from tasks t
left join projects p on p.id = t.project_id
left join employees e on e.id = t.assigned_to
left join users cu on cu.id = t.created_by
left join roles cr on cr.id = cu.role_id
left join employees ce on ce.user_id = cu.id;

grant select on public.task_directory to hrms_app;
