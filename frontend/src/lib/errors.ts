import type { PostgrestError } from "@supabase/supabase-js"
import { toCamel } from "@/lib/case"

/** Anything Supabase rejected — carries the Postgres/PostgREST message verbatim. */
export class ApiError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

interface Result<T> {
  data: T | null
  error: PostgrestError | null
}

/** Throws on failure, otherwise returns the rows converted to camelCase. */
export function unwrap<T>({ data, error }: Result<unknown>): T {
  if (error) throw new ApiError(error.message, error.code)
  return toCamel<T>(data)
}

/** Same, but for statements whose result we don't need (deletes, fire-and-forget RPCs). */
export function unwrapVoid({ error }: { error: PostgrestError | null }): void {
  if (error) throw new ApiError(error.message, error.code)
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}
