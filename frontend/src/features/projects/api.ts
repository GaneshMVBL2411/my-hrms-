import { apiClient } from "@/lib/apiClient"
import type { PaginatedProjects, Project, ProjectCreate, ProjectUpdate } from "@/features/projects/types"

export async function listProjects(params: {
  page: number
  pageSize: number
  status?: string
  search?: string
  memberId?: number
}): Promise<PaginatedProjects> {
  const { data } = await apiClient.get("/projects", { params })
  return data
}

export async function getProject(id: number): Promise<Project> {
  const { data } = await apiClient.get(`/projects/${id}`)
  return data
}

export async function createProject(payload: ProjectCreate): Promise<Project> {
  const { data } = await apiClient.post("/projects", payload)
  return data
}

export async function updateProject(id: number, payload: ProjectUpdate): Promise<Project> {
  const { data } = await apiClient.patch(`/projects/${id}`, payload)
  return data
}

export async function deleteProject(id: number): Promise<void> {
  await apiClient.delete(`/projects/${id}`)
}

export async function addMember(projectId: number, employeeId: number, roleInProject?: string): Promise<Project> {
  const { data } = await apiClient.post(`/projects/${projectId}/members`, {
    employeeId,
    roleInProject,
  })
  return data
}

export async function removeMember(projectId: number, employeeId: number): Promise<Project> {
  const { data } = await apiClient.delete(`/projects/${projectId}/members/${employeeId}`)
  return data
}
