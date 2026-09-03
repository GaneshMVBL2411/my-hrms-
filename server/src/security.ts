import type { PoolClient } from "pg"
import { withoutSession } from "./db.js"

/**
 * Technical controls from ISO/IEC 27001:2022 Annex A that belong in the API.
 *
 *   A.8.5   Secure authentication — sign-in is throttled, so a stolen email
 *           address cannot be turned into an account by guessing.
 *   A.8.15  Logging — security events are recorded in audit_logs, which is
 *           append-only and readable only by HR.
 *   A.8.16  Monitoring activities — the same log is what makes a burst of
 *           failures against one account visible after the fact.
 *
 * The standard asks for a great deal more than this: a risk assessment, a
 * statement of applicability, an owner for each control, internal audit,
 * management review. None of that is code, and none of it is here. What is
 * here are the controls whose absence would be a finding no policy could
 * paper over.
 */

// --------------------------------------------------------- A.8.5 throttling
interface Attempts {
  count: number
  first: number
  lockedUntil: number
}

const attempts = new Map<string, Attempts>()
const MAX_ATTEMPTS_MAP_SIZE = 5000

function cleanupExpiredAttempts(): void {
  const now = Date.now()
  for (const [key, rec] of attempts.entries()) {
    if (rec.lockedUntil <= now && now - rec.first > WINDOW_MS) {
      attempts.delete(key)
    }
  }

  // If map is still over capacity, evict oldest entries
  if (attempts.size > MAX_ATTEMPTS_MAP_SIZE) {
    const toRemove = attempts.size - MAX_ATTEMPTS_MAP_SIZE
    let removed = 0
    for (const key of attempts.keys()) {
      attempts.delete(key)
      removed++
      if (removed >= toRemove) break
    }
  }
}

/** After this many failures the account stops accepting attempts for a while. */
const MAX_ATTEMPTS = 5
/** Failures older than this are forgotten, so a typo last week costs nothing. */
const WINDOW_MS = 15 * 60_000
const LOCKOUT_MS = 15 * 60_000

/**
 * Keyed on the email rather than the IP.
 *
 * The attack this defends against is guessing one account's password, and an
 * attacker with a pool of addresses changes IP freely while the target address
 * stays the same. Keying on IP would also punish an office behind one NAT,
 * where a colleague's typo would lock out the floor.
 */
export function loginBlocked(email: string): number | null {
  const key = email.trim().toLowerCase()
  const rec = attempts.get(key)
  if (!rec) return null

  const now = Date.now()
  if (rec.lockedUntil > now) return Math.ceil((rec.lockedUntil - now) / 1000)

  // The window has passed with no lockout: start again from clean.
  if (now - rec.first > WINDOW_MS) {
    attempts.delete(key)
    return null
  }
  return null
}

export function recordFailure(email: string): void {
  if (attempts.size >= MAX_ATTEMPTS_MAP_SIZE) {
    cleanupExpiredAttempts()
  }

  const key = email.trim().toLowerCase()
  const now = Date.now()
  const rec = attempts.get(key)

  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now, lockedUntil: 0 })
    return
  }

  rec.count += 1
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS
    rec.count = 0
    rec.first = now
  }
}

/** A sign-in succeeded, so the failures before it were someone mistyping. */
export function clearFailures(email: string): void {
  attempts.delete(email.trim().toLowerCase())
}

// --------------------------------------------------- General rate limiting
interface RateLimitBucket {
  count: number
  resetAt: number
}

const MAX_RATE_LIMITER_MAP_SIZE = 10_000

export function createRateLimiter(options: {
  windowMs: number
  max: number
  message?: string
  keyGenerator?: (req: import("express").Request) => string
}) {
  const buckets = new Map<string, RateLimitBucket>()
  const { windowMs, max, message = "Too many requests. Please try again later." } = options
  const getKey = options.keyGenerator ?? ((req) => req.ip || req.socket.remoteAddress || "unknown")

  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const now = Date.now()
    const key = getKey(req)
    let bucket = buckets.get(key)

    if (!bucket || now >= bucket.resetAt) {
      if (buckets.size >= MAX_RATE_LIMITER_MAP_SIZE) {
        // Evict expired buckets
        for (const [k, b] of buckets.entries()) {
          if (now >= b.resetAt) buckets.delete(k)
        }
      }
      bucket = { count: 1, resetAt: now + windowMs }
      buckets.set(key, bucket)
    } else {
      bucket.count++
    }

    res.setHeader("X-RateLimit-Limit", max)
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - bucket.count))
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000))

    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000))
      return res.status(429).json({ error: message })
    }

    next()
  }
}

// ----------------------------------------------------------- A.8.15 logging
/**
 * Records a security event without a session.
 *
 * Used for the events that happen before or instead of authentication — a
 * failed sign-in above all — which by definition have no session context to
 * run inside. The database function is SECURITY DEFINER for the same reason.
 */
export async function logSecurityEvent(
  action: string,
  entity: string,
  entityId: number | null,
  meta: Record<string, unknown> | null,
  email?: string,
  ip?: string,
  result?: "success" | "failure" | "blocked"
): Promise<void> {
  try {
    await withoutSession((client: PoolClient) =>
      client.query(
        "select public.log_security_event($1, $2, $3, $4::jsonb, $5, $6, $7)",
        [action, entity, entityId, meta ? JSON.stringify(meta) : null, email ?? null, ip ?? null, result ?? null]
      )
    )
  } catch {
    // Never let logging break the request it is describing. The database
    // function swallows its own errors for the same reason; this covers the
    // case where the connection itself is the problem.
  }
}

/**
 * What may be written about a sign-in attempt.
 *
 * The address is recorded because an audit trail that cannot say which account
 * was attacked is of no use. The password never is — not even its length, which
 * narrows a search — and neither is anything that would let the log itself
 * become the thing worth stealing.
 */
export function loginMeta(email: string, ip: string | undefined) {
  return { email: email.trim().toLowerCase(), ip: ip ?? null }
}
