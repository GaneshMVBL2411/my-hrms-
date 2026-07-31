export type Priority = "low" | "medium" | "high"
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed"

export interface ProjectSummary {
  id: number
  name: string
  priority: Priority
  status: ProjectStatus
  deadline: string | null
  progress: number
  techStack: string[]
  memberCount: number
}

export interface ProjectMember {
  employeeId: number
  employeeName: string
  photoUrl: string | null
  roleInProject: string | null
}

export interface Project extends ProjectSummary {
  description: string | null
  createdAt: string
  members: ProjectMember[]
}

export interface ProjectCreate {
  name: string
  description?: string
  techStack?: string[]
  priority: Priority
  status: ProjectStatus
  deadline?: string
  progress: number
  memberIds?: number[]
}

export type ProjectUpdate = Partial<ProjectCreate>

export interface PaginatedProjects {
  items: ProjectSummary[]
  total: number
  page: number
  pageSize: number
}
