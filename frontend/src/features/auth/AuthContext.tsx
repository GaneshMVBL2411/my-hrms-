import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import * as authApi from "@/features/auth/authApi"
import { supabase } from "@/lib/supabase"
import type { AuthUser } from "@/features/auth/types"

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  signIn: (email: string, password: string, rememberMe: boolean) => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshUser = async () => {
    try {
      const profile = await authApi.fetchCurrentUser()
      setUser(profile)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let active = true

    // Supabase restores the stored session and refreshes it on its own schedule.
    // This fires on that initial restore and on every refresh, so the profile —
    // role, employeeId, photo, all of which HR can change — is re-read each time
    // rather than being frozen at sign-in.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (active) {
          setUser(null)
          setIsLoading(false)
        }
        return
      }

      void authApi
        .fetchCurrentUser()
        .then((profile) => {
          if (active) setUser(profile)
        })
        .catch(() => {
          if (active) setUser(null)
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string, rememberMe: boolean) => {
    setUser(await authApi.signIn(email, password, rememberMe))
  }

  const signOut = async () => {
    setUser(null)
    await authApi.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut, refreshUser }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
