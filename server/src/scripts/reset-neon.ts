/**
 * Drops and recreates the `public` schema on Neon.
 *
 * For recovering from a partially-applied load: a failed apply can leave tables
 * behind, and the applier refuses to run against a non-empty schema, so there
 * has to be a deliberate way back to empty.
 *
 * DESTRUCTIVE. Guarded by a row count: if any HRMS table holds data, this stops
 * rather than discarding it. That makes it safe while the schema is being
 * established and unsafe-by-refusal the moment real records exist.
 *
 *   npx tsx src/scripts/reset-neon.ts
 */
import { readFileSync } from "node:fs"
import { Pool } from "pg"

const env: Record<string, string> = {}
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}

const url = env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set in server/.env")

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 1 })

async function main() {
  const { rows: tables } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  )

  if (tables.length === 0) {
    console.log("public is already empty. Nothing to do.")
    await pool.end()
    return
  }

  // Count every table before dropping anything. A schema that is merely
  // structural can be rebuilt in seconds; one with rows in it cannot.
  let populated: { table: string; rows: number }[] = []
  for (const t of tables) {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from public.${t.tablename}`
    )
    const n = Number(rows[0]!.n)
    if (n > 0) populated.push({ table: t.tablename, rows: n })
  }

  const force = process.argv.includes("--force")

  if (populated.length > 0 && !force) {
    console.error("Refusing to run: these tables contain data.\n")
    populated.forEach((p) => console.error(`  ${p.table.padEnd(28)} ${p.rows} rows`))
    console.error(
      "\nRe-run with --force only if you are certain this is reference data from a\n" +
        "failed load rather than real records. There is no undo."
    )
    process.exit(1)
  }

  if (populated.length > 0) {
    const total = populated.reduce((sum, p) => sum + p.rows, 0)
    console.log(`--force: discarding ${total} rows across ${populated.length} tables.`)
  }

  console.log(`Dropping ${tables.length} empty tables (schema only, no data)…`)
  await pool.query("drop schema public cascade")
  await pool.query("create schema public")
  // Neon's default role owns the schema; restore the grants a fresh database has.
  await pool.query("grant all on schema public to public")
  console.log("public recreated, empty.")

  await pool.end()
}

main().catch(async (error) => {
  console.error(`\nFailed: ${(error as Error).message}`)
  await pool.end().catch(() => {})
  process.exit(1)
})
