/**
 * Copies the live HRMS data from Supabase into Neon.
 *
 * Reads through PostgREST as an HR user — the only access available without the
 * service key — and writes straight into Neon with the pg driver.
 *
 * Three things this has to reconcile:
 *
 *   1. company_id. Supabase predates multi-tenancy and has no such column;
 *      Neon requires it on 23 tables. Everything is assigned to company #1,
 *      the tenant that 0011 created for exactly this data.
 *
 *   2. Reference data. Applying the schema also ran 0004, so Neon already holds
 *      roles, departments and leave types with ids of its own. Those are cleared
 *      and replaced with Supabase's rows, ids intact, so every foreign key that
 *      points at them stays correct without remapping.
 *
 *   3. Sensitive employee columns. 0002 revokes `select` on employees and grants
 *      it column by column, so a plain read returns no PAN, Aadhaar or bank
 *      details. Those come from get_employee_detail(), one call per employee.
 *
 * Re-runnable: every table is emptied before it is filled, so a second run
 * replaces rather than duplicates. It only ever writes to Neon — Supabase is
 * opened read-only and is never modified.
 *
 *   npx tsx src/scripts/migrate-data.ts
 */
import { readFileSync } from "node:fs"
import { Pool } from "pg"

const env: Record<string, string> = {}
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

const frontendEnv: Record<string, string> = {}
for (const line of readFileSync(new URL("../../../frontend/.env", import.meta.url), "utf8").split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) frontendEnv[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

const SUPABASE_URL = frontendEnv.VITE_SUPABASE_URL!
const SUPABASE_KEY = frontendEnv.VITE_SUPABASE_ANON_KEY!
const NEON_URL = env.DATABASE_URL!

const HR_EMAIL = process.env.HR_EMAIL ?? "hr@whhoohhpath.com"
const HR_PASSWORD = process.env.HR_PASSWORD
if (!HR_PASSWORD) {
  throw new Error("HR_PASSWORD environment variable is required to run migrate-data.ts")
}

const COMPANY_ID = 1

/** Exactly the columns 0002 grants on `employees`, in the same order. */
const EMPLOYEE_GRANTED_COLUMNS = [
  "id", "user_id", "employee_code", "first_name", "last_name", "phone", "address",
  "dob", "gender", "department_id", "designation_id", "reporting_manager_id",
  "joining_date", "skills", "experience_years", "photo_url", "status",
  "created_at", "updated_at",
].join(",")
// full_name is granted but omitted deliberately: it is a generated column on
// both sides, so writing it raises "cannot insert into generated column".

const pool = new Pool({ connectionString: NEON_URL, ssl: { rejectUnauthorized: true }, max: 1 })

let token = ""

async function supabase(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`)
  // res.json() is unknown in current lib types; this endpoint returns a list.
  return (await res.json()) as any[]
}

async function rpc(fn: string, body: unknown): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`RPC ${fn} -> ${res.status}: ${await res.text()}`)
  // res.json() is unknown in current lib types; this endpoint returns a list.
  return (await res.json()) as any[]
}

/**
 * Which tables move, in an order that satisfies the foreign keys, and whether
 * Neon needs a company_id added.
 *
 * leave_types is listed with tenant:false on purpose — a null company_id there
 * means a platform-wide default offered to every tenant, which is what these
 * five are.
 */
const TABLES: { name: string; tenant: boolean }[] = [
  { name: "roles", tenant: false },
  { name: "permissions", tenant: false },
  { name: "role_permissions", tenant: false },
  { name: "departments", tenant: true },
  { name: "designations", tenant: true },
  { name: "leave_types", tenant: false },
  { name: "users", tenant: true },
  { name: "employees", tenant: true },
  { name: "attendance_records", tenant: true },
  { name: "leave_balances", tenant: true },
  { name: "leave_requests", tenant: true },
  { name: "projects", tenant: true },
  { name: "project_members", tenant: true },
  { name: "tasks", tenant: true },
  { name: "task_checklist_items", tenant: true },
  { name: "task_comments", tenant: true },
  { name: "assets", tenant: true },
  { name: "asset_assignments", tenant: true },
  { name: "candidates", tenant: true },
  { name: "interviews", tenant: true },
  { name: "salary_structures", tenant: true },
  { name: "payslips", tenant: true },
  { name: "policies", tenant: true },
  { name: "generated_letters", tenant: true },
  { name: "announcements", tenant: true },
  { name: "company_events", tenant: true },
  { name: "company_settings", tenant: true },
  { name: "audit_logs", tenant: true },
]

async function neonColumns(client: any, table: string): Promise<Set<string>> {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table]
  )
  return new Set(rows.map((r: { column_name: string }) => r.column_name))
}

async function main() {
  console.log("Signing in to Supabase…")
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: HR_EMAIL, password: HR_PASSWORD }),
  })
  if (!authRes.ok) throw new Error(`Supabase sign-in failed: ${await authRes.text()}`)
  token = ((await authRes.json()) as { access_token: string }).access_token
  console.log(`  signed in as ${HR_EMAIL}\n`)

  const client = await pool.connect()
  const summary: { table: string; read: number; written: number }[] = []

  try {
    await client.query("begin")
    // The copy sets explicit ids, which would otherwise collide with rows the
    // schema's own reference data created. Constraints stay on; only ordering
    // is relaxed, and the commit still enforces everything.
    await client.query("set constraints all deferred")

    // Emptied in reverse dependency order so nothing is orphaned mid-run.
    for (const t of [...TABLES].reverse()) {
      await client.query(`delete from public.${t.name}`)
    }

    for (const t of TABLES) {
      // `select=*` needs SELECT on every column, and 0002 revokes it on
      // employees then grants back a specific list — withholding PAN, Aadhaar
      // and bank details from ordinary reads. Asking for `*` is refused
      // outright, so this table is fetched by naming exactly what is granted;
      // the withheld columns arrive later via get_employee_detail().
      const select = t.name === "employees" ? EMPLOYEE_GRANTED_COLUMNS : "*"
      const rows = await supabase(`${t.name}?select=${select}`)
      const cols = await neonColumns(client, t.name)

      let written = 0
      for (const row of rows) {
        const record: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) {
          // Supabase may expose columns Neon does not have, and vice versa;
          // copying only the intersection keeps the two schemas from having to
          // match exactly.
          if (cols.has(k)) record[k] = v
        }
        if (t.tenant && cols.has("company_id")) record.company_id = COMPANY_ID

        const keys = Object.keys(record)
        if (keys.length === 0) continue

        await client.query(
          `insert into public.${t.name} (${keys.map((k) => `"${k}"`).join(", ")})
           values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
          keys.map((k) => record[k])
        )
        written++
      }

      summary.push({ table: t.name, read: rows.length, written })
      if (rows.length > 0) console.log(`  ${t.name.padEnd(24)} ${written}`)
    }

    // ------------------------------------------------ sensitive employee columns
    // Withheld by the column grants on a plain read; fetched per employee.
    const employees = await supabase("employees?select=id")
    let enriched = 0
    for (const e of employees) {
      const detail = await rpc("get_employee_detail", { p_id: e.id })
      if (!detail) continue
      await client.query(
        `update public.employees
            set pan_number = $2, aadhaar_number = $3, bank_account_number = $4,
                bank_ifsc = $5, bank_name = $6
          where id = $1`,
        [
          e.id,
          detail.pan_number ?? null,
          detail.aadhaar_number ?? null,
          detail.bank_account_number ?? null,
          detail.bank_ifsc ?? null,
          detail.bank_name ?? null,
        ]
      )
      enriched++
    }
    console.log(`  ${"(employee id/bank)".padEnd(24)} ${enriched}`)

    // ------------------------------------------------------------- sequences
    // Explicit ids were inserted, so every serial is still at 1 and the next
    // insert would collide. Advanced past the highest id in each table.
    const { rows: seqs } = await client.query<{ table_name: string; column_name: string; seq: string }>(`
      select
        c.table_name,
        c.column_name,
        pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) as seq
      from information_schema.columns c
      where c.table_schema = 'public'
        and pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) is not null
    `)
    for (const s of seqs) {
      await client.query(
        `select setval($1, coalesce((select max(${s.column_name}) from public.${s.table_name}), 0) + 1, false)`,
        [s.seq]
      )
    }
    console.log(`\n  ${seqs.length} sequences advanced past the imported ids`)

    await client.query("commit")
    console.log("\nCommitted.\n")
  } catch (error) {
    await client.query("rollback").catch(() => {})
    console.error(`\nFailed: ${(error as Error).message}`)
    console.error("Nothing was written — the transaction rolled back.")
    process.exit(1)
  } finally {
    client.release()
  }

  const total = summary.reduce((n, s) => n + s.written, 0)
  console.log(`${total} rows now in Neon across ${summary.filter((s) => s.written > 0).length} tables.`)

  await pool.end()
}

main().catch(async (error) => {
  console.error(`\nFailed: ${(error as Error).message}`)
  await pool.end().catch(() => {})
  process.exit(1)
})
