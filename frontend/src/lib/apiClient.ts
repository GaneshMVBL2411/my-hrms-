import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios"
import {
  getStoredRefreshToken,
  setSession,
  clearSession,
  getAccessToken,
  notifyUserRefreshed,
} from "@/features/auth/session"
import { API_BASE_URL } from "@/lib/config"
import type { LoginResponse } from "@/features/auth/types"

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
})

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) return null

  try {
    const { data } = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/refresh`, { refreshToken })
    setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    notifyUserRefreshed(data.user)
    return data.accessToken
  } catch {
    clearSession()
    return null
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true

      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null
      })

      const newToken = await refreshPromise
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return apiClient(originalRequest)
      }

      window.location.assign("/login")
    }

    return Promise.reject(error)
  }
)
