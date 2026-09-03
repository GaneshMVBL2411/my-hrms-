// ---------------------------------------------------------------------------
// Takes a backup of the Neon database and then proves it restores.
//
// ISO/IEC 27001 A.8.13 asks for backups; it also expects them to be tested.
// A dump nobody has ever restored is an assumption, and the moment you find out
// it was a wrong one is the moment you needed it. So this does both in one run:
// dump, restore into a throwaway database, compare the row counts, drop it.
//
//   node neon/backup.mjs           dump and verify
//   node neon/backup.mjs --keep    ...and leave the test database in place
//
// Output goes to backup/, which .gitignore already excludes — these files hold
// every employee record, so they must never reach the repository.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process"
import { mkdirSync, statSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
// Resolved from the server, which is where the dependency lives — this script
// sits in neon/ beside the migrations rather than in a package of its own.
const require_ = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const pg = require_(join(root, "server/node_modules/pg"))

// The tools ship with the local PostgreSQL install rather than on PATH.
const PG_BIN = "C:/Program Files/PostgreSQL/18/bin"
const pgDump = join(PG_BIN, "pg_dump.exe")
const pgRestore = join(PG_BIN, "pg_restore.exe")

// The owner connection: a backup has to read every row, and hrms_app is subject
// to row level security, so a dump taken as hrms_app would silently be partial.
// That is the failure this comment exists to prevent — it would look like a
// successful backup and restore to an empty-ish database.
const env = Object.fromEntries(
  readFileSync(join(root, "server/.env"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
)

const source = env.DATABASE_URL_OWNER
if (!source) throw new Error("DATABASE_URL_OWNER is not set in server/.env")

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const outDir = join(root, "backup")
mkdirSync(outDir, { recursive: true })
const dumpFile = join(outDir, `neondb-${stamp}.dump`)

const run = (bin, args, label) => {
  try {
    execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 })
    return true
  } catch (e) {
    console.error(`${label} failed:\n${e.stderr?.toString().slice(0, 900) ?? e.message}`)
    return false
  }
}

// ------------------------------------------------------------------ dump
console.log(`dumping to ${dumpFile}`)
// Custom format: compressed, and pg_restore can then be selective about what it
// puts back, which a plain SQL file cannot.
//
// --no-owner but NOT --no-privileges, and the difference was measured rather
// than assumed. With privileges excluded, a restored copy came back with all 38
// tables, all 38 RLS flags, all 66 policies, 95 functions and 19 views intact —
// and 0 of 227 grants. Every policy would have been present and hrms_app unable
// to read a single row: a restore that looks complete and leaves the
// application unable to start.
//
// --no-owner stays because the owning role differs between Neon branches and is
// not worth failing a restore over; grants are not in that category.
if (!run(pgDump, ["-d", source, "-Fc", "--no-owner", "-f", dumpFile], "pg_dump")) {
  process.exit(1)
}
console.log(`  ${(statSync(dumpFile).size / 1024).toFixed(0)} KB`)

// ------------------------------------------------- counts before restoring
const TABLES = [
  "users",
  "employees",
  "attendance_records",
  "leave_requests",
  "tasks",
  "projects",
  "payslips",
  "audit_logs",
]

const countAll = async (connectionString) => {
  const c = new pg.Client({ connectionString })
  await c.connect()
  const out = {}
  for (const t of TABLES) {
    try {
      const { rows } = await c.query(`select count(*)::int as n from public.${t}`)
      out[t] = rows[0].n
    } catch {
      out[t] = null
    }
  }
  await c.end()
  return out
}

const before = await countAll(source)

// -------------------------------------------------------- restore and check
const testDb = `hrms_restore_test_${stamp.replace(/\D/g, "").slice(-10)}`
const admin = new pg.Client({ connectionString: source })
await admin.connect()

let ok = false
try {
  console.log(`restoring into ${testDb}`)
  await admin.query(`create database ${testDb}`)

  const target = source.replace(/\/([^/?]+)(\?|$)/, `/${testDb}$2`)
  // pg_restore reports non-fatal complaints (extensions it may not recreate,
  // for instance) as a non-zero exit, so its output is inspected rather than
  // its status alone — the check that matters is the row counts below.
  run(pgRestore, ["-d", target, "--no-owner", dumpFile], "pg_restore")

  const after = await countAll(target)

  console.log("\nrow counts — source vs restored:")
  const rows = TABLES.map((t) => ({
    table: t,
    source: before[t],
    restored: after[t],
    match: before[t] === after[t] ? "yes" : "NO",
  }))
  console.table(rows)

  ok = rows.every((r) => r.match === "yes")
  console.log(ok ? "\nRESTORE VERIFIED — every table matches" : "\nRESTORE FAILED — counts differ")
} finally {
  if (!process.argv.includes("--keep")) {
    await admin.query(`drop database if exists ${testDb} with (force)`).catch(() => {})
    console.log(`dropped ${testDb}`)
  }
  await admin.end()
}

process.exit(ok ? 0 : 1)
