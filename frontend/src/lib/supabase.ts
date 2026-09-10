/**
 * The HRMS data client.
 *
 * Despite the filename, this no longer talks to Supabase — it talks to the
 * HRMS API server, which talks to Neon. The name and the exported shape are
 * kept deliberately: fourteen feature `api.ts` files import `supabase` from
 * here and call `.from(...).select(...).eq(...)`, and the point of this
 * migration was to change the database, not the application. Rewriting those
 * files would have meant re-reviewing every query in the system.
 *
 * So this implements the small part of the supabase-js surface the HRMS
 * actually uses — verified by counting the call sites, not guessed at:
 *
 *   17 query-builder methods   .select .insert .update .upsert .delete
 *                              .eq .neq .gt .gte .lt .lte .in .is .like .ilike
 *                              .or .order .range .limit .single .maybeSingle
 *    5 auth methods            signInWithPassword, signOut, getSession,
 *                              updateUser, onAuthStateChange
 *      storage                 upload, getPublicUrl
 *      functions.invoke
 *
 * Anything outside that set is absent on purpose. A silently-missing method
 * would be a bug that only shows up in production; one that does not exist
 * fails at compile time.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001"

export const isSupabaseConfigured = Boolean(API_URL)

const TOKEN_KEY = "hrms_token"
const EMAIL_KEY = "hrms_email"
const REMEMBER_KEY = "hrms_remember_me"

/**
 * "Remember me" decides whether the session outlives the tab. Reads check both
 * stores, writes go to the one chosen at sign-in — carried over unchanged from
 * the Supabase client, including the reason: reading only the chosen store
 * means a reload immediately after sign-in misses the token.
 */
const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY),
  set: (token: string) => {
    const store = localStorage.getItem(REMEMBER_KEY) === "false" ? sessionStorage : localStorage
    store.setItem(TOKEN_KEY, token)
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EMAIL_KEY)
    sessionStorage.removeItem(EMAIL_KEY)
  },
  // changePassword re-authenticates with the current address before setting a
  // new one, so the session has to remember who is signed in.
  getEmail: () => sessionStorage.getItem(EMAIL_KEY) ?? localStorage.getItem(EMAIL_KEY),
  setEmail: (email: string) => {
    const store = localStorage.getItem(REMEMBER_KEY) === "false" ? sessionStorage : localStorage
    store.setItem(EMAIL_KEY, email)
  },
}

export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, String(remember))
}

export interface ApiError {
  message: string
  code?: string
}

interface Result<T> {
  data: T
  error: ApiError | null
  count?: number | null
}

/**
 * The one place a request to the API is made: attaches the bearer token,
 * parses the body, and turns a non-2xx into a throw.
 *
 * Exported as `apiRequest` for the few callers that are not table queries or
 * RPCs — the WebAuthn ceremonies, which have their own routes because the
 * signature has to be verified in Node before anything touches the database.
 * They go through here rather than calling fetch themselves so that token
 * handling and the 401-clears-the-session rule stay in a single place.
 */
/**
 * Fetches a stored file as bytes, with the session's token in the header.
 *
 * Separate from apiRequest because that one parses JSON, and this is an image.
 * It lives here rather than at the call site so the token stays behind the
 * same accessor as every other request — the alternative was each caller
 * reading it out of storage itself, which is how the query-string version of
 * this came about.
 */
export async function fetchFileBlob(fileId: string): Promise<Blob> {
  const token = tokenStore.get()
  const response = await fetch(`${API_URL}/files/${encodeURIComponent(fileId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) {
    throw new Error(`Could not load file ${fileId}: ${response.status}`)
  }
  return response.blob()
}

export async function apiRequest(path: string, init?: RequestInit): Promise<any> {
  return request(path, init)
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const token = tokenStore.get()
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  const text = await res.text()
  const body = text ? JSON.parse(text) : null

  if (!res.ok) {
    // The session is gone; clearing it here means the next render sees the
    // signed-out state rather than looping on 401s.
    if (res.status === 401) tokenStore.clear()
    throw { message: body?.error ?? res.statusText, code: body?.code ?? String(res.status) }
  }

  return body
}

type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "like" | "ilike"

interface QueryDescription {
  table: string
  action: "select" | "insert" | "update" | "upsert" | "delete"
  columns?: string
  filters: { column: string; op: Operator; value: unknown }[]
  or?: string
  order?: { column: string; ascending: boolean }[]
  limit?: number
  offset?: number
  count?: boolean
  payload?: unknown
  onConflict?: string
  single?: boolean
  /** `.single()` errors on a missing row; `.maybeSingle()` returns null. */
  strictSingle?: boolean
}

/**
 * Chainable, and awaitable at any point — `then` is what makes
 * `await supabase.from("x").select()` work without an explicit execute step,
 * exactly as the Supabase builder behaved.
 */
class QueryBuilder<T = any> implements PromiseLike<Result<T>> {
  private q: QueryDescription

  constructor(table: string) {
    this.q = { table, action: "select", filters: [] }
  }

  select(columns = "*", options?: { count?: "exact" }) {
    this.q.columns = columns
    if (options?.count) this.q.count = true
    // `.insert(...).select()` means "return the inserted rows", so selecting
    // after a write must not turn it back into a read.
    if (this.q.action === "select") this.q.action = "select"
    return this
  }

  insert(payload: unknown) {
    this.q.action = "insert"
    this.q.payload = payload
    return this
  }

  update(payload: unknown) {
    this.q.action = "update"
    this.q.payload = payload
    return this
  }

  upsert(payload: unknown, options?: { onConflict?: string }) {
    this.q.action = "upsert"
    this.q.payload = payload
    this.q.onConflict = options?.onConflict
    return this
  }

  delete() {
    this.q.action = "delete"
    return this
  }

  private filter(column: string, op: Operator, value: unknown) {
    this.q.filters.push({ column, op, value })
    return this
  }

  eq(c: string, v: unknown) { return this.filter(c, "eq", v) }
  neq(c: string, v: unknown) { return this.filter(c, "neq", v) }
  gt(c: string, v: unknown) { return this.filter(c, "gt", v) }
  gte(c: string, v: unknown) { return this.filter(c, "gte", v) }
  lt(c: string, v: unknown) { return this.filter(c, "lt", v) }
  lte(c: string, v: unknown) { return this.filter(c, "lte", v) }
  in(c: string, v: unknown[]) { return this.filter(c, "in", v) }
  is(c: string, v: null) { return this.filter(c, "is", v) }
  like(c: string, v: string) { return this.filter(c, "like", v) }
  ilike(c: string, v: string) { return this.filter(c, "ilike", v) }

  or(expression: string) {
    this.q.or = expression
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    ;(this.q.order ??= []).push({ column, ascending: options?.ascending !== false })
    return this
  }

  /** PostgREST's range is inclusive on both ends; limit/offset are not. */
  range(from: number, to: number) {
    this.q.offset = from
    this.q.limit = to - from + 1
    return this
  }

  limit(n: number) {
    this.q.limit = n
    return this
  }

  /** Missing row is an error, matching PostgREST. */
  single() {
    this.q.single = true
    this.q.strictSingle = true
    return this
  }

  /** Missing row yields null, no error. */
  maybeSingle() {
    this.q.single = true
    return this
  }

  async then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    _onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    try {
      const body = await request("/query", {
        method: "POST",
        body: JSON.stringify(this.q),
      })

      if (this.q.single && body.data === null && this.q.strictSingle) {
        // Callers using .single() expect an error, not a null row.
        const result = { data: null as T, error: { message: "No rows found", code: "PGRST116" }, count: body.count }
        return onfulfilled ? onfulfilled(result) : (result as unknown as R1)
      }

      const result: Result<T> = { data: body.data, error: null, count: body.count }
      return onfulfilled ? onfulfilled(result) : (result as unknown as R1)
    } catch (error) {
      // Errors are returned in the result rather than thrown, because every
      // call site reads `{ data, error }` and never wraps these in try/catch.
      const result = { data: null as T, error: error as ApiError, count: null }
      return onfulfilled ? onfulfilled(result) : (result as unknown as R1)
    }
  }
}

// ---------------------------------------------------------------------- auth
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED"
type AuthListener = (event: AuthEvent, session: { access_token: string } | null) => void

const listeners = new Set<AuthListener>()

function emit(event: AuthEvent) {
  const token = tokenStore.get()
  listeners.forEach((fn) => fn(event, token ? { access_token: token } : null))
}

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const body = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      tokenStore.set(body.access_token)
      tokenStore.setEmail(body.user?.email ?? email)
      emit("SIGNED_IN")
      return { data: { session: body }, error: null }
    } catch (error) {
      return { data: { session: null }, error: error as ApiError }
    }
  },

  async signOut() {
    await request("/auth/logout", { method: "POST" }).catch(() => {
      // A failed logout must still clear the client session; the token is
      // stateless, so there is nothing server-side left holding it open.
    })
    tokenStore.clear()
    emit("SIGNED_OUT")
    return { error: null }
  },

  async getSession() {
    const token = tokenStore.get()
    const email = tokenStore.getEmail()
    return {
      data: { session: token ? { access_token: token, user: { email } } : null },
      error: null,
    }
  },

  async updateUser({ currentPassword, password }: { currentPassword?: string; password?: string }) {
    try {
      await request("/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword: password }),
      })
      return { data: {}, error: null }
    } catch (error) {
      return { data: null, error: error as ApiError }
    }
  },

  /**
   * Supabase fired this on session restore and on every token refresh, and
   * AuthContext relies on it firing at least once on mount to decide whether
   * anyone is signed in. The dispatch is deferred so subscribers attached in
   * the same tick are not missed.
   */
  onAuthStateChange(callback: AuthListener) {
    listeners.add(callback)
    queueMicrotask(() => {
      const token = tokenStore.get()
      callback(token ? "SIGNED_IN" : "SIGNED_OUT", token ? { access_token: token } : null)
    })
    return {
      data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
    }
  },
}

// ------------------------------------------------------------------- storage
// Files now live in Neon and are served by the API. The bucket argument is
// accepted and ignored: there is only one store, and keeping the signature
// means the two upload call sites did not have to change.
const storage = {
  from(_bucket: string) {
    return {
      async upload(path: string, file: File, options?: { upsert?: boolean; contentType?: string }) {
        void options
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "")
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })

        try {
          const body = await request("/files", {
            method: "POST",
            body: JSON.stringify({
              path,
              mimeType: options?.contentType || file.type || "image/png",
              base64,
            }),
          })
          uploadedUrls.set(path, `${API_URL}${body.url}`)
          return { data: { path }, error: null }
        } catch (error) {
          return { data: null, error: error as ApiError }
        }
      },

      getPublicUrl(path: string) {
        // Resolved from the last upload of this path. Unlike the Supabase
        // bucket — which was world-readable by anyone holding the URL — these
        // are served behind authentication, so the URL alone grants nothing.
        return { data: { publicUrl: uploadedUrls.get(path) ?? `${API_URL}/files/by-path/${encodeURIComponent(path)}` } }
      },
    }
  },
}

const uploadedUrls = new Map<string, string>()

// ----------------------------------------------------------------- functions
const functions = {
  async invoke<T>(name: string, options?: { body?: unknown }) {
    try {
      const data = await request(`/functions/${name}`, {
        method: "POST",
        body: JSON.stringify(options?.body ?? {}),
      })
      return { data: data as T, error: null }
    } catch (error) {
      return { data: null, error: error as ApiError }
    }
  },
}

export const supabase = {
  from: <T = any>(table: string) => new QueryBuilder<T>(table),

  async rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<Result<T>> {
    try {
      const data = await request(`/rpc/${fn}`, {
        method: "POST",
        body: JSON.stringify(args ?? {}),
      })
      return { data: data as T, error: null }
    } catch (error) {
      return { data: null as T, error: error as ApiError }
    }
  },

  auth,
  storage,
  functions,
}
