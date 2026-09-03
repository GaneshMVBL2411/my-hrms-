import { toCamel } from "@/lib/case"

/**
 * Anything the database rejected — carries the Postgres message verbatim.
 *
 * The messages still come from Postgres, so the HRMS's own business rules
 * ("Already checked in today", "You don't have permission") reach the user
 * unchanged after the move to Neon. Only the transport in between differs.
 */
export class ApiError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

/**
 * The failure shape the client returns. Was `PostgrestError` from
 * @supabase/supabase-js; now declared here, because the only fields any call
 * site ever reads are `message` and `code` — the rest of PostgrestError
 * (details, hint, toJSON) was never touched.
 */
interface ResultError {
  message: string
  code?: string
}

interface Result<T> {
  data: T | null
  error: ResultError | null
}

/** Throws on failure, otherwise returns the rows converted to camelCase. */
export function unwrap<T>({ data, error }: Result<unknown>): T {
  if (error) throw new ApiError(error.message, error.code)
  return toCamel<T>(data)
}

/** Same, but for statements whose result we don't need (deletes, fire-and-forget RPCs). */
export function unwrapVoid({ error }: { error: ResultError | null }): void {
  if (error) throw new ApiError(error.message, error.code)
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}
