import assert from "node:assert/strict"
import "../env.js"
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test_jwt_secret_for_unit_tests_only_32_characters_minimum_length"
}
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { issueToken, resolveUser, revokeToken, isTokenRevoked, type AuthenticatedUser } from "../auth.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "../../..")

async function runTests() {
  console.log("=== RUNNING PHASE 0 REGRESSION TESTS ===\n")

  // ---------------------------------------------------------------------------
  // TEST 1: C1 — Credentials and secrets: Check no hardcoded passwords in files
  // ---------------------------------------------------------------------------
  console.log("Test 1: Verifying no hardcoded seed passwords in migrations & scripts...")
  const filesToCheck = [
    join(rootDir, "neon/migrations/0008_platform_and_prozonic.sql"),
    join(rootDir, "neon/migrations/0002_auth_functions.sql"),
    join(rootDir, "server/src/scripts/finalize-neon.ts"),
    join(rootDir, "server/src/scripts/migrate-data.ts"),
    join(rootDir, "supabase/reset-passwords.sql"),
    join(rootDir, "supabase/seed.mjs"),
    join(rootDir, "supabase/add-company-prozonic.sql"),
    join(rootDir, "supabase/add-employee-kalyani.sql"),
  ]

  const bannedPatterns = [
    "Prozonic@123",
    "Platform@123",
    "HrAdmin@123",
    "Founder@123",
    "Manager@123",
    "TeamLead@123",
    "Employee@123",
    "Kalyani@123",
  ]

  for (const file of filesToCheck) {
    if (!existsSync(file)) continue
    const content = readFileSync(file, "utf8")
    for (const pattern of bannedPatterns) {
      assert(
        !content.includes(pattern),
        `Found banned plaintext secret '${pattern}' in ${file}`
      )
    }
  }
  console.log("  PASSED: Zero hardcoded seed credentials detected.")

  // ---------------------------------------------------------------------------
  // TEST 2: C0 / L10 — .gitignore protection for secrets, backups, and dist
  // ---------------------------------------------------------------------------
  console.log("\nTest 2: Verifying .gitignore protects .env, .bak, and dist...")
  const checkIgnored = (path: string) => {
    try {
      execSync(`git check-ignore ${path}`, { cwd: rootDir, stdio: "pipe" })
      return true
    } catch {
      return false
    }
  }

  assert(checkIgnored("server/.env"), "server/.env MUST be ignored by git")
  assert(checkIgnored("frontend/.env.local-bak"), "frontend/.env.local-bak MUST be ignored by git")
  assert(checkIgnored("frontend/.env.supabase.bak"), "frontend/.env.supabase.bak MUST be ignored by git")
  assert(checkIgnored("server/dist/index.js"), "server/dist/ MUST be ignored by git")
  assert(checkIgnored("node_modules/foo"), "node_modules/ MUST be ignored by git")
  assert(checkIgnored("backup/test.dump"), "backup/ MUST be ignored by git")
  console.log("  PASSED: .gitignore correctly protects all sensitive and build files.")

  // ---------------------------------------------------------------------------
  // TEST 3: C2 & H1 — Token jti and revocation mechanics
  // ---------------------------------------------------------------------------
  console.log("\nTest 3: Verifying JWT token structure, jti, and revocation...")
  const mockUser: AuthenticatedUser = {
    userId: 99999,
    email: "security-test@example.com",
    role: "employee",
    companyId: 1,
    employeeId: 99999,
    isSuperAdmin: false,
  }

  const token = issueToken(mockUser, 1)
  assert(typeof token === "string" && token.length > 20, "issueToken must return a valid token string")

  // Decode payload to verify jti and version claims
  const parts = token.split(".")
  assert.equal(parts.length, 3, "JWT must have 3 parts")
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"))
  assert.equal(payload.userId, 99999, "Token userId must match")
  assert(typeof payload.jti === "string" && payload.jti.length > 10, "Token MUST have a unique jti claim")
  assert.equal(payload.version, 1, "Token version must be set")

  // Test revocation
  assert.equal(isTokenRevoked(payload.jti), false, "Token should not be revoked initially")
  revokeToken(payload.jti)
  assert.equal(isTokenRevoked(payload.jti), true, "Token must be recognized as revoked after revokeToken()")

  const resolved = await resolveUser(token)
  assert.equal(resolved, null, "resolveUser must reject a revoked token")
  console.log("  PASSED: Token issue, jti generation, and revocation work as expected.")

  // ---------------------------------------------------------------------------
  // TEST 4: C2 — Password change SQL migration 0019 exists and has safety checks
  // ---------------------------------------------------------------------------
  console.log("\nTest 4: Verifying 0019_secure_password_change.sql integrity...")
  const migration0019 = readFileSync(join(rootDir, "neon/migrations/0019_secure_password_change.sql"), "utf8")
  assert(migration0019.includes("change_own_password"), "Migration must define change_own_password")
  assert(migration0019.includes("p_current_password text"), "change_own_password must accept current password")
  assert(migration0019.includes("p_new_password text"), "change_own_password must accept new password")
  assert(migration0019.includes("crypt(p_current_password, v_hash)"), "Must verify current password against bcrypt hash")
  assert(migration0019.includes("password_changed_at"), "Must record password_changed_at timestamp")
  assert(migration0019.includes("token_version"), "Must update token_version")
  assert(migration0019.includes("log_security_event"), "Must log security audit event")
  console.log("  PASSED: 0019_secure_password_change.sql verified.")

  console.log("\n=== ALL PHASE 0 TESTS PASSED ===")
}

runTests().catch((err) => {
  console.error("\nTEST FAILED:", err)
  process.exit(1)
})
