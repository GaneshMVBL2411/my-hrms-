import type { PoolClient } from "pg"

/**
 * Turns a described query into parameterised SQL.
 *
 * The frontend used PostgREST, whose grammar lives in the URL. Rather than
 * re-implement that grammar — which is large, and where a parsing mistake is a
 * security bug — the client sends a small JSON description and this builds the
 * statement from it. Both ends are ours, so there is nothing to be gained from
 * copying someone else's wire format.
 *
 * Two rules hold throughout:
 *
 *   * Identifiers (table, column) are validated against an allow-list or a
 *     strict pattern before they are ever put into SQL. They cannot be
 *     parameterised, so this is the only thing standing between a request and
 *     an injection.
 *   * Values are always bound. Never interpolated, no exceptions.
 *
 * Authorisation is not handled here at all. Every statement runs inside
 * withSession, so row level security decides what the caller may see — the same
 * policies that governed PostgREST.
 */

export type Operator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "like" | "ilike"

export interface Filter {
  column: string
  op: Operator
  value: unknown
}

export interface QueryRequest {
  table: string
  action: "select" | "insert" | "update" | "upsert" | "delete"
  columns?: string
  filters?: Filter[]
  /** PostgREST's `.or()` — a raw fragment, so it is parsed rather than trusted. */
  or?: string
  order?: { column: string; ascending: boolean }[]
  limit?: number
  offset?: number
  count?: boolean
  payload?: Record<string, unknown> | Record<string, unknown>[]
  onConflict?: string
  /** Whether the caller expects exactly one row (`.single()`). */
  single?: boolean
}

export interface QueryResult {
  data: unknown
  count: number | null
}

/** Postgres identifiers as this schema uses them: lower snake_case. */
const IDENT = /^[a-z_][a-z0-9_]*$/

function ident(name: string, what: string): string {
  if (!IDENT.test(name)) throw new QueryError(`Invalid ${what}: ${name}`)
  return `"${name}"`
}

export class QueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QueryError"
  }
}

/**
 * Views are read-only; tables may be written. Keeping them apart means a write
 * aimed at a view fails as "not writable" rather than as a confusing SQL error.
 */
export const READABLE = new Set([
  "employee_directory", "attendance_detail", "leave_balance_detail", "leave_request_detail",
  "project_directory", "project_member_detail", "task_directory", "task_comment_detail",
  "candidate_directory", "interview_detail", "asset_detail", "asset_assignment_detail",
  "salary_structure_detail", "payslip_detail", "policy_detail", "generated_letter_detail",
  "announcement_detail", "company_event_detail", "audit_log_detail", "message_detail",
])

/**
 * Writable, but never readable through this endpoint.
 *
 * A read is allowed for anything in READABLE *or* WRITABLE, which is what made
 * these two reachable: they are here to be written, and got selectable as a
 * side effect. What that exposed was not trivial.
 *
 *   users      every column, including `password_hash`. Any employee could
 *              list the bcrypt hash of every colleague's password — HR's and
 *              the founder's included — and take them away to crack offline.
 *              RLS was not at fault: it correctly scopes the rows to the
 *              company, and the leak is in the columns, which RLS cannot
 *              express.
 *   employees  every column, including pan_number, aadhaar_number,
 *              bank_account_number, bank_ifsc, dob and address.
 *
 * Both already have a curated read path that exists precisely so the raw table
 * does not need one: `employee_directory` for colleague data, /auth/me for the
 * session, and get_employee_detail for a full profile. The frontend selects
 * from neither table — it only updates `employees` — so nothing legitimate
 * loses a capability here.
 *
 * This is not authorisation moved into the app layer; RLS still decides every
 * row. It narrows which collections the generic endpoint will read at all,
 * which is the same kind of rule as the allow-lists above.
 */
export const WRITE_ONLY = new Set(["employees"])

export const WRITABLE = new Set([
  "employees", "departments", "designations", "leave_types",
  "leave_requests", "projects", "project_members", "tasks", "task_checklist_items",
  "task_comments", "assets", "asset_assignments", "candidates", "interviews",
  "salary_structures", "payslips", "policies", "generated_letters", "announcements",
  "company_events", "company_settings",
  "companies", "company_modules", "company_subscriptions",
  "platform_services", "company_services", "support_sessions", "messages",
])

export const PROHIBITED_COLUMNS: Record<string, Set<string>> = {
  employees: new Set(["pan_number", "aadhaar_number", "bank_account_number", "bank_ifsc", "company_id", "user_id"]),
  leave_requests: new Set(["status", "decided_by", "decided_at", "company_id"]),
  company_settings: new Set(["company_id"]),
  salary_structures: new Set(["company_id"]),
}

function checkProhibitedColumns(table: string, payload: Record<string, unknown>): void {
  const prohibited = PROHIBITED_COLUMNS[table]
  if (!prohibited) return
  for (const key of Object.keys(payload)) {
    if (prohibited.has(key)) {
      throw new QueryError(`Modifying protected column '${key}' on '${table}' is not permitted via generic query`)
    }
  }
}

/**
 * `.select("a, b, count")` — the column list is a comma-separated set of plain
 * identifiers. Anything else (embedded resources, aliases, functions) is
 * refused rather than passed through: PostgREST supported far more here, and
 * quietly accepting syntax that is then mis-parsed is worse than rejecting it.
 */
function columnList(columns: string | undefined): string {
  if (!columns || columns.trim() === "*") return "*"
  return columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => ident(c, "column"))
    .join(", ")
}

function applyFilters(
  filters: Filter[],
  params: unknown[],
  clauses: string[]
): void {
  for (const f of filters) {
    const col = ident(f.column, "column")
    switch (f.op) {
      case "in": {
        const values = Array.isArray(f.value) ? f.value : [f.value]
        if (values.length === 0) {
          // `in ()` is a syntax error; an empty set matches nothing.
          clauses.push("false")
          break
        }
        const placeholders = values.map((v) => {
          params.push(v)
          return `$${params.length}`
        })
        clauses.push(`${col} in (${placeholders.join(", ")})`)
        break
      }
      case "is":
        // Only null is meaningful here, and it cannot be a bound parameter.
        if (f.value !== null) throw new QueryError("`is` only supports null")
        clauses.push(`${col} is null`)
        break
      case "like":
      case "ilike":
        params.push(f.value)
        clauses.push(`${col} ${f.op} $${params.length}`)
        break
      default: {
        const sqlOp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op]
        params.push(f.value)
        clauses.push(`${col} ${sqlOp} $${params.length}`)
      }
    }
  }
}

/**
 * PostgREST's `.or("a.ilike.x,b.ilike.y")`. Parsed into the same validated
 * filter shape rather than passed through, so the identifiers inside it get the
 * same checking as everywhere else.
 */
function applyOr(or: string, params: unknown[], clauses: string[]): void {
  const parts = or.split(",").map((p) => p.trim()).filter(Boolean)
  const ors: string[] = []

  for (const part of parts) {
    const [column, op, ...rest] = part.split(".")
    const value = rest.join(".")
    if (!column || !op) throw new QueryError(`Malformed or(): ${part}`)

    const sub: string[] = []
    applyFilters([{ column, op: op as Operator, value }], params, sub)
    ors.push(sub[0]!)
  }

  if (ors.length > 0) clauses.push(`(${ors.join(" or ")})`)
}

/**
 * Which tables carry a company_id, discovered once from the catalogue.
 *
 * Read from the database rather than hard-coded so a table added later is
 * covered automatically — a list maintained by hand is a list that eventually
 * misses one, and the failure mode is rows belonging to no tenant.
 */
let tenantColumns: Set<string> | null = null

async function tablesWithCompanyId(client: PoolClient): Promise<Set<string>> {
  if (tenantColumns) return tenantColumns
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'company_id'`
  )
  tenantColumns = new Set(rows.map((r) => r.table_name))
  return tenantColumns
}

/**
 * Stamps the caller's company onto rows being written, and refuses to let a
 * client set or change it.
 *
 * This is the concrete form of "never trust a company_id from the frontend".
 * PostgREST had the same problem and the same answer — the value comes from the
 * authenticated session, and anything the client sent is discarded rather than
 * merged, so a crafted payload cannot place a row in another tenant.
 *
 * It is also what makes inserts work at all: the RLS policies check
 * `company_id = app_company_id()` in WITH CHECK, and a row without one fails
 * that check no matter who is signed in.
 */
function stampCompany(
  payload: Record<string, unknown>,
  companyId: number | null,
  action: "insert" | "upsert" | "update"
): Record<string, unknown> {
  const row = { ...payload }

  // On update the column is removed rather than overwritten: changing it would
  // move an existing row between tenants, which nothing should ever do.
  delete row.company_id

  if (action !== "update") {
    if (companyId === null) {
      throw new QueryError("No company in this session; cannot create records")
    }
    row.company_id = companyId
  }

  return row
}

export async function runQuery(
  client: PoolClient,
  req: QueryRequest,
  companyId: number | null = null
): Promise<QueryResult> {
  const isRead = req.action === "select"
  const allowed = isRead
    ? (READABLE.has(req.table) || WRITABLE.has(req.table)) && !WRITE_ONLY.has(req.table)
    : WRITABLE.has(req.table)
  if (!allowed) {
    // A write-only table reports the view to use instead. "Unknown collection"
    // would be a lie about a table that plainly exists, and would send whoever
    // hit it looking for a typo rather than for the right collection.
    if (isRead && WRITE_ONLY.has(req.table)) {
      throw new QueryError(
        `${req.table} is not readable directly — use employee_directory, /auth/me or get_employee_detail`
      )
    }
    throw new QueryError(
      isRead ? `Unknown collection: ${req.table}` : `Collection is not writable: ${req.table}`
    )
  }

  const table = `public.${ident(req.table, "table")}`
  const params: unknown[] = []
  const where: string[] = []

  if (req.filters?.length) applyFilters(req.filters, params, where)
  if (req.or) applyOr(req.or, params, where)
  const whereSql = where.length ? ` where ${where.join(" and ")}` : ""

  let sql: string

  switch (req.action) {
    case "select": {
      const orderSql = req.order?.length
        ? " order by " +
          req.order
            .map((o) => `${ident(o.column, "column")} ${o.ascending ? "asc" : "desc"}`)
            .join(", ")
        : ""

      let tail = ""
      const DEFAULT_LIMIT = 500
      const MAX_LIMIT = 1000
      const limit = req.limit != null ? Math.min(Math.max(1, Number(req.limit) || DEFAULT_LIMIT), MAX_LIMIT) : DEFAULT_LIMIT
      params.push(limit)
      tail += ` limit $${params.length}`

      if (req.offset != null) {
        const offset = Math.max(0, Number(req.offset) || 0)
        params.push(offset)
        tail += ` offset $${params.length}`
      }

      sql = `select ${columnList(req.columns)} from ${table}${whereSql}${orderSql}${tail}`
      break
    }

    case "insert":
    case "upsert": {
      const raw = Array.isArray(req.payload) ? req.payload : [req.payload ?? {}]
      if (raw.length === 0) return { data: [], count: 0 }

      for (const r of raw) {
        checkProhibitedColumns(req.table, r as Record<string, unknown>)
      }

      const tenantTables = await tablesWithCompanyId(client)
      const rows = tenantTables.has(req.table)
        ? raw.map((r) => stampCompany(r as Record<string, unknown>, companyId, req.action as "insert" | "upsert"))
        : raw

      // Every row must present the same columns; Postgres requires a uniform
      // VALUES shape, and the frontend always builds rows this way.
      const keys = Object.keys(rows[0]!)
      if (keys.length === 0) throw new QueryError("Nothing to insert")

      const cols = keys.map((k) => ident(k, "column")).join(", ")
      const tuples = rows.map(
        (row) =>
          `(${keys
            .map((k) => {
              params.push(row[k] ?? null)
              return `$${params.length}`
            })
            .join(", ")})`
      )

      let conflict = ""
      if (req.action === "upsert") {
        const target = (req.onConflict ?? "id")
          .split(",")
          .map((c) => ident(c.trim(), "column"))
          .join(", ")
        const updates = keys
          .filter((k) => !(req.onConflict ?? "id").split(",").map((c) => c.trim()).includes(k))
          .map((k) => `${ident(k, "column")} = excluded.${ident(k, "column")}`)
          .join(", ")
        conflict = updates
          ? ` on conflict (${target}) do update set ${updates}`
          : ` on conflict (${target}) do nothing`
      }

      sql = `insert into ${table} (${cols}) values ${tuples.join(", ")}${conflict} returning ${columnList(req.columns)}`
      break
    }

    case "update": {
      checkProhibitedColumns(req.table, (req.payload ?? {}) as Record<string, unknown>)
      const tenantTables = await tablesWithCompanyId(client)
      const payload = tenantTables.has(req.table)
        ? stampCompany((req.payload ?? {}) as Record<string, unknown>, companyId, "update")
        : ((req.payload ?? {}) as Record<string, unknown>)
      const keys = Object.keys(payload)
      if (keys.length === 0) throw new QueryError("Nothing to update")

      // Built before the WHERE placeholders so the numbering stays in order.
      const sets: string[] = []
      const setParams: unknown[] = []
      for (const k of keys) {
        setParams.push(payload[k])
        sets.push(`${ident(k, "column")} = $${setParams.length}`)
      }

      const shifted: string[] = []
      const filterParams: unknown[] = []
      if (req.filters?.length) applyFilters(req.filters, filterParams, shifted)

      const renumbered = shifted.map((clause) =>
        clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + setParams.length}`)
      )

      params.length = 0
      params.push(...setParams, ...filterParams)

      sql =
        `update ${table} set ${sets.join(", ")}` +
        (renumbered.length ? ` where ${renumbered.join(" and ")}` : "") +
        ` returning ${columnList(req.columns)}`
      break
    }

    case "delete": {
      // An unfiltered delete empties the table. RLS would still limit it to
      // rows the caller may reach, which for HR is all of them — so it is
      // refused outright rather than relied upon.
      if (!where.length) throw new QueryError("A delete must have at least one filter")
      sql = `delete from ${table}${whereSql} returning ${columnList(req.columns)}`
      break
    }
  }

  const result = await client.query(sql, params)

  let count: number | null = null
  if (req.count && isRead) {
    // Recounted without limit/offset, which is what `{ count: "exact" }` meant.
    const countParams = params.slice(0, params.length - (req.limit != null ? 1 : 0) - (req.offset != null ? 1 : 0))
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from ${table}${whereSql}`,
      countParams
    )
    count = Number(rows[0]!.n)
  }

  if (req.single) {
    if (result.rows.length === 0) return { data: null, count }
    return { data: result.rows[0], count }
  }

  return { data: result.rows, count }
}
