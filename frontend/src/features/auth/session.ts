import type { AuthUser } from "@/features/auth/types"

const REFRESH_KEY = "hrms_refresh_token"

let accessToken: string | null = null

export function getAccessToken() {
  return accessToken
}

// Token refresh happens silently deep inside the axios interceptor, outside any
// React component — this lets it push the freshly-returned user (role, employeeId,
// etc. may have changed server-side since login) back into AuthContext's state,
// instead of that data being fetched and immediately discarded.
type UserListener = (user: AuthUser) => void
const userListeners = new Set<UserListener>()

export function onUserRefreshed(listener: UserListener): () => void {
  userListeners.add(listener)
  return () => userListeners.delete(listener)
}

export function notifyUserRefreshed(user: AuthUser) {
  userListeners.forEach((listener) => listener(user))
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY)
}

export function setSession(params: { accessToken: string; refreshToken: string; rememberMe?: boolean }) {
  accessToken = params.accessToken

  const store = params.rememberMe ?? !!localStorage.getItem(REFRESH_KEY) ? localStorage : sessionStorage
  store.setItem(REFRESH_KEY, params.refreshToken)
}

export function clearSession() {
  accessToken = null
  localStorage.removeItem(REFRESH_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}
