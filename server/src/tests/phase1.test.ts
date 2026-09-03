import assert from "node:assert/strict"
import "../env.js"
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test_jwt_secret_for_unit_tests_only_32_characters_minimum_length"
}
import { issueToken, type AuthenticatedUser } from "../auth.js"
import { createRateLimiter } from "../security.js"

async function runTests() {
  console.log("=== RUNNING PHASE 1 REGRESSION TESTS ===\n")

  // ---------------------------------------------------------------------------
  // TEST 1: H1 — JWT claims (issuer, audience, explicit HS256 algorithm)
  // ---------------------------------------------------------------------------
  console.log("Test 1: Verifying JWT claims (iss, aud, HS256 algorithm)...")
  const mockUser: AuthenticatedUser = {
    userId: 12345,
    email: "h1-test@example.com",
    role: "employee",
    companyId: 1,
    employeeId: 12345,
    isSuperAdmin: false,
  }

  const token = issueToken(mockUser, 2)
  const parts = token.split(".")
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"))
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"))

  assert.equal(header.alg, "HS256", "Token algorithm MUST explicitly be HS256")
  assert.equal(payload.iss, "hrms-api", "Token issuer MUST be hrms-api")
  assert.equal(payload.aud, "hrms-client", "Token audience MUST be hrms-client")
  assert.equal(payload.version, 2, "Token version MUST be 2")
  assert(payload.jti, "Token MUST include jti")
  console.log("  PASSED: JWT token has explicit HS256, issuer, audience, and jti.")

  // ---------------------------------------------------------------------------
  // TEST 2: H3 — Rate limiting & abuse protection
  // ---------------------------------------------------------------------------
  console.log("\nTest 2: Verifying rate limiter behavior and header emissions...")
  const limiter = createRateLimiter({
    windowMs: 5000,
    max: 3,
    message: "Rate limit reached",
    keyGenerator: () => "test-client-ip-123",
  })

  let statusSent = 0
  let jsonSent: any = null
  const headersSet: Record<string, any> = {}

  const mockReq = {} as any
  const createMockRes = () => ({
    setHeader: (k: string, v: any) => {
      headersSet[k] = v
    },
    status: (s: number) => {
      statusSent = s
      return {
        json: (j: any) => {
          jsonSent = j
        },
      }
    },
  } as any)

  let nextCalls = 0
  const next = () => {
    nextCalls++
  }

  // Calls 1, 2, 3 should succeed
  limiter(mockReq, createMockRes(), next)
  assert.equal(nextCalls, 1, "Call 1 should pass")
  assert.equal(headersSet["X-RateLimit-Remaining"], 2)

  limiter(mockReq, createMockRes(), next)
  assert.equal(nextCalls, 2, "Call 2 should pass")
  assert.equal(headersSet["X-RateLimit-Remaining"], 1)

  limiter(mockReq, createMockRes(), next)
  assert.equal(nextCalls, 3, "Call 3 should pass")
  assert.equal(headersSet["X-RateLimit-Remaining"], 0)

  // Call 4 should be blocked with 429
  limiter(mockReq, createMockRes(), next)
  assert.equal(nextCalls, 3, "Call 4 should NOT call next()")
  assert.equal(statusSent, 429, "Call 4 must return HTTP 429")
  assert.equal(jsonSent?.error, "Rate limit reached")
  assert(headersSet["Retry-After"] !== undefined, "Retry-After header must be set")
  console.log("  PASSED: Rate limiter enforces limit and returns 429 with Retry-After.")

  console.log("\n=== ALL PHASE 1 TESTS PASSED ===")
}

runTests().catch((err) => {
  console.error("\nTEST FAILED:", err)
  process.exit(1)
})
