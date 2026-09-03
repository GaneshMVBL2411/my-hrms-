import { supabase } from "@/lib/supabase"
import { ApiError } from "@/lib/errors"

/**
 * Calls the `admin-users` endpoint — the only privileged operation left,
 * because creating a login writes a password hash, and that must never be
 * something a browser session can do directly.
 *
 * This was a Supabase Edge Function; it is now a route on the HRMS API server,
 * backed by create_employee_with_login(). The call site did not change.
 */
export async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("admin-users", { body })

  // The client already returns the server's message, so there is no second
  // error shape to unwrap — the Supabase version had to reach into
  // FunctionsHttpError.context to recover it.
  if (error) throw new ApiError(error.message, error.code)

  return data as T
}
