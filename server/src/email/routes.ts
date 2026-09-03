import crypto from "node:crypto"
import express, { type Request, type Response } from "express"
import { requireAuth } from "../auth.js"
import { withSession, withoutSession } from "../db.js"
import { createRateLimiter, logSecurityEvent } from "../security.js"
import { encryptSecret, EmailConfigError, appBaseUrl } from "./config.js"
import {
  forgetTransport,
  isValidAddress,
  sendTemplateEmail,
  verifySMTPConnection,
  emailMode,
} from "./index.js"

/**
 * The email routes.
 *
 * Explicit endpoints with their own authorisation, rather than table access
 * through the generic /query endpoint. That is a deliberate difference in kind:
 * `company_email_settings` has no grant to the application role at all, so
 * there is no allow-list entry anyone could add later that would expose SMTP
 * settings to a table write. Everything here goes through a SECURITY DEFINER
 * function that takes the company from the session rather than the request.
 *
 * Three roles may touch email settings — founder, company_admin, hr_admin —
 * and the check is made twice: once here so the refusal is a clean 403, and
 * once inside the database function, which is the one that actually decides. A
 * check only in the API is a check that disappears the moment something calls
 * the function another way.
 */

const ADMIN_ROLES = new Set(["founder", "company_admin", "hr_admin"])

function requireEmailAdmin(req: Request, res: Response): boolean {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: "Not authenticated" })
    return false
  }
  // A super admin outside support mode has no company, so there are no tenant
  // settings for them to edit — they configure the platform through the
  // environment, not through this screen.
  if (!ADMIN_ROLES.has(user.role) || user.companyId === null) {
    res.status(403).json({ error: "You don't have permission to manage email settings" })
    return false
  }
  return true
}

/** Bounded so a test button cannot be turned into a way to send mail repeatedly. */
const testLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 5,
  message: "Too many test emails. Please wait a few minutes.",
})

/**
 * Keyed on the address, not the IP.
 *
 * Someone attacking one account changes IP freely; the address they are
 * attacking stays the same. The same reasoning as the sign-in throttle, and
 * the same reason it is not keyed on IP: an office behind one NAT would
 * otherwise lock each other out.
 */
const forgotLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 5,
  message: "Too many password reset requests. Please try again later.",
  keyGenerator: (req) => {
    const email = (req.body?.email ?? "").toString().trim().toLowerCase()
    return email || req.ip || "unknown"
  },
})

const resetLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  message: "Too many attempts. Please try again later.",
})

export const emailRouter = express.Router()

// ------------------------------------------------------------------- health
/**
 * Whether the mail server can be reached.
 *
 * Admin-only and says nothing about the host, the username or the provider's
 * own error — the public /health endpoint stays as it was, because an
 * unauthenticated caller learning which mail provider a company uses is a free
 * gift to whoever is writing the phishing email.
 */
emailRouter.get("/admin/email/health", requireAuth, async (req, res) => {
  if (!requireEmailAdmin(req, res)) return

  const result = await verifySMTPConnection(req.user!.companyId)
  res.json({
    smtp: result.connected ? "connected" : "unavailable",
    mode: result.mode,
    ...(result.reason ? { reason: result.reason } : {}),
  })
})

// ----------------------------------------------------------------- settings
/** The tenant's settings, without the password — there is no route that returns it. */
emailRouter.get("/admin/email/settings", requireAuth, async (req, res, next) => {
  if (!requireEmailAdmin(req, res)) return

  try {
    const settings = await withSession(req.user!, async (client) => {
      const { rows } = await client.query<{ result: unknown }>(
        "select public.get_company_email_settings() as result"
      )
      return rows[0]?.result
    })
    res.json({ ...(settings as object), mode: emailMode() })
  } catch (error) {
    next(error)
  }
})

emailRouter.put("/admin/email/settings", requireAuth, testLimiter, async (req, res, next) => {
  if (!requireEmailAdmin(req, res)) return

  const { host, port, secure, username, password, fromEmail, fromName, replyTo, enabled } =
    req.body ?? {}

  if (typeof host !== "string" || !host.trim()) {
    return res.status(400).json({ error: "SMTP host is required" })
  }
  const portNumber = Number(port ?? 587)
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    return res.status(400).json({ error: "SMTP port must be between 1 and 65535" })
  }
  if (!isValidAddress(fromEmail)) {
    return res.status(400).json({ error: "From address is not a valid email address" })
  }
  if (replyTo && !isValidAddress(replyTo)) {
    return res.status(400).json({ error: "Reply-to is not a valid email address" })
  }

  try {
    // Absent means "keep what is stored", which is what lets the screen show a
    // masked field without the browser ever holding the real password.
    const ciphertext =
      typeof password === "string" && password.length > 0 ? encryptSecret(password) : null

    await withSession(req.user!, (client) =>
      client.query(
        "select public.upsert_company_email_settings($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          host.trim(),
          portNumber,
          Boolean(secure),
          typeof username === "string" ? username.trim() : null,
          ciphertext,
          String(fromEmail).trim(),
          typeof fromName === "string" ? fromName.trim().slice(0, 120) : null,
          replyTo ? String(replyTo).trim() : null,
          Boolean(enabled),
        ]
      )
    )

    // The cached transport still holds the old settings, and a "test" straight
    // after a save would otherwise report on what was replaced.
    forgetTransport(req.user!.companyId)

    res.json({ ok: true, message: "Email settings saved" })
  } catch (error) {
    if (error instanceof EmailConfigError) {
      console.error("[email] settings save blocked:", error.message)
      return res.status(503).json({ error: "Email settings cannot be stored on this server yet" })
    }
    next(error)
  }
})

// --------------------------------------------------------------- test email
emailRouter.post("/admin/email/test", requireAuth, testLimiter, async (req, res) => {
  if (!requireEmailAdmin(req, res)) return

  const { email } = req.body ?? {}
  if (!isValidAddress(email)) {
    return res.status(400).json({ error: "A valid email address is required" })
  }

  const user = req.user!
  const result = await sendTemplateEmail({
    to: email.trim(),
    template: "smtp_test",
    companyId: user.companyId,
    data: {
      sentAt: new Date().toISOString(),
      requestedBy: user.email,
      environment: emailMode(),
    },
  })

  await logSecurityEvent(
    "email.test",
    "company_email_settings",
    user.companyId,
    // The recipient is recorded because "who did this get sent to" is the
    // question an audit of a test-email feature exists to answer. Nothing
    // about the transport is: not the host, not the username.
    { recipient: email.trim().toLowerCase(), mode: emailMode() },
    user.email,
    req.ip,
    result.ok ? "success" : "failure"
  )

  if (!result.ok) {
    return res.status(502).json({ success: false, message: result.message })
  }
  res.json({ success: true, message: "Test email sent successfully" })
})

// --------------------------------------------------------------- email log
/** Delivery history for this company. HR only, and enforced by RLS underneath. */
emailRouter.get("/admin/email/logs", requireAuth, async (req, res, next) => {
  if (!requireEmailAdmin(req, res)) return

  try {
    const rows = await withSession(req.user!, async (client) => {
      const { rows } = await client.query(
        `select id, recipient, subject, template, status, error_message, created_at, sent_at
           from public.email_logs order by created_at desc limit 100`
      )
      return rows
    })
    res.json({ data: rows })
  } catch (error) {
    next(error)
  }
})

// ----------------------------------------------------------- password reset
/**
 * Asks for a reset link.
 *
 * Answers identically whether or not the address has an account, and takes
 * about the same time either way — the work that differs is a token insert and
 * an email, both of which happen after the response is decided. An endpoint
 * that said "no such user" would be a way to enumerate every employee address
 * at a company, which is the raw material for a phishing campaign.
 */
emailRouter.post("/auth/forgot-password", forgotLimiter, async (req, res) => {
  const { email } = req.body ?? {}

  // The same answer for a malformed address as for a valid one.
  const generic = {
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  }

  if (!isValidAddress(email)) return res.json(generic)

  const address = email.trim()
  const base = appBaseUrl()

  try {
    // 32 random bytes, and only its SHA-256 is stored. A leak of the table is
    // then a leak of hashes rather than of working reset links.
    const token = crypto.randomBytes(32).toString("base64url")
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
    const ttlMinutes = 30

    const account = await withoutSession(async (client) => {
      const { rows } = await client.query<{
        user_id: number
        company_id: number | null
        full_name: string
        company_name: string
      }>("select * from public.create_password_reset($1, $2, $3, $4)", [
        address,
        tokenHash,
        ttlMinutes,
        req.ip ?? null,
      ])
      return rows[0] ?? null
    })

    // No account: stop here, having answered exactly as if there had been one.
    if (account && base) {
      await sendTemplateEmail({
        to: address,
        template: "password_reset",
        companyId: account.company_id,
        data: {
          employeeName: account.full_name,
          expiryMinutes: ttlMinutes,
          // The token appears here and nowhere else. It is not logged, not
          // audited, and not returned — the email is the only copy.
          actionUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
        },
      })
    } else if (account && !base) {
      console.error("[email] APP_BASE_URL is not set; a reset link cannot be built")
    }

    await logSecurityEvent(
      "password.reset_requested",
      "users",
      account?.user_id ?? null,
      { requested: address.toLowerCase(), delivered: Boolean(account && base) },
      address,
      req.ip,
      "success"
    )
  } catch (error) {
    // Even a failure answers the same way. Anything else turns an error into
    // the enumeration signal this endpoint is written to withhold.
    console.error("[email] forgot-password failed:", (error as Error).message)
  }

  res.json(generic)
})

/** Spends the token and sets the new password. */
emailRouter.post("/auth/reset-password", resetLimiter, async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== "string" || !token || typeof password !== "string") {
    return res.status(400).json({ error: "This reset link is no longer valid" })
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")

  try {
    await withoutSession((client) =>
      client.query("select public.consume_password_reset($1, $2)", [tokenHash, password])
    )
    res.json({ ok: true, message: "Your password has been changed. Please sign in." })
  } catch (error) {
    const err = error as { code?: string; message?: string }
    // The policy failure is worth passing through — someone choosing a new
    // password needs to know why it was refused. Everything else collapses to
    // one message, so a stolen link cannot be probed for its state.
    if (err.code === "P0001" && err.message?.toLowerCase().includes("password")) {
      return res.status(400).json({ error: err.message })
    }
    res.status(400).json({ error: "This reset link is no longer valid" })
  }
})
