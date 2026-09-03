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
  if (error) {
    // A wrong password stays deliberately vague, but everything else — an
    // unconfirmed email, a disabled email provider, rate limiting — is a setup
    // problem, and hiding it behind "invalid password" makes it undiagnosable.
    // Match on the code, not the status: `email_not_confirmed` is also a 400.
    const isBadCredentials =
      error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)
    throw new ApiError(isBadCredentials ? "Invalid email or password" : error.message)
  }

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
 * Changes user password. The current password is verified server-side
 * before the update is applied, avoiding client-side credential re-auth throttling.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    currentPassword,
    password: newPassword,
  })
  if (error) throw new ApiError(error.message)
}
