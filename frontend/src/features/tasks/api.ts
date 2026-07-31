import { apiClient } from "@/lib/apiClient"
import type { PaginatedTasks, Task, TaskCreate, TaskUpdate } from "@/features/tasks/types"

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
  const { data } = await apiClient.get("/tasks", { params })
  return data
}

export async function getTask(id: number): Promise<Task> {
  const { data } = await apiClient.get(`/tasks/${id}`)
  return data
}

export async function createTask(payload: TaskCreate): Promise<Task> {
  const { data } = await apiClient.post("/tasks", payload)
  return data
}

export async function updateTask(id: number, payload: TaskUpdate): Promise<Task> {
  const { data } = await apiClient.patch(`/tasks/${id}`, payload)
  return data
}

export async function deleteTask(id: number): Promise<void> {
  await apiClient.delete(`/tasks/${id}`)
}

export async function addChecklistItem(taskId: number, label: string): Promise<Task> {
  const { data } = await apiClient.post(`/tasks/${taskId}/checklist`, { label })
  return data
}

export async function toggleChecklistItem(itemId: number): Promise<Task> {
  const { data } = await apiClient.patch(`/tasks/checklist/${itemId}/toggle`)
  return data
}

export async function deleteChecklistItem(itemId: number): Promise<Task> {
  const { data } = await apiClient.delete(`/tasks/checklist/${itemId}`)
  return data
}

export async function addComment(taskId: number, body: string): Promise<Task> {
  const { data } = await apiClient.post(`/tasks/${taskId}/comments`, { body })
  return data
}
