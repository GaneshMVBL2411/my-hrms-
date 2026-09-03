import "../env.js"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

/**
 * The live-database half of the /rpc allow-list check.
 *
 * `rpc-drift.test.ts` answers "is every function the clients call allow-listed?"
 * from source alone, so it can run in CI with no database. It cannot answer the
 * other half: whether an allow-listed function actually EXISTS.
 *
 * That gap matters. Allow-listing a name for a function nobody wrote does not
 * fix the screen — it converts a clear 404 into a Postgres 42883 and disguises
 * an unbuilt feature as a bug. This script connects to Neon and reports all
 * three sets against each other, so an entry is only ever added on evidence.
 *
 *   npm run db:rpc-drift
 *
 * Read-only: it introspects the catalogue and changes nothing.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "../../..")

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p)
  }
  return out
}

const called = new Set<string>()
for (const dir of ["frontend/src", "mobile/src"]) {
  let files: string[]
  try {
    files = sourceFiles(join(rootDir, dir))
  } catch {
    continue
  }
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(/\.rpc\(\s*"([a-z_][a-z0-9_]*)"/g)) {
      called.add(m[1]!)
    }
  }
}

// Parsed, not imported: importing index.ts starts the server.
const src = readFileSync(join(__dirname, "../index.ts"), "utf8")
const start = src.indexOf("const CALLABLE")
const block = src.slice(start, src.indexOf("])", start))
const allowed = new Set([...block.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]!))

// DATABASE_URL_OWNER only if present — this reads the catalogue, which the
// application role can do perfectly well on its own.
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
})
await client.connect()

const { rows } = await client.query<{ proname: string; args: string }>(
  `select p.proname, pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any($1)`,
  [[...new Set([...called, ...allowed])]]
)
await client.end()

const inDb = new Map(rows.map((r) => [r.proname, r.args]))

const callable = [...called].filter((f) => allowed.has(f) && inDb.has(f))
const blocked = [...called].filter((f) => !allowed.has(f) && inDb.has(f)).sort()
const unbuilt = [...called].filter((f) => !inDb.has(f)).sort()
const phantom = [...allowed].filter((f) => !inDb.has(f)).sort()
const unused = [...allowed].filter((f) => !called.has(f)).sort()

console.log(`Called by clients: ${called.size}   Allow-listed: ${allowed.size}   Working: ${callable.length}\n`)

if (blocked.length) {
  console.log(`BLOCKED but exists in the database — safe to add to CALLABLE (${blocked.length}):`)
  for (const f of blocked) console.log(`   + ${f.padEnd(30)}(${inDb.get(f)})`)
  console.log("")
}
if (unbuilt.length) {
  console.log(`CALLED but no such function — the feature is unbuilt, do NOT allow-list (${unbuilt.length}):`)
  for (const f of unbuilt) console.log(`   ! ${f}`)
  console.log("")
}
if (phantom.length) {
  console.log(`ALLOW-LISTED but no such function — dead entry, remove it (${phantom.length}):`)
  for (const f of phantom) console.log(`   ? ${f}`)
  console.log("")
}
if (unused.length) {
  console.log(`ALLOW-LISTED but no client calls it — unnecessary privilege (${unused.length}):`)
  for (const f of unused) console.log(`   - ${f}`)
  console.log("")
}

const problems = blocked.length + phantom.length + unused.length
console.log(problems === 0 ? "No drift." : `${problems} entr${problems === 1 ? "y" : "ies"} need attention.`)
// Unbuilt features are a known backlog, not drift, so they do not fail the run.
process.exit(problems === 0 ? 0 : 1)
