-- =============================================================================
-- 0039 — Fix Project Status Sync Trigger
--
-- project_status_enum supports ('planning', 'active', 'on_hold', 'completed').
-- Fix sync_project_progress to transition planning projects to 'active'
-- (not 'in_progress' which is a task_status_enum value).
-- Also add 'in_progress' to project_status_enum as a supported value.
-- =============================================================================

-- 1. Add 'in_progress' to project_status_enum so any legacy or future queries won't throw
alter type project_status_enum add value if not exists 'in_progress';

-- 2. Correct sync_project_progress to set active status
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
