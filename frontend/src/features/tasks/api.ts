import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { toCamel, definedOnly, toSnake } from "@/lib/case"
import { pageRange } from "@/lib/query"
import type {
  PaginatedTasks,
  Task,
  TaskChecklistItem,
  TaskComment,
  TaskCreate,
  TaskSummary,
  TaskUpdate,
} from "@/features/tasks/types"

const SUMMARY_COLUMNS =
  "id, title, project_id, project_name, assigned_to, assignee_name, priority, due_date, status, progress, is_active, project_stage, start_date, end_date, task_file_url, task_file_name, task_managers, task_members"
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, description, created_at`

const SORT_COLUMNS: Record<string, string> = {
  title: "title",
  dueDate: "due_date",
  priority: "priority",
  status: "status",
  createdAt: "created_at",
}

export async function listTasks(params: {
  page: number
  pageSize: number
  projectId?: number
  assignedTo?: number
  status?: string
  priority?: string
  sortBy?: string
  sortDir?: "asc" | "desc"
}): Promise<PaginatedTasks> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase.from("task_directory").select(SUMMARY_COLUMNS, { count: "exact" })
  if (params.projectId) query = query.eq("project_id", params.projectId)
  if (params.assignedTo) query = query.eq("assigned_to", params.assignedTo)
  if (params.status) query = query.eq("status", params.status)
  if (params.priority) query = query.eq("priority", params.priority)

  const column = SORT_COLUMNS[params.sortBy ?? "createdAt"] ?? "created_at"
  const { data, error, count } = await query
    .order(column, { ascending: params.sortDir === "asc" })
    .range(from, to)

  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<TaskSummary[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}

export async function getTask(id: number): Promise<Task> {
  const [task, checklistItems, comments] = await Promise.all([
    unwrap<Omit<Task, "checklistItems" | "comments">>(
      await supabase.from("task_directory").select(DETAIL_COLUMNS).eq("id", id).single()
    ),
    unwrap<TaskChecklistItem[]>(
      await supabase.from("task_checklist_items").select("id, label, is_done").eq("task_id", id).order("id")
    ),
    unwrap<TaskComment[]>(
      await supabase
        .from("task_comment_detail")
        .select("id, user_id, user_name, body, created_at")
        .eq("task_id", id)
        .order("created_at")
    ),
  ])

  return { ...task, checklistItems, comments }
}

export async function createTask(payload: TaskCreate): Promise<Task> {
  const task = unwrap<{ id: number }>(
    await supabase
      .from("tasks")
      .insert(
        definedOnly({
          title: payload.title,
          description: payload.description,
          project_id: payload.projectId,
          assigned_to: payload.assignedTo,
          priority: payload.priority ?? "medium",
          due_date: payload.dueDate || payload.endDate,
          status: payload.status ?? "todo",
          progress: payload.progress ?? 0,
          is_active: payload.isActive ?? true,
          project_stage: payload.projectStage ?? "Todo",
          start_date: payload.startDate,
          end_date: payload.endDate,
          task_file_url: payload.taskFileUrl,
          task_file_name: payload.taskFileName,
          task_managers: payload.taskManagers ?? [],
          task_members: payload.taskMembers ?? [],
        })
      )
      .select("id")
      .single()
  )

  return getTask(task.id)
}

/**
 * Goes through an RPC rather than a plain update: who may change *which* field
 * differs per role (only the assignee may report progress), and row level
 * security cannot express a per-column rule.
 */
export async function updateTask(id: number, payload: TaskUpdate): Promise<Task> {
  unwrapVoid(
    await supabase.rpc("update_task", { p_id: id, p_patch: toSnake(definedOnly(payload)) })
  )
  return getTask(id)
}

export async function deleteTask(id: number): Promise<void> {
  unwrapVoid(await supabase.from("tasks").delete().eq("id", id))
}

export async function addChecklistItem(taskId: number, label: string): Promise<Task> {
  unwrapVoid(await supabase.from("task_checklist_items").insert({ task_id: taskId, label }))
  return getTask(taskId)
}

export async function toggleChecklistItem(itemId: number): Promise<Task> {
  const item = unwrap<{ taskId: number; isDone: boolean }>(
    await supabase.from("task_checklist_items").select("task_id, is_done").eq("id", itemId).single()
  )

  unwrapVoid(await supabase.from("task_checklist_items").update({ is_done: !item.isDone }).eq("id", itemId))
  return getTask(item.taskId)
}

export async function deleteChecklistItem(itemId: number): Promise<Task> {
  const item = unwrap<{ taskId: number }>(
    await supabase.from("task_checklist_items").select("task_id").eq("id", itemId).single()
  )

  unwrapVoid(await supabase.from("task_checklist_items").delete().eq("id", itemId))
  return getTask(item.taskId)
}

export async function addComment(taskId: number, body: string): Promise<Task> {
  unwrapVoid(await supabase.from("task_comments").insert({ task_id: taskId, body }))
  return getTask(taskId)
}
