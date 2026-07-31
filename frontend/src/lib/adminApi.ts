import { FunctionsHttpError } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { ApiError } from "@/lib/errors"

/**
 * Calls the `admin-users` Edge Function — the only privileged operation left,
 * because creating or resetting a login needs the service key.
 */
export async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null)
      throw new ApiError(details?.error ?? error.message)
    }
    throw new ApiError(
      "Could not reach the admin-users function. Deploy it with `supabase functions deploy admin-users`."
    )
  }

  return data as T
}
