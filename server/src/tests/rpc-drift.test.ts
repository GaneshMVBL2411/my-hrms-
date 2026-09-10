import assert from "node:assert/strict"
import "../env.js"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Guards the /rpc allow-list against drift.
 *
 * The allow-list exists so a caller cannot invoke arbitrary SQL functions by
 * name. Being a list, it goes stale: a screen added later calls something that
 * is not on it, the call 404s, and the person debugging it reaches for the
 * quickest fix — widening the list — without checking what the new entry
 * exposes. That is how an allow-list quietly stops being one.
 *
 * This test makes the drift visible at build time instead. It was written after
 * `app_employee_id` was missing for long enough that four "my ..." screens were
 * broken in production and the breakage was mistaken for a data problem.
 *
 * Deliberately static: it reads source rather than connecting to Postgres, so it
 * runs in CI with no database. Whether each allowed function actually EXISTS is
 * a separate question, answered by the checked-in drift-check script against a
 * live database.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "../../..")

/**
 * Called by the frontend, but no such function exists in the database yet.
 *
 * These must NOT be added to CALLABLE. Allow-listing a function that was never
 * written does not make the screen work — it turns a clear "Unknown function"
 * 404 into a Postgres 42883, and hides the fact that the feature is unbuilt.
 * The screens stay broken either way; this way the reason stays legible.
 *
 * Shrinking this list means building the function. It should never grow.
 */
const KNOWN_UNBUILT = new Set([
  // The whole company-banking feature: no company_bank_details table in Neon.
  "get_company_bank_details",
  "upsert_company_bank_details",
  "verify_company_bank_details",
  // Salary structure editing; salary_revisions was never ported from Supabase.
  "upsert_salary_structure",
])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p)
  }
  return out
}

/**
 * Every RPC the clients actually call.
 *
 * Two shapes, because the two clients call differently: the web app goes
 * through the Supabase shim as `supabase.rpc("name")`, and the native app has
 * its own bare `rpc("name")` helper. Matching only the first made every
 * mobile-only function look like a dead allow-list entry, which Test 3 then
 * reported as an unused grant — a false failure that invites deleting a live
 * entry to make the suite green.
 *
 * `rpc` matches both, since the boundary falls after the dot as well. The
 * required quote is what keeps the helper's own definition out: it is declared
 * as `rpc<T>(fn: string)`, not called with a literal.
 */
function calledFunctions(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const dir of ["frontend/src", "mobile/src"]) {
    let files: string[]
    try {
      files = sourceFiles(join(rootDir, dir))
    } catch {
      continue // mobile/ is optional; not every checkout has it
    }
    for (const file of files) {
      for (const m of readFileSync(file, "utf8").matchAll(/\brpc\s*(?:<[^>]*>)?\(\s*"([a-z_][a-z0-9_]*)"/g)) {
        const where = found.get(m[1]!) ?? []
        where.push(file.slice(rootDir.length + 1).replace(/\\/g, "/"))
        found.set(m[1]!, where)
      }
    }
  }
  return found
}

/**
 * The allow-list, read out of the source.
 *
 * Parsed rather than imported: importing index.ts evaluates the module, which
 * starts the HTTP server and opens a database pool.
 */
function allowedFunctions(): Set<string> {
  const src = readFileSync(join(__dirname, "../index.ts"), "utf8")
  const start = src.indexOf("const CALLABLE")
  assert.notEqual(start, -1, "Could not find CALLABLE in index.ts")
  const block = src.slice(start, src.indexOf("])", start))
  return new Set([...block.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]!))
}

async function runTests() {
  console.log("=== RUNNING RPC ALLOW-LIST DRIFT TESTS ===\n")

  const called = calledFunctions()
  const allowed = allowedFunctions()

  // ---------------------------------------------------------------------------
  // TEST 1: every function the clients call is reachable
  // ---------------------------------------------------------------------------
  console.log("Test 1: Verifying every RPC the clients call is in CALLABLE...")
  const blocked = [...called.keys()].filter((fn) => !allowed.has(fn) && !KNOWN_UNBUILT.has(fn)).sort()
  assert.deepEqual(
    blocked,
    [],
    "These RPCs are called by a client but missing from CALLABLE, so they 404 at runtime:\n" +
      blocked.map((fn) => `    ${fn}  <- ${called.get(fn)!.join(", ")}`).join("\n") +
      "\n  Add each to CALLABLE only after confirming the function exists in the database."
  )
  console.log(`  PASSED: all ${called.size - KNOWN_UNBUILT.size} live call sites are allow-listed.`)

  // ---------------------------------------------------------------------------
  // TEST 2: unbuilt functions are not allow-listed
  // ---------------------------------------------------------------------------
  console.log("\nTest 2: Verifying unbuilt RPCs are not allow-listed...")
  const wronglyAllowed = [...KNOWN_UNBUILT].filter((fn) => allowed.has(fn)).sort()
  assert.deepEqual(
    wronglyAllowed,
    [],
    `Allow-listed but no such database function: ${wronglyAllowed.join(", ")}. ` +
      "Either build the function and remove it from KNOWN_UNBUILT, or drop it from CALLABLE."
  )
  console.log(`  PASSED: ${KNOWN_UNBUILT.size} unbuilt functions correctly withheld.`)

  // ---------------------------------------------------------------------------
  // TEST 3: no permission granted that nothing uses
  // ---------------------------------------------------------------------------
  // Least privilege: an entry no client calls is reachable by any authenticated
  // caller for no reason. This is a real assertion, not a warning, because a
  // warning nobody reads is how the list grew a dead entry in the first place.
  console.log("\nTest 3: Verifying CALLABLE grants nothing unused...")
  const unused = [...allowed].filter((fn) => !called.has(fn)).sort()
  assert.deepEqual(
    unused,
    [],
    `In CALLABLE but called by no client: ${unused.join(", ")}. ` +
      "Remove it, or add the call site that justifies it."
  )
  console.log(`  PASSED: all ${allowed.size} allow-listed functions have a caller.`)

  console.log("\n=== ALL RPC DRIFT TESTS PASSED ===")
}

runTests().catch((error) => {
  console.error("\n  FAILED: " + (error as Error).message)
  process.exit(1)
})
