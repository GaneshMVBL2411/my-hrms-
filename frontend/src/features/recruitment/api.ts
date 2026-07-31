import { apiClient } from "@/lib/apiClient"
import type {
  Candidate,
  CandidateCreate,
  CandidateUpdate,
  InterviewCreate,
  InterviewUpdate,
  PaginatedCandidates,
} from "@/features/recruitment/types"

export async function listCandidates(params: {
  page: number
  pageSize: number
  status?: string
  search?: string
}): Promise<PaginatedCandidates> {
  const { data } = await apiClient.get("/candidates", { params })
  return data
}

export async function getCandidate(id: number): Promise<Candidate> {
  const { data } = await apiClient.get(`/candidates/${id}`)
  return data
}

export async function createCandidate(payload: CandidateCreate): Promise<Candidate> {
  const { data } = await apiClient.post("/candidates", payload)
  return data
}

export async function updateCandidate(id: number, payload: CandidateUpdate): Promise<Candidate> {
  const { data } = await apiClient.patch(`/candidates/${id}`, payload)
  return data
}

export async function deleteCandidate(id: number): Promise<void> {
  await apiClient.delete(`/candidates/${id}`)
}

export async function addInterview(candidateId: number, payload: InterviewCreate): Promise<Candidate> {
  const { data } = await apiClient.post(`/candidates/${candidateId}/interviews`, payload)
  return data
}

export async function updateInterview(interviewId: number, payload: InterviewUpdate): Promise<Candidate> {
  const { data } = await apiClient.patch(`/candidates/interviews/${interviewId}`, payload)
  return data
}
