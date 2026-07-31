import { apiClient } from "@/lib/apiClient"
import type { LeaveBalance, LeaveRequest, LeaveRequestCreate, LeaveStatus, LeaveType } from "@/features/leaves/types"

export async function listTypes(): Promise<LeaveType[]> {
  const { data } = await apiClient.get("/leaves/types")
  return data
}

export async function getBalance(): Promise<LeaveBalance[]> {
  const { data } = await apiClient.get("/leaves/balance")
  return data
}

export async function listRequests(params: { scope?: "mine" | "all"; status?: LeaveStatus }): Promise<LeaveRequest[]> {
  const { data } = await apiClient.get("/leaves", { params })
  return data
}

export async function applyLeave(payload: LeaveRequestCreate): Promise<LeaveRequest> {
  const { data } = await apiClient.post("/leaves", payload)
  return data
}

export async function approveLeave(id: number): Promise<LeaveRequest> {
  const { data } = await apiClient.patch(`/leaves/${id}/approve`)
  return data
}

export async function rejectLeave(id: number): Promise<LeaveRequest> {
  const { data } = await apiClient.patch(`/leaves/${id}/reject`)
  return data
}

export async function cancelLeave(id: number): Promise<void> {
  await apiClient.delete(`/leaves/${id}`)
}
