import { supabase, setRememberMe } from "@/lib/supabase"
import { ApiError } from "@/lib/errors"
import { toCamel } from "@/lib/case"
import { logAudit } from "@/lib/query"
import type { AuthUser } from "@/features/auth/types"

/**
 * Supabase Auth owns the credentials; `current_user_profile()` maps the auth
 * identity onto the app's own user row (id, role, linked employee).
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.rpc("current_user_profile")
  if (error) throw new ApiError(error.message, error.code)
  return data ? toCamel<AuthUser>(data) : null
}

export async function signIn(email: string, password: string, rememberMe: boolean): Promise<AuthUser> {
  setRememberMe(rememberMe)

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new ApiError("Invalid email or password")

  const user = await fetchCurrentUser()
  if (!user) {
    // The login exists but no active app user points at it.
    await supabase.auth.signOut()
    throw new ApiError("This account is not active. Contact HR.")
  }

  logAudit("login", "user", user.id)
  return user
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/**
 * Supabase can change a password from the current session alone, but the form
 * asks for the existing one — so verify it by re-authenticating first, which is
 * what `POST /auth/change-password` used to do server-side.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const email = sessionData.session?.user.email
  if (!email) throw new ApiError("Your session has expired. Sign in again.")

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (verifyError) throw new ApiError("Current password is incorrect")

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new ApiError(error.message)
}
