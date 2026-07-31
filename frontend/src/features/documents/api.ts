import { apiClient } from "@/lib/apiClient"
import type {
  GeneratedLetter,
  LetterGenerateRequest,
  LetterPayload,
  Policy,
  PolicyCreate,
  PolicyUpdate,
} from "@/features/documents/types"

export async function listPolicies(): Promise<Policy[]> {
  const { data } = await apiClient.get("/policies")
  return data
}

export async function createPolicy(payload: PolicyCreate): Promise<Policy> {
  const { data } = await apiClient.post("/policies", payload)
  return data
}

export async function updatePolicy(id: number, payload: PolicyUpdate): Promise<Policy> {
  const { data } = await apiClient.patch(`/policies/${id}`, payload)
  return data
}

export async function deletePolicy(id: number): Promise<void> {
  await apiClient.delete(`/policies/${id}`)
}

export async function generateLetter(payload: LetterGenerateRequest): Promise<LetterPayload> {
  const { data } = await apiClient.post("/letters/generate", payload)
  return data
}

export async function listLetters(): Promise<GeneratedLetter[]> {
  const { data } = await apiClient.get("/letters")
  return data
}

export async function viewLetter(id: number): Promise<LetterPayload> {
  const { data } = await apiClient.get(`/letters/${id}/view`)
  return data
}
