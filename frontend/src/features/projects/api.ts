import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid, ApiError } from "@/lib/errors"
import { toCamel, definedOnly } from "@/lib/case"
import { likePattern, logAudit, pageRange } from "@/lib/query"
import type {
  PaginatedProjects,
  Project,
  ProjectCreate,
  ProjectMember,
  ProjectSummary,
  ProjectUpdate,
} from "@/features/projects/types"

const SUMMARY_COLUMNS = "id, name, priority, status, deadline, progress, tech_stack, member_count"
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, description, created_at`

function toProjectRow(payload: ProjectUpdate) {
  return definedOnly({
    name: payload.name,
    description: payload.description,
    tech_stack: payload.techStack,
    priority: payload.priority,
    status: payload.status,
    deadline: payload.deadline,
    progress: payload.progress,
  })
}

export async function listProjects(params: {
  page: number
  pageSize: number
  status?: string
  search?: string
  memberId?: number
}): Promise<PaginatedProjects> {
  const [from, to] = pageRange(params.page, params.pageSize)

  let query = supabase.from("project_directory").select(SUMMARY_COLUMNS, { count: "exact" })

  if (params.status) query = query.eq("status", params.status)
  if (params.search) query = query.ilike("name", likePattern(params.search))

  if (params.memberId) {
    // Membership lives in a join table PostgREST cannot filter on while still
    // reporting an accurate member_count, so resolve the ids first.
    const memberships = unwrap<{ projectId: number }[]>(
      await supabase.from("project_members").select("project_id").eq("employee_id", params.memberId)
    )
    if (memberships.length === 0) {
      return { items: [], total: 0, page: params.page, pageSize: params.pageSize }
    }
    query = query.in("id", memberships.map((m) => m.projectId))
  }

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to)
  if (error) throw new ApiError(error.message, error.code)

  return {
    items: toCamel<ProjectSummary[]>(data ?? []),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  }
}

export async function getProject(id: number): Promise<Project> {
  const [project, members] = await Promise.all([
    unwrap<Omit<Project, "members">>(
      await supabase.from("project_directory").select(DETAIL_COLUMNS).eq("id", id).single()
    ),
    unwrap<ProjectMember[]>(
      await supabase
        .from("project_member_detail")
        .select("employee_id, employee_name, photo_url, role_in_project")
        .eq("project_id", id)
    ),
  ])

  return { ...project, members }
}

export async function createProject(payload: ProjectCreate): Promise<Project> {
  const project = unwrap<{ id: number }>(
    await supabase.from("projects").insert(toProjectRow(payload)).select("id").single()
  )

  if (payload.memberIds?.length) {
    unwrapVoid(
      await supabase
        .from("project_members")
        .insert(payload.memberIds.map((employeeId) => ({ project_id: project.id, employee_id: employeeId })))
    )
  }

  logAudit("create", "project", project.id)
  return getProject(project.id)
}

export async function updateProject(id: number, payload: ProjectUpdate): Promise<Project> {
  unwrapVoid(await supabase.from("projects").update(toProjectRow(payload)).eq("id", id))
  logAudit("update", "project", id)
  return getProject(id)
}

export async function deleteProject(id: number): Promise<void> {
  unwrapVoid(await supabase.from("projects").delete().eq("id", id))
  logAudit("delete", "project", id)
}

export async function addMember(
  projectId: number,
  employeeId: number,
  roleInProject?: string
): Promise<Project> {
  const { error } = await supabase
    .from("project_members")
    .insert({ project_id: projectId, employee_id: employeeId, role_in_project: roleInProject ?? null })

  if (error) {
    throw new ApiError(
      error.code === "23505" ? "This employee is already a member of the project" : error.message,
      error.code
    )
  }

  return getProject(projectId)
}

export async function removeMember(projectId: number, employeeId: number): Promise<Project> {
  unwrapVoid(
    await supabase
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("employee_id", employeeId)
  )
  return getProject(projectId)
}
