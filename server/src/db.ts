import pg, { Pool, type PoolClient } from "pg"

/**
 * Return DATE columns as the plain "YYYY-MM-DD" string Postgres stores.
 *
 * By default node-postgres turns a DATE into a JavaScript Date at LOCAL
 * midnight. Serialised to JSON that becomes a UTC instant, so in any timezone
 * ahead of UTC the date moves back a day: a joining date of 2026-04-09 reaches
 * the browser as 2026-04-08T18:30:00.000Z and renders as the 8th.
 *
 * PostgREST sent these as strings, so the HRMS has always treated them as
 * strings — `joiningDate` is typed as one throughout, and the payslip and
 * letter views format them directly. Restoring that behaviour keeps the
 * migration invisible to every screen rather than requiring each to
 * compensate.
 *
 * Applies to DATE (1082) only. Timestamps are genuine instants and are left as
 * Date objects.
 */
pg.types.setTypeParser(1082, (value: string) => value)

/**
 * The database layer for Neon.
 *
 * Its whole job is to make sure no query ever reaches Postgres without the
 * caller's identity attached, because on Neon the identity is not carried by
 * the connection — it is something this file has to put there. On Supabase the
 * JWT travelled with the request and `auth.uid()` read it; here the API server
 * is the only thing that knows who is calling, so if it forgets to say, row
 * level security sees an anonymous caller and denies everything.
 *
 * The failure mode in the other direction is worse and quieter: a connection
 * reused from the pool while still carrying the previous request's identity
 * would serve one company's data to another. Everything below exists to make
 * that impossible rather than merely unlikely.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Point it at the Neon connection string for the " +
      "hrms_app role — not the Neon default role, which owns the tables and is " +
      "therefore exempt from row level security."
  )
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon terminates TLS at the proxy and presents its own certificate chain.
  ssl: { rejectUnauthorized: true },
  // Neon's pooled endpoint multiplexes, so a large client-side pool buys
  // nothing and just holds connections open against the plan's ceiling.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

/**
 * Keeps a dropped idle connection from taking the server with it.
 *
 * Without this the API died, repeatedly, with "Connection terminated
 * unexpectedly" and no further explanation. The cause is ordinary and
 * unavoidable: Neon closes pooled connections that have been idle, and pg
 * surfaces that as an `error` event on the idle client. An `error` event with
 * no listener is not an error in Node — it is a thrown exception that nothing
 * catches, so the process exits. A backend that stops serving because nobody
 * made a request for a few minutes.
 *
 * The pool has already discarded the client by the time this runs; there is
 * nothing to repair and the next request gets a fresh connection. So this
 * logs and returns, which is the whole fix. It is deliberately not silent —
 * a burst of these means something about the network or the plan's connection
 * ceiling is worth looking at, and that signal should survive.
 */
pool.on("error", (error) => {
  console.error(`[db] idle client dropped: ${error.message}`)
})

pool.on("connect", (client) => {
  client.on("error", (error) => {
    console.error(`[db] client socket error: ${error.message}`)
  })
})

export interface SessionContext {
  /** public.users.id of the authenticated caller. */
  userId: number
  /**
   * The company whose data this request may touch. Null only for a platform
   * super admin outside support mode — and with it null, every tenant policy
   * matches nothing, which is the intended outcome.
   */
  companyId: number | null
}

/**
 * Runs `fn` inside a transaction that carries the caller's identity.
 *
 * `set local` rather than `set` is the important detail. A plain `set` persists
 * for the lifetime of the connection, and a pooled connection outlives the
 * request that borrowed it — so the next request, possibly from a different
 * company, would inherit this one's identity. `set local` is scoped to the
 * transaction and discarded on commit or rollback, which is what makes pooling
 * safe here.
 *
 * Parameterised rather than interpolated: `set_config` takes values, so a
 * hostile id cannot break out of the statement. String-building a `SET` is the
 * obvious shortcut and is an injection point.
 */
export async function withSession<T>(
  ctx: SessionContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query("select set_config('app.user_id', $1, true)", [String(ctx.userId)])
    await client.query("select set_config('app.company_id', $1, true)", [
      ctx.companyId === null ? "" : String(ctx.companyId),
    ])

    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {
      // The rollback itself can fail if the connection died mid-transaction.
      // Releasing with an error below discards the connection either way, so
      // there is nothing further to do and rethrowing this would mask the
      // original failure.
    })
    throw error
  } finally {
    client.release()
  }
}

/**
 * For the few operations that legitimately run before a caller is known —
 * signing in, and looking a user up by email to do so.
 *
 * Deliberately separate and deliberately awkward to reach: anything routed
 * through here bypasses tenant isolation entirely, so it must stay a short,
 * auditable list rather than a convenient escape hatch.
 */
export async function withoutSession<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/** Confirms the server is talking to Neon, and as the right role. */
export async function checkConnection(): Promise<{
  database: string
  role: string
  isOwner: boolean
  version: string
}> {
  const { rows } = await pool.query<{
    database: string
    role: string
    is_owner: boolean
    version: string
  }>(`
    select
      current_database() as database,
      current_user       as role,
      -- Owning a table means being exempt from its own RLS. If this is true,
      -- the policies are not protecting anything and the server is misconfigured.
      exists (
        select 1 from pg_tables
        where schemaname = 'public' and tableowner = current_user
        limit 1
      ) as is_owner,
      version() as version
  `)

  const row = rows[0]
  if (!row) {
    // A select of constants returning nothing means the connection is not in a
    // usable state at all, which is worth saying plainly rather than surfacing
    // as an undefined-property error further up.
    throw new Error("Database did not answer the connection check")
  }

  return {
    database: row.database,
    role: row.role,
    isOwner: row.is_owner,
    version: row.version,
  }
}
