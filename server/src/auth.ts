import jwt from "jsonwebtoken"
import { randomUUID } from "node:crypto"
import type { Request, Response, NextFunction } from "express"
import { withoutSession, type SessionContext } from "./db.js"

/**
 * The replacement for Supabase Auth (GoTrue).
 *
 * Deliberately the smallest thing that preserves what the HRMS already did:
 * sign in with email and password, carry a session, and resolve a role and a
 * company. No new concepts, no new providers — the frontend's AuthContext keeps
 * the same shape, so nothing above it changes.
 *
 * Passwords are verified by Postgres rather than in Node. GoTrue stored bcrypt
 * hashes in auth.users, and pgcrypto's crypt() verifies exactly that format —
 * so every existing password keeps working after the hashes are copied across,
 * and nobody has to reset anything. It also keeps hash handling in one place,
 * which is where reset-passwords.sql already expects it to be.
 */

const JWT_SECRET = process.env.JWT_SECRET
const JWT_TTL = process.env.JWT_TTL ?? "1h"

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Generate one with: openssl rand -base64 48")
}

/**
 * What the token carries. Kept to identity only — role and company are read
 * from the database on each request rather than trusted from the token.
 *
 * That costs one lookup and buys correctness: a role change, a deactivation or
 * a company suspension takes effect immediately instead of lingering until the
 * token expires. Supabase's JWT had the same staleness problem; this avoids
 * inheriting it.
 */
export interface TokenPayload {
  userId: number
  jti?: string
  version?: number
  iat?: number
  exp?: number
}

export interface AuthenticatedUser extends SessionContext {
  email: string
  role: string
  employeeId: number | null
  isSuperAdmin: boolean
  tokenVersion?: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

/**
 * Verifies an email and password against the stored bcrypt hash.
 *
 * Runs without a session context because there is no caller yet — this is the
 * one operation that legitimately precedes authentication. It is also why the
 * query is written to be indistinguishable between "no such user" and "wrong
 * password": returning different results would let an attacker enumerate which
 * addresses have accounts.
 */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<AuthenticatedUser | null> {
  return withoutSession(async (client) => {
    // Goes through authenticate() rather than querying `users` directly.
    // Without a session context, RLS on `users` matches nothing, so a direct
    // read reports every valid password as invalid. That function is SECURITY
    // DEFINER precisely so sign-in can happen before a session exists.
    const { rows } = await client.query<{
      user_id: number
      email: string
      company_id: number | null
      role: string
      employee_id: number | null
      is_active: boolean
      email_confirmed: boolean
    }>("select * from public.authenticate($1, $2)", [email, password])

    const row = rows[0]
    // No row means either a wrong password or an unknown address; the function
    // does not distinguish, so neither does this.
    if (!row) return null

    // Distinguished from a bad password on purpose: these are setup problems,
    // not credential problems, and hiding them behind "invalid password" makes
    // them undiagnosable. Matches how authApi.ts already treats them.
    if (!row.email_confirmed) throw new AuthError("Email not confirmed", "email_not_confirmed")
    if (!row.is_active) throw new AuthError("This account is not active. Contact HR.", "inactive")

    await client.query("select public.record_sign_in($1)", [row.user_id])

    const sessionRes = await client.query<{ token_version: number | null }>(
      "select coalesce(token_version, 1) as token_version from public.resolve_session($1)",
      [row.user_id]
    )
    const tokenVersion = sessionRes.rows[0]?.token_version ?? 1

    return {
      userId: row.user_id,
      companyId: row.company_id,
      email: row.email,
      role: row.role,
      employeeId: row.employee_id,
      isSuperAdmin: row.company_id === null && row.role === "super_admin",
      tokenVersion,
    }
  })
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = "AuthError"
  }
}

/**
 * Revoked token ids, held only until the token would have expired anyway.
 *
 * A Set that only ever grows is a slow leak: every logout and every password
 * change adds an id the process never forgets. Nothing is gained by keeping one
 * past its own token's expiry — after that the signature check rejects it
 * regardless — so each id is stored with that deadline and swept on write.
 *
 * In memory, with the same caveat as the login throttle in security.ts: a
 * restart forgives every revocation, and a second instance would not see the
 * first one's. Both stop being acceptable at two instances, at which point this
 * belongs in the database beside token_version, which already survives both.
 */
const revokedJtis = new Map<string, number>()

/** Kept this long when a token carried no expiry of its own to read. */
const FALLBACK_REVOCATION_TTL_S = 24 * 60 * 60

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * `expiresAt` is the token's own `exp` claim, in unix seconds. Optional so a
 * caller holding only the id still revokes correctly, just less precisely.
 */
export function revokeToken(jti: string, expiresAt?: number): void {
  const now = nowSeconds()
  for (const [id, exp] of revokedJtis) {
    if (exp <= now) revokedJtis.delete(id)
  }
  revokedJtis.set(jti, expiresAt ?? now + FALLBACK_REVOCATION_TTL_S)
}

export function isTokenRevoked(jti?: string): boolean {
  if (!jti) return false
  const exp = revokedJtis.get(jti)
  if (exp === undefined) return false
  // Past its own expiry the entry is dead weight, and the token is refused by
  // the signature check anyway. Drop it rather than report it as revoked.
  if (exp <= nowSeconds()) {
    revokedJtis.delete(jti)
    return false
  }
  return true
}

export function extractTokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length)
}

export function revokeRequestToken(req: Request): void {
  const token = extractTokenFromRequest(req)
  if (!token) return
  try {
    const decoded = jwt.decode(token) as TokenPayload | null
    if (decoded?.jti) {
      revokeToken(decoded.jti, decoded.exp)
    }
  } catch {
    // Ignore decode failure
  }
}

export function issueToken(user: AuthenticatedUser, tokenVersion?: number): string {
  const version = tokenVersion ?? user.tokenVersion ?? 1
  const payload: TokenPayload = {
    userId: user.userId,
    jti: randomUUID(),
    version,
  }
  const options: jwt.SignOptions = {
    expiresIn: JWT_TTL as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
    issuer: "hrms-api",
    audience: "hrms-client",
  }
  return jwt.sign(payload, JWT_SECRET!, options)
}

/**
 * Resolves the bearer token to a live user.
 *
 * Verifies explicit algorithm (HS256), checks for revocation (jti), validates
 * issuer/audience if present, and validates whether the token predates a
 * password change or session bump.
 */
export async function resolveUser(token: string): Promise<AuthenticatedUser | null> {
  let payload: TokenPayload & { iss?: string; aud?: string }
  try {
    payload = jwt.verify(token, JWT_SECRET!, { algorithms: ["HS256"] }) as TokenPayload & {
      iss?: string
      aud?: string
    }
    if (payload.iss && payload.iss !== "hrms-api") return null
    if (payload.aud && payload.aud !== "hrms-client") return null
  } catch {
    return null
  }

  if (payload.jti && isTokenRevoked(payload.jti)) {
    return null
  }

  return withoutSession(async (client) => {
    const { rows } = await client.query<{
      user_id: number
      email: string
      company_id: number | null
      role: string
      employee_id: number | null
      support_company_id: number | null
      password_changed_at?: string | null
      token_version?: number | null
    }>("select * from public.resolve_session($1)", [payload.userId])

    const row = rows[0]
    if (!row) return null

    // Check if token was issued prior to a password change
    if (row.password_changed_at && payload.iat && (!payload.version || payload.version < (row.token_version ?? 1))) {
      const changedSec = Math.floor(new Date(row.password_changed_at).getTime() / 1000)
      if (payload.iat < changedSec) {
        return null
      }
    }

    // Check if user session was invalidated via token_version bump
    if (row.token_version && payload.version && payload.version < row.token_version) {
      return null
    }

    const isSuperAdmin = row.company_id === null && row.role === "super_admin"

    return {
      userId: row.user_id,
      email: row.email,
      companyId: isSuperAdmin ? row.support_company_id : row.company_id,
      role: row.role,
      employeeId: row.employee_id,
      isSuperAdmin,
    }
  })
}

/** Rejects anything without a valid bearer token. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const user = await resolveUser(header.slice("Bearer ".length))
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  req.user = user
  next()
}

/**
 * Validates password complexity:
 * Minimum 8 characters, with uppercase, lowercase, and a digit or symbol.
 */
export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== "string" || password.length < 8) {
    return { valid: false, reason: "Password must be at least 8 characters long" }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one uppercase letter" }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one lowercase letter" }
  }
  if (!/[0-9\W]/.test(password)) {
    return { valid: false, reason: "Password must contain at least one number or special character" }
  }
  return { valid: true }
}
