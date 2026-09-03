/**
 * Applies neon/schema.sql to the Neon database.
 *
 * Refuses to run against a database that already has HRMS tables. The brief is
 * explicit that nothing may be overwritten, and an empty target is the only
 * situation where applying a schema cannot destroy anything.
 *
 *   npx tsx src/scripts/apply-schema.ts
 */
import { readFileSync } from "node:fs"
import { Pool } from "pg"
import { splitStatements } from "./split-sql.js"

const env: Record<string, string> = {}
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

const url = env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set in server/.env")

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 1 })

async function main() {
  const { rows: existing } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'"
  )

  if (existing.length > 0) {
    console.error(
      `Refusing to run: public already contains ${existing.length} table(s).\n` +
        `  ${existing.map((r) => r.tablename).join(", ")}\n\n` +
        `This script only applies to an empty schema, so that it can never\n` +
        `overwrite existing data. Drop them deliberately if that is what you want.`
    )
    process.exit(1)
  }

  const sql = readFileSync(new URL("../../../neon/schema.sql", import.meta.url), "utf8")
  console.log(`Applying neon/schema.sql (${sql.split("\n").length} lines)…\n`)

  const statements = splitStatements(sql)
  console.log(`  ${statements.length} statements\n`)

  const client = await pool.connect()
  try {
    // One transaction, but sent statement by statement. The whole file still
    // lands or none of it does; the difference is that a failure can name the
    // statement and line rather than leaving 4,484 lines to search.
    await client.query("begin")
    for (const stmt of statements) {
      try {
        await client.query(stmt.text)
      } catch (error) {
        await client.query("rollback").catch(() => {})
        const first = stmt.text.replace(/--[^\n]*\n/g, "").trim().split("\n").slice(0, 4).join("\n")
        console.error(`\nFailed at neon/schema.sql line ${stmt.line}:\n`)
        console.error(first.length > 400 ? first.slice(0, 400) + " …" : first)
        console.error(`\n  ${(error as Error).message}`)
        console.error(`\nNothing was applied — the transaction rolled back.`)
        process.exit(1)
      }
    }
    await client.query("commit")
    console.log("Applied.\n")
  } finally {
    client.release()
  }

  const counts = await pool.query<{ tables: string; views: string; funcs: string; policies: string }>(`
    select
      (select count(*) from pg_tables  where schemaname = 'public') as tables,
      (select count(*) from pg_views   where schemaname = 'public') as views,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as funcs,
      (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public') as policies
  `)
  const c = counts.rows[0]!
  console.log(`  tables   : ${c.tables}`)
  console.log(`  views    : ${c.views}`)
  console.log(`  functions: ${c.funcs}`)
  console.log(`  policies : ${c.policies}`)

  // The port only counts as correct if nothing still reaches for Supabase's
  // auth schema. Either of these coming back non-empty means policies that can
  // never match, and screens that will silently show nothing.
  const { rows: badPolicies } = await pool.query<{ table_name: string; policy: string }>(`
    select c.relname as table_name, p.polname as policy
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (pg_get_expr(p.polqual, p.polrelid) ilike '%auth.uid%'
           or pg_get_expr(p.polwithcheck, p.polrelid) ilike '%auth.uid%')
  `)

  const { rows: badFuncs } = await pool.query<{ proname: string }>(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      -- Ordinary functions only. pg_get_functiondef() raises on aggregates and
      -- window functions instead of returning null, which would abort the check.
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%auth.uid%'
  `)

  console.log()
  if (badPolicies.length === 0 && badFuncs.length === 0) {
    console.log("No policy or function still references auth.uid(). Port is clean.")
  } else {
    console.log("STILL REFERENCING auth.uid() — these will never match:")
    badPolicies.forEach((p) => console.log(`  policy   ${p.table_name}.${p.policy}`))
    badFuncs.forEach((f) => console.log(`  function ${f.proname}`))
  }

  await pool.end()
}

main().catch(async (error) => {
  console.error(`\nFailed: ${(error as Error).message}`)
  await pool.end().catch(() => {})
  process.exit(1)
})
