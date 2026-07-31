import axios from "axios"
import { apiClient } from "@/lib/apiClient"
import { API_BASE_URL } from "@/lib/config"
import type { AuthUser, LoginResponse } from "@/features/auth/types"

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login`, { email, password })
  return data
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post("/auth/logout", { refresh_token: refreshToken })
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await apiClient.get<AuthUser>("/auth/me")
  return data
}
