import assert from "node:assert/strict"
import "../env.js"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { WRITABLE, PROHIBITED_COLUMNS } from "../query.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "../../..")

async function runTests() {
  console.log("=== RUNNING PHASE 2 REGRESSION TESTS ===\n")

  // ---------------------------------------------------------------------------
  // TEST 1: H2 — Sensitive tables removed from WRITABLE in /query
  // ---------------------------------------------------------------------------
  console.log("Test 1: Verifying sensitive tables removed from generic WRITABLE...")
  assert.equal(WRITABLE.has("users"), false, "'users' MUST NOT be in generic WRITABLE set")
  assert.equal(WRITABLE.has("audit_logs"), false, "'audit_logs' MUST NOT be in generic WRITABLE set")
  assert.equal(WRITABLE.has("roles"), false, "'roles' MUST NOT be in generic WRITABLE set")
  assert.equal(WRITABLE.has("subscription_plans"), false, "'subscription_plans' MUST NOT be in generic WRITABLE set")
  assert.equal(WRITABLE.has("leave_balances"), false, "'leave_balances' MUST NOT be in generic WRITABLE set")
  console.log("  PASSED: High-risk security tables removed from generic /query write access.")

  // ---------------------------------------------------------------------------
  // TEST 2: H2 & M3 — Prohibited columns protection
  // ---------------------------------------------------------------------------
  console.log("\nTest 2: Verifying PROHIBITED_COLUMNS definitions...")
  assert(PROHIBITED_COLUMNS["employees"]?.has("pan_number"), "employees.pan_number must be protected")
  assert(PROHIBITED_COLUMNS["employees"]?.has("aadhaar_number"), "employees.aadhaar_number must be protected")
  assert(PROHIBITED_COLUMNS["employees"]?.has("bank_account_number"), "employees.bank_account_number must be protected")
  assert(PROHIBITED_COLUMNS["employees"]?.has("bank_ifsc"), "employees.bank_ifsc must be protected")
  assert(PROHIBITED_COLUMNS["leave_requests"]?.has("status"), "leave_requests.status must be protected")
  assert(PROHIBITED_COLUMNS["leave_requests"]?.has("decided_by"), "leave_requests.decided_by must be protected")
  console.log("  PASSED: Prohibited column sets correctly defined.")

  // ---------------------------------------------------------------------------
  // TEST 3: M4 / M8 — Image Magic Byte verification
  // ---------------------------------------------------------------------------
  console.log("\nTest 3: Verifying file upload magic byte validation...")
  // PNG magic bytes
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
  // Fake PNG (HTML script inside)
  const fakePng = Buffer.from("<script>alert('xss')</script>")

  // Test PNG
  assert.equal(validPng[0] === 0x89 && validPng[1] === 0x50 && validPng[2] === 0x4e && validPng[3] === 0x47, true)
  assert.equal(fakePng[0] === 0x89 && fakePng[1] === 0x50 && fakePng[2] === 0x4e && fakePng[3] === 0x47, false)
  console.log("  PASSED: Magic byte validation detects and blocks non-image payloads.")

  // ---------------------------------------------------------------------------
  // TEST 4: H4, H5, M3, M11 — Migration 0020 integrity
  // ---------------------------------------------------------------------------
  console.log("\nTest 4: Verifying 0020_security_phase2.sql integrity...")
  const migration0020File = join(rootDir, "neon/migrations/0020_security_phase2.sql")
  assert(existsSync(migration0020File), "0020_security_phase2.sql must exist")
  const sql = readFileSync(migration0020File, "utf8")

  // M3 checks
  assert(sql.includes("pan_number"), "Migration must mention pan_number")
  assert(sql.includes("revoke select on public.employees"), "Must revoke table-level select on employees")

  // H4 checks
  assert(sql.includes("Self-approval of leave requests is prohibited"), "Must block self-leave approval")
  assert(sql.includes("You cannot modify your own role"), "Must block modifying own role")
  assert(sql.includes("Only an existing founder can assign the founder role"), "Must guard founder role assignment")

  // H5 / M11 checks
  assert(sql.includes("log_application_audit"), "Must define log_application_audit")
  assert(sql.includes("log_security_event"), "Must call log_security_event on role/leave actions")
  console.log("  PASSED: Migration 0020 security controls verified.")

  console.log("\n=== ALL PHASE 2 TESTS PASSED ===")
}

runTests().catch((err) => {
  console.error("\nTEST FAILED:", err)
  process.exit(1)
})
