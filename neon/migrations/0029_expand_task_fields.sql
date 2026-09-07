-- =============================================================================
-- 0029 — Expand Task Fields
--
-- Adds Horilla HRMS-compatible task fields:
--   is_active        Task active flag (default true)
--   project_stage    Current stage of project (default 'Todo')
--   start_date       Start date
--   end_date         End date
--   task_file_url    Uploaded task file attachment URL
--   task_file_name   Original filename of task attachment
--   task_managers    Array of employee IDs who manage the task
--   task_members     Array of employee IDs assigned to the task
-- =============================================================================

alter type public.task_status_enum add value if not exists 'todo';
alter type public.task_status_enum add value if not exists 'to_do';
alter type public.task_status_enum add value if not exists 'on_hold';
alter type public.task_status_enum add value if not exists 'cancelled';

alter table public.tasks add column if not exists is_active boolean not null default true;
alter table public.tasks add column if not exists project_stage varchar(50) not null default 'Todo';
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists end_date date;
alter table public.tasks add column if not exists task_file_url text;
alter table public.tasks add column if not exists task_file_name text;
alter table public.tasks add column if not exists task_managers integer[] default '{}';
alter table public.tasks add column if not exists task_members integer[] default '{}';

-- Recreate task_directory view with the new columns
drop view if exists public.task_directory;

create view public.task_directory with (security_invoker = on) as
select
  t.id,
  t.title,
  t.description,
  t.project_id,
  p.name as project_name,
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
  t.created_at
from tasks t
left join projects p on p.id = t.project_id
left join employees e on e.id = t.assigned_to;

grant select on public.task_directory to hrms_app;
