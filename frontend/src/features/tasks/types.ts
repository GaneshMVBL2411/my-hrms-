export type Priority = "low" | "medium" | "high"
export type TaskStatus = "assigned" | "in_progress" | "review" | "completed"

export interface TaskSummary {
  id: number
  title: string
  projectId: number | null
  projectName: string | null
  assignedTo: number | null
  assigneeName: string | null
  priority: Priority
  dueDate: string | null
  status: TaskStatus
  progress: number
}

export interface TaskChecklistItem {
  id: number
  label: string
  isDone: boolean
}

export interface TaskComment {
  id: number
  userId: number
  userName: string
  body: string
  createdAt: string
}

export interface Task extends TaskSummary {
  description: string | null
  createdAt: string
  checklistItems: TaskChecklistItem[]
  comments: TaskComment[]
}

export interface TaskCreate {
  title: string
  description?: string
  projectId?: number
  assignedTo?: number
  priority: Priority
  dueDate?: string
  status: TaskStatus
  progress?: number
}

export interface TaskUpdate {
  title?: string
  description?: string
  projectId?: number | null
  assignedTo?: number | null
  priority?: Priority
  dueDate?: string
  status?: TaskStatus
  progress?: number
}

export interface PaginatedTasks {
  items: TaskSummary[]
  total: number
  page: number
  pageSize: number
}
