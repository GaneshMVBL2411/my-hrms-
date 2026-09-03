-- =============================================================================
-- Neon 0021 — Give the task checklist an owner
--
-- M5 finding. `task_checklist_items` was the only writable table in the schema
-- whose policy carried no ownership predicate at all — company scope and
-- nothing else:
--
--   using (company_id = (select public.app_company_id()))
--
-- So any employee could tick, retitle or delete any checklist item on any task
-- in the company, including tasks on projects they have nothing to do with.
--
-- The second-order effect is the worse one. `sync_task_progress()` recomputes
-- tasks.progress from checklist state, and 0011 deliberately restricted that
-- number:
--
--   "Only the assignee can update a task's progress percentage"
--
-- With the checklist unguarded that rule was decorative — anyone could drive a
-- colleague's task to 100% by ticking their boxes, and the completion would be
-- recorded against the assignee. The rule is only real once both routes to the
-- number are closed, which is what this does.
--
-- Reads are deliberately left company-wide. Seeing what a task involves is how
-- people pick up each other's work; the problem was only ever the writing.
-- =============================================================================

drop policy if exists task_checklist_write on task_checklist_items;

/**
 * Who may change a checklist item: the person doing the task, the person who
 * created it, or someone whose role is to manage tasks.
 *
 * Expressed against the parent task rather than the item, because a checklist
 * item has no owner of its own — it inherits the task's. The same predicate is
 * used for USING and WITH CHECK so an item cannot be moved onto another task
 * as a way of reaching one the caller could not otherwise write to.
 */
create policy task_checklist_write on task_checklist_items
  for all to authenticated
  using (
    company_id = (select public.app_company_id())
    and exists (
      select 1 from tasks t
       where t.id = task_checklist_items.task_id
         and t.company_id = (select public.app_company_id())
         and (
           t.assigned_to = (select public.app_employee_id())
           or t.created_by = (select public.app_user_id())
           or (select public.app_manages_tasks())
         )
    )
  )
  with check (
    company_id = (select public.app_company_id())
    and exists (
      select 1 from tasks t
       where t.id = task_checklist_items.task_id
         and t.company_id = (select public.app_company_id())
         and (
           t.assigned_to = (select public.app_employee_id())
           or t.created_by = (select public.app_user_id())
           or (select public.app_manages_tasks())
         )
    )
  );

-- The lookup runs per row, so the join column needs an index. Without it a
-- checklist-heavy task turns every tick into a sequential scan of tasks.
create index if not exists ix_task_checklist_task on task_checklist_items (task_id);


-- ------------------------------------------------------------- diagnostics
-- Expect exactly two policies: the company-wide read, and the scoped write.
select p.polname,
       case p.polcmd when 'r' then 'select' when '*' then 'all' else p.polcmd::text end as cmd
from pg_policy p
join pg_class c on c.oid = p.polrelid
where c.relname = 'task_checklist_items'
order by p.polname;
