import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import axios from "axios"
import * as authApi from "@/features/auth/authApi"
import { setSession, clearSession, getStoredRefreshToken, onUserRefreshed } from "@/features/auth/session"
import { API_BASE_URL } from "@/lib/config"
import type { AuthUser, LoginResponse } from "@/features/auth/types"

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  signIn: (email: string, password: string, rememberMe: boolean) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const bootstrap = async () => {
      const refreshToken = getStoredRefreshToken()
      if (!refreshToken) {
        setIsLoading(false)
        return
      }

      try {
        const { data } = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        })
        setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken })
        setUser(data.user)
      } catch {
        clearSession()
      } finally {
        setIsLoading(false)
      }
    }

    void bootstrap()
  }, [])

  useEffect(() => onUserRefreshed(setUser), [])

  const signIn = async (email: string, password: string, rememberMe: boolean) => {
    const data = await authApi.login(email, password)
    setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, rememberMe })
    setUser(data.user)
  }

  const signOut = async () => {
    const refreshToken = getStoredRefreshToken()
    clearSession()
    setUser(null)
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken)
      } catch {
        // best-effort server-side revoke; client state is already cleared
      }
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
