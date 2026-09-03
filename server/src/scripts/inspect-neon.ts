/**
 * Phase 2 — read-only inspection of the Neon database.
 *
 * Answers one question: does Neon already hold the HRMS schema, or is it empty?
 * Writes nothing, creates nothing, drops nothing. The brief is explicit that
 * nothing may be overwritten without approval, so this script is deliberately
 * incapable of changing anything.
 *
 *   npx tsx src/scripts/inspect-neon.ts
 */
import { readFileSync } from "node:fs"
import { Pool } from "pg"

// Loaded by hand rather than with dotenv: one fewer dependency, and the parsing
// needed here is trivial.
//
// The file wins over the ambient environment, deliberately. This machine already
// exports a DATABASE_URL pointing at an unrelated local database, and deferring
// to it meant this script silently inspected the wrong server — which is a very
// convincing way to conclude "Neon is empty" about a database you never opened.
const env: Record<string, string> = {}
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) {
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
}

const url = env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set in server/.env")

/** Never print the password, not even into a local terminal. */
function masked(connectionString: string): string {
  return connectionString.replace(/:\/\/([^:]+):[^@]+@/, "://$1:********@")
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 2 })

// The tables the HRMS needs. Compared against what is actually there so the
// report can say precisely what is missing rather than "not ready".
const REQUIRED = [
  "roles", "permissions", "role_permissions", "users", "departments", "designations",
  "employees", "attendance_records", "leave_types", "leave_balances", "leave_requests",
  "projects", "project_members", "tasks", "task_checklist_items", "task_comments",
  "assets", "asset_assignments", "candidates", "interviews",
  "salary_structures", "payslips", "policies", "generated_letters",
  "announcements", "company_events", "company_settings", "audit_logs",
]

const TENANCY = [
  "companies", "company_modules", "subscription_plans", "company_subscriptions",
  "platform_services", "company_services", "support_sessions",
]

async function main() {
  console.log(`Inspecting: ${masked(url!)}\n`)

  const meta = await pool.query<{
    database: string
    role: string
    version: string
    is_owner: boolean
  }>(`
    select
      current_database() as database,
      current_user       as role,
      version()          as version,
      exists (
        select 1 from pg_tables
        where schemaname = 'public' and tableowner = current_user limit 1
      ) as is_owner
  `)
  const m = meta.rows[0]!
  console.log(`  database : ${m.database}`)
  console.log(`  role     : ${m.role}`)
  console.log(`  version  : ${m.version.split(",")[0]}`)
  console.log()

  const { rows: tables } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  )
  const present = new Set(tables.map((t) => t.tablename))

  console.log(`  tables in public: ${present.size}`)
  if (present.size > 0) {
    console.log(`    ${[...present].join(", ")}`)
  }
  console.log()

  const missingCore = REQUIRED.filter((t) => !present.has(t))
  const missingTenancy = TENANCY.filter((t) => !present.has(t))

  // Anything already there is reported so nothing gets overwritten unknowingly.
  const unexpected = [...present].filter(
    (t) => !REQUIRED.includes(t) && !TENANCY.includes(t)
  )

  const { rows: views } = await pool.query<{ count: string }>(
    "select count(*) from pg_views where schemaname = 'public'"
  )
  const { rows: funcs } = await pool.query<{ count: string }>(
    `select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`
  )
  const { rows: policies } = await pool.query<{ count: string }>(
    `select count(*) from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`
  )

  console.log(`  views    : ${views[0]!.count}`)
  console.log(`  functions: ${funcs[0]!.count}`)
  console.log(`  policies : ${policies[0]!.count}`)
  console.log()

  console.log("=".repeat(52))
  if (missingCore.length === 0 && missingTenancy.length === 0) {
    console.log("NEON DATABASE IS READY")
    console.log("All required tables are present.")
  } else {
    console.log("NEON DATABASE IS NOT READY")
    console.log()
    if (missingCore.length) {
      console.log(`Missing core tables (${missingCore.length}/${REQUIRED.length}):`)
      console.log(`  ${missingCore.join(", ")}`)
    }
    if (missingTenancy.length) {
      console.log(`Missing tenancy tables (${missingTenancy.length}/${TENANCY.length}):`)
      console.log(`  ${missingTenancy.join(", ")}`)
    }
    if (unexpected.length) {
      console.log(`\nTables already here that the HRMS does not define:`)
      console.log(`  ${unexpected.join(", ")}`)
      console.log(`  These would NOT be touched by neon/schema.sql.`)
    }
    console.log()
    console.log("No changes were made. Applying the schema needs explicit approval.")
  }
  console.log("=".repeat(52))

  await pool.end()
}

main().catch(async (error) => {
  console.error(`\nConnection failed: ${(error as Error).message}`)
  await pool.end().catch(() => {})
  process.exit(1)
})
