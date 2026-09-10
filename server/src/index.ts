// Must come first: db.ts and auth.ts both check for their environment variables
// at module scope, and ES modules evaluate dependencies in declaration order.
import "./env.js"

import express from "express"
import cors from "cors"
import { checkConnection, withSession, withoutSession } from "./db.js"
import { verifyCredentials, issueToken, requireAuth, AuthError, revokeRequestToken, validatePasswordStrength } from "./auth.js"
import { runQuery, QueryError, type QueryRequest } from "./query.js"
import {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  WebAuthnError,
  webauthnConfig,
} from "./webauthn.js"
import {
  registerDevice,
  issueChallenge,
  verifyDeviceSignature,
  DeviceAuthError,
} from "./deviceauth.js"
import { emailRouter } from "./email/routes.js"
import { onEmployeeCreated, onLeaveDecided, onLeaveSubmitted } from "./email/events.js"
import {
  loginBlocked,
  recordFailure,
  clearFailures,
  logSecurityEvent,
  loginMeta,
  createRateLimiter,
} from "./security.js"

const app = express()

// General body size limit (100kb) prevents unauthenticated DoS via huge JSON payloads
const generalBodyParser = express.json({ limit: "100kb" })

// Body parser specifically for base64 file uploads
const fileUploadBodyParser = express.json({ limit: "10mb" })

/**
 * The routes that carry a base64 image, and so may not be parsed at 100kb.
 *
 * Mounting the general parser with `app.use` is what made a route-level
 * `fileUploadBodyParser` useless: the global one runs first, reads the body,
 * and throws on anything over its own limit — so the wider parser downstream
 * never saw the request. A punch with a selfie attached (a few hundred KB
 * before base64 adds its third) failed every time, and /files had the same
 * fault waiting for a large enough upload.
 *
 * Skipping these paths rather than raising the global limit keeps the DoS
 * ceiling low everywhere else, which is what the 100kb was for.
 */
const LARGE_BODY_PATHS = ["/files", "/device/punch", "/attendance/punch"]

app.use((req, res, next) => {
  if (LARGE_BODY_PATHS.some((path) => req.path === path || req.path.startsWith(`${path}/`))) {
    return next()
  }
  return generalBodyParser(req, res, next)
})

// Security headers (M7)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
  next()
})

// Rate limiters for different sensitivity levels (H3)
const authLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  message: "Too many authentication requests. Please try again in a minute.",
})

const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 300,
  message: "Too many requests. Please slow down.",
})

const adminLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Too many administrative requests. Please wait a minute.",
})

const uploadLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Too many file upload requests. Please wait a minute.",
})

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
      : ["http://localhost:5173"],
    credentials: true,
  })
)

// --------------------------------------------------------------------- health
// Health check: sanitized in production to prevent information disclosure (L1)
app.get("/health", async (_req, res) => {
  try {
    const info = await checkConnection()
    const isProduction = process.env.NODE_ENV === "production"
    if (isProduction) {
      return res.json({ status: "ok" })
    }
    res.json({
      status: "ok",
      database: info.database,
      role: info.role,
      version: info.version.split(" ").slice(0, 2).join(" "),
      rlsBypassRisk: info.isOwner,
    })
  } catch (error) {
    res.status(503).json({ status: "error", message: process.env.NODE_ENV === "production" ? "Service unavailable" : (error as Error).message })
  }
})

// ----------------------------------------------------------------------- auth
app.post("/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" })
  }

  // A.8.5: refuse before verifying, so a locked account costs an attacker a
  // rejection rather than a password check they can time.
  const wait = loginBlocked(email)
  if (wait !== null) {
    await logSecurityEvent("login.blocked", "users", null, loginMeta(email, req.ip), email, req.ip, "blocked")
    return res.status(429).json({
      error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`,
    })
  }

  try {
    const user = await verifyCredentials(email, password)
    if (!user) {
      recordFailure(email)
      await logSecurityEvent("login.failed", "users", null, loginMeta(email, req.ip), email, req.ip, "failure")
      // Deliberately vague, and deliberately the same for an unknown address as
      // for a wrong password — the difference would let someone enumerate which
      // email addresses have accounts.
      return res.status(400).json({ error: "Invalid email or password" })
    }

    clearFailures(email)
    await logSecurityEvent("login.succeeded", "users", user.userId, loginMeta(email, req.ip), email, req.ip, "success")

    // A.5.17: the one moment the plaintext exists, so the one moment a hash
    // stored at an outdated cost can be strengthened. Deliberately not awaited
    // into the response path — a slow rehash should not delay the sign-in, and
    // failing to upgrade is not a reason to refuse a valid password.
    withoutSession((client) =>
      client.query("select public.upgrade_password_hash($1, $2)", [email, password])
    ).catch(() => undefined)

    res.json({
      access_token: issueToken(user),
      user: {
        id: user.userId,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        companyId: user.companyId,
        isSuperAdmin: user.isSuperAdmin,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(400).json({ error: error.message, code: error.code })
    }
    throw error
  }
})

// The same shape current_user_profile() returned on Supabase, so AuthContext.tsx
// reads it unchanged.
app.get("/auth/me", requireAuth, async (req, res) => {
  const profile = await withSession(req.user!, async (client) => {
    const { rows } = await client.query<{ current_user_profile: unknown }>(
      "select public.current_user_profile()"
    )
    return rows[0]?.current_user_profile ?? null
  })

  if (!profile) return res.status(401).json({ error: "Not authenticated" })
  res.json(profile)
})

// Session revocation on logout
app.post("/auth/logout", requireAuth, (req, res) => {
  revokeRequestToken(req)
  res.json({ ok: true })
})

// Changing your own password. The current password is verified server-side
// against the stored bcrypt hash before the new password is set, and existing
// sessions are invalidated.
app.post("/auth/password", requireAuth, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {}
  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ error: "Current password is required" })
  }
  const strength = validatePasswordStrength(newPassword)
  if (!strength.valid) {
    return res.status(400).json({ error: strength.reason })
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "New password must be different from current password" })
  }

  try {
    await withSession(req.user!, async (client) => {
      await client.query("select public.change_own_password($1, $2)", [currentPassword, newPassword])
    })
    revokeRequestToken(req)
    res.json({ ok: true, message: "Password updated successfully" })
  } catch (error) {
    const err = error as { code?: string; message: string }
    if (err.code === "42501" || err.message?.includes("Current password is incorrect")) {
      return res.status(400).json({ error: "Current password is incorrect" })
    }
    return res.status(400).json({ error: err.message || "Failed to update password" })
  }
})

// -------------------------------------------------------------- admin-users
// The Supabase Edge Function, moved here. It existed because creating a login
// needed the service key, which a browser must never hold; the same reasoning
// applies to a database role, so this stays server-side.
//
// This is also the endpoint that has been returning 404 for the whole of this
// project's life — the function was written but never deployed to Supabase.
app.post("/functions/admin-users", requireAuth, adminLimiter, async (req, res) => {
  const { action, email, password, role, employee, employeeId } = req.body ?? {}

  try {
    if (action === "create") {
      if (typeof email !== "string") {
        return res.status(400).json({ error: "Email is required" })
      }
      const strength = validatePasswordStrength(password)
      if (!strength.valid) {
        return res.status(400).json({ error: strength.reason })
      }

      const created = await withSession(req.user!, async (client) => {
        const { rows } = await client.query<{ create_employee_with_login: number }>(
          "select public.create_employee_with_login($1, $2, $3, $4::jsonb) as create_employee_with_login",
          [email, password, role ?? "employee", JSON.stringify(employee ?? {})]
        )
        return rows[0]?.create_employee_with_login ?? null
      })

      // Welcomes the new employee with an activation link, never the password
      // that was just set. Not awaited: the employee exists either way, and a
      // mail server having a bad afternoon must not fail the creation.
      if (created !== null && req.user!.companyId !== null) {
        const details = (employee ?? {}) as Record<string, unknown>
        onEmployeeCreated({
          employeeId: created,
          email,
          fullName:
            [details.first_name, details.last_name].filter(Boolean).join(" ") ||
            String(details.full_name ?? email),
          employeeCode: (details.employee_code as string | undefined) ?? null,
          companyId: req.user!.companyId,
          createdByName: req.user!.email,
          role: role ?? "employee",
        })
      }

      return res.json({ employeeId: created })
    }

    if (action === "set_password") {
      const strength = validatePasswordStrength(password)
      if (!strength.valid) {
        return res.status(400).json({ error: strength.reason })
      }
      await withSession(req.user!, (client) =>
        client.query("select public.set_employee_password($1, $2)", [Number(employeeId), password])
      )
      return res.json({ ok: true })
    }

    res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (error) {
    const err = error as { code?: string; message: string }
    if (err.code === "42501") return res.status(403).json({ error: err.message })
    if (err.code === "P0002") return res.status(404).json({ error: err.message })
    return res.status(400).json({ error: err.message })
  }
})

// ------------------------------------------------------------------ the data
// One generic route per table rather than forty hand-written ones. PostgREST
// worked this way and the frontend is built around it, so matching the shape
// keeps the 14 feature api.ts files a rename rather than a rewrite.
//
// Safety rests on two things. The table name is checked against a fixed list,
// never interpolated from user input — anything else is SQL injection through
// the URL. And every query runs inside withSession, so RLS applies exactly as
// it did under PostgREST.
const READABLE_TABLES = new Set([
  "employee_directory", "attendance_detail", "leave_balance_detail", "leave_request_detail",
  "project_directory", "project_member_detail", "task_directory", "task_comment_detail",
  "candidate_directory", "interview_detail", "asset_detail", "asset_assignment_detail",
  "salary_structure_detail", "payslip_detail", "policy_detail", "generated_letter_detail",
  "announcement_detail", "company_event_detail", "audit_log_detail",
  "companies", "company_modules", "subscription_plans", "company_subscriptions",
  "platform_services", "company_services", "support_sessions",
  "departments", "designations", "leave_types", "roles",
])

/**
 * The general query endpoint the frontend client talks to.
 *
 * A POST rather than a GET even for reads, because the description is a JSON
 * body. Nothing here decides who may see what — every statement runs inside
 * withSession, so row level security answers that, exactly as it did when
 * PostgREST was in this position.
 */
app.post("/query", requireAuth, apiLimiter, async (req, res) => {
  try {
    const result = await withSession(req.user!, (client) =>
      runQuery(client, req.body as QueryRequest, req.user!.companyId)
    )
    res.json(result)
  } catch (error) {
    if (error instanceof QueryError) {
      return res.status(400).json({ error: error.message })
    }
    // Business rules raised by the database are meant for the user.
    const err = error as { code?: string; message: string }
    if (err.code === "42501") return res.status(403).json({ error: err.message })
    if (err.code === "P0002") return res.status(404).json({ error: err.message })
    if (err.code === "P0001" || err.code === "23505") {
      return res.status(400).json({ error: err.message })
    }
    throw error
  }
})

// ------------------------------------------------------------------- files
// Replaces Supabase Storage. Bodies arrive base64-encoded inside JSON rather
// than as multipart: the frontend already reads the File into memory to preview
// it, the images are small, and it avoids a multipart dependency for two upload
// sites.
const MAX_FILE_BYTES = 5 * 1024 * 1024

function verifyImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false
  if (mimeType === "image/png") {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === "image/gif") {
    return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46
  }
  if (mimeType === "image/webp") {
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    )
  }
  return false
}

app.post("/files", requireAuth, uploadLimiter, fileUploadBodyParser, async (req, res) => {
  const { path, mimeType, base64 } = req.body ?? {}
  if (typeof path !== "string" || typeof mimeType !== "string" || typeof base64 !== "string") {
    return res.status(400).json({ error: "path, mimeType and base64 are required" })
  }

  // Path traversal prevention: sanitize path
  const sanitizedPath = path.replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/[^a-zA-Z0-9_\-\.\/]/g, "").slice(0, 150)
  if (!sanitizedPath || sanitizedPath.startsWith("/")) {
    return res.status(400).json({ error: "Invalid file path" })
  }

  const data = Buffer.from(base64, "base64")
  if (data.length === 0) return res.status(400).json({ error: "File is empty" })
  if (data.length > MAX_FILE_BYTES) {
    return res.status(413).json({ error: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB` })
  }

  // Only explicit image types
  if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(mimeType)) {
    return res.status(400).json({ error: `Unsupported file type: ${mimeType}` })
  }

  // Verify magic bytes
  if (!verifyImageMagicBytes(data, mimeType)) {
    return res.status(400).json({ error: "File content does not match declared image format" })
  }

  try {
    const row = await withSession(req.user!, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.files (company_id, path, mime_type, size_bytes, data, uploaded_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (company_id, path) do update
           set mime_type = excluded.mime_type,
               size_bytes = excluded.size_bytes,
               data = excluded.data,
               uploaded_by = excluded.uploaded_by,
               created_at = now()
         returning id`,
        [req.user!.companyId, sanitizedPath, mimeType, data.length, data, req.user!.userId]
      )
      return rows[0]
    })

    if (!row) return res.status(403).json({ error: "Not permitted to upload here" })
    res.json({ id: row.id, path: sanitizedPath, url: `/files/${row.id}` })
  } catch (error) {
    const err = error as { code?: string; message: string }
    if (err.code === "42501") return res.status(403).json({ error: err.message })
    throw error
  }
})

app.get("/files/:id", requireAuth, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : ""
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Invalid file id" })

  const file = await withSession(req.user!, async (client) => {
    const { rows } = await client.query<{ mime_type: string; data: Buffer }>(
      "select mime_type, data from public.files where id = $1",
      [id]
    )
    return rows[0]
  })

  if (!file) return res.status(404).json({ error: "Not found" })

  res.setHeader("Content-Type", file.mime_type)
  res.setHeader("Content-Security-Policy", "default-src 'none'")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Content-Disposition", "inline; filename=\"attachment\"")
  res.setHeader("Cache-Control", "private, max-age=300")
  res.send(file.data)
})

app.get("/rest/:table", requireAuth, apiLimiter, async (req, res) => {
  // Express 5 types a route param as string | string[], because a wildcard can
  // capture several segments. Anything but a plain string is not a table name.
  const table = typeof req.params.table === "string" ? req.params.table : ""
  // Membership of the allow-list is what makes it safe to format this into the
  // SQL below, so the check has to come before anything touches it.
  if (!READABLE_TABLES.has(table)) {
    return res.status(404).json({ error: `Unknown collection: ${table}` })
  }

  const limit = Math.min(Number(req.query.limit) || 100, 1000)
  const offset = Number(req.query.offset) || 0

  const rows = await withSession(req.user!, async (client) => {
    // The identifier is from the allow-list above, so formatting it in is safe;
    // everything a caller controls goes through a bound parameter.
    const result = await client.query(
      `select * from public.${table} limit $1 offset $2`,
      [limit, offset]
    )
    return result.rows
  })

  res.json(rows)
})

/**
 * Database functions, which is how most of the HRMS writes.
 *
 * An allow-list, so a caller cannot invoke arbitrary SQL functions by name. That
 * makes it a list that drifts: a screen added later calls something not in here
 * and fails with 404, and the tempting fix is to widen the list rather than to
 * check what the new entry actually exposes.
 *
 * `rpc-drift.test.ts` now diffs this against every `supabase.rpc(...)` call site
 * in the frontend, so the drift is caught by a test rather than by a user.
 *
 * Entries are added only after confirming the function exists in the database.
 * Adding a name for a function that was never written turns a clear 404 into a
 * confusing 42883 and hides the fact that the feature is unbuilt.
 */
const CALLABLE = new Set([
  "current_user_profile", "get_employee_detail",
  // attendance_check_in and attendance_check_out are deliberately absent. They
  // are called by /attendance/punch, which stores the photograph in the same
  // transaction; reachable through /rpc they would let a client record a punch
  // with no photo at all, which is the thing that route exists to prevent.
  "attendance_summary", "apply_leave", "decide_leave_request", "update_task",
  "assign_asset", "return_asset", "generate_payslip", "generate_payslips_bulk",
  "payroll_summary", "generate_letter", "get_letter_view", "get_calendar",
  "report_attendance", "report_leaves", "report_tasks", "report_projects", "report_employees",
  "report_reporting_manager",
  // Internal messaging. message_contacts exists because `users` is not readable
  // through the query endpoint and employee_directory carries no user_id.
  "message_threads", "message_contacts",
  // Presence. Both are narrow by construction rather than by permission:
  // touch_presence takes no arguments and can only stamp whoever is asking,
  // and presence_for returns a last-seen time and nothing else about a user,
  // scoped to the caller's own company.
  "touch_presence", "presence_for",
  "deactivate_employee", "set_employee_role", "upsert_company_settings",
  "log_application_audit",
  // Resolves the caller's own employee id from the session context and takes no
  // arguments, so it can only ever answer for whoever is asking — the same value
  // /auth/me already returns. Its absence broke every "my ..." screen: leave
  // balances, my attendance, my salary structure and my assets all call it.
  "app_employee_id",
  // Platform console. Each re-checks app_is_super_admin() / app_is_platform_user() itself.
  "platform_company_overview", "platform_summary", "platform_subscription_plans",
  "platform_create_company", "platform_update_subscription", "platform_update_company_modules",
  "start_support_session", "end_support_session",
])

/**
 * Turns a completed RPC into an email, for the handful worth one.
 *
 * Deliberately reads the row back instead of trusting the arguments: the
 * request said "apply for leave from these dates", and what matters to the
 * employee is the request the database actually stored. Anything thrown here
 * is swallowed — the leave is applied for either way.
 */
async function notifyForRpc(fn: string, result: unknown, req: express.Request): Promise<void> {
  if (fn !== "apply_leave" && fn !== "decide_leave_request") return

  const id = Number(result)
  if (!Number.isInteger(id) || req.user!.companyId === null) return

  try {
    const row = await withSession(req.user!, async (client) => {
      const { rows } = await client.query<{
        employee_id: number
        leave_type_name: string
        start_date: string
        end_date: string
        days_count: string
        reason: string | null
        status: string
        decision_note: string | null
        decided_by_name: string | null
      }>(
        `select employee_id, leave_type_name, start_date, end_date, days_count,
                reason, status, decision_note, decided_by_name
           from public.leave_request_detail where id = $1`,
        [id]
      )
      return rows[0] ?? null
    })
    if (!row) return

    const shared = {
      requestId: id,
      employeeId: row.employee_id,
      companyId: req.user!.companyId,
      leaveType: row.leave_type_name,
      startDate: row.start_date,
      endDate: row.end_date,
      days: row.days_count,
    }

    if (fn === "apply_leave") {
      onLeaveSubmitted({ ...shared, reason: row.reason })
    } else {
      onLeaveDecided({
        ...shared,
        approved: row.status === "approved",
        decisionNote: row.decision_note,
        decidedBy: row.decided_by_name ?? undefined,
      })
    }
  } catch (error) {
    console.error("[email] leave notification skipped:", (error as Error).message)
  }
}

app.post("/rpc/:fn", requireAuth, apiLimiter, async (req, res) => {
  const fn = typeof req.params.fn === "string" ? req.params.fn : ""
  if (!CALLABLE.has(fn)) {
    return res.status(404).json({ error: `Unknown function: ${fn}` })
  }

  // Called with named arguments, the way PostgREST did — these functions take
  // typed parameters (p_id integer, p_month integer), not one jsonb blob, so
  // passing a blob would fail to resolve any of them. Argument names are
  // validated as identifiers; the values are bound.
  const args = (req.body ?? {}) as Record<string, unknown>
  const names = Object.keys(args)
  if (names.some((n) => !/^[a-z_][a-z0-9_]*$/.test(n))) {
    return res.status(400).json({ error: "Invalid argument name" })
  }

  const call = names.map((n, i) => `${n} => $${i + 1}`).join(", ")
  const values = names.map((n) => args[n])

  try {
    const result = await withSession(req.user!, async (client) => {
      const { rows } = await client.query(`select public.${fn}(${call}) as result`, values)
      return rows[0]?.result ?? null
    })

    // Notifications for the two functions people expect an email from. Read
    // back from the database rather than from the request body, so the mail
    // describes what was actually recorded — dates the function normalised, a
    // day count it worked out — and not what the caller claimed.
    await notifyForRpc(fn, result, req)

    res.json(result)
  } catch (error) {
    // Postgres raises the HRMS's own business rules — "Already checked in
    // today", "You don't have permission" — as exceptions. They are meant for
    // the user, so they are passed through rather than flattened to a 500.
    const err = error as { code?: string; message: string }
    if (err.code === "42501") return res.status(403).json({ error: err.message })
    if (err.code === "P0002") return res.status(404).json({ error: err.message })
    if (err.code === "P0001") return res.status(400).json({ error: err.message })
    throw error
  }
})

// -------------------------------------------------------- biometric punch
/**
 * Writes the punch, once something has already proved who is punching.
 *
 * Shared by both clients: the web app proves it with a WebAuthn assertion, the
 * native app with an ed25519 signature. Everything after that proof is the
 * same, and it lives here rather than in each route so the two cannot drift —
 * a photo size limit tightened in one place and not the other would be a quiet
 * inconsistency between platforms.
 *
 * Takes the caller's `client` rather than opening its own, so it runs inside
 * the transaction the verification ran in. If the check-in raises "Already
 * checked in today", the verification's bookkeeping rolls back with it.
 *
 * It cannot be called without a verification having happened first only because
 * both callers do so — nothing here enforces it, which is precisely why this is
 * a private helper and not a route.
 */
async function recordPunch(
  client: import("pg").PoolClient,
  user: { userId: number; companyId: number | null },
  direction: "in" | "out",
  photo: unknown,
  location: unknown,
  /**
   * How the punch was authorised, which is not the same question as what is
   * attached to it. "biometric" means a signature was checked; "manual" means
   * somebody pressed a button. A photograph is evidence either way and does
   * not promote one into the other.
   */
  method: "biometric" | "manual" = "biometric"
): Promise<{ id: number | null; photoStored: boolean; locationStored: boolean }> {
  const place = readPlace(location)
  // The selfie is evidence attached to the record, never the thing that
  // authorises it: it is stored after the proof has already passed, and a
  // failure to store one does not change whether the punch is valid.
  let photoId: string | null = null
  if (typeof photo === "string" && photo.startsWith("data:image/")) {
    const base64 = photo.slice(photo.indexOf(",") + 1)
    const bytes = Buffer.from(base64, "base64")
    if (bytes.length > 0 && bytes.length <= 2_000_000) {
      // Inside a savepoint, because the sentence above has to be true in the
      // code and not only in the comment. This runs in the same transaction as
      // the punch, so a rejected insert — an RLS policy, a constraint, a full
      // disk — aborted the whole thing and threw away an attendance record
      // whose biometric proof had already passed. The savepoint confines the
      // failure to the photo: the punch is still written, photoStored comes
      // back false, and the app says "Verified" rather than "Verified, photo
      // saved".
      await client.query("savepoint attendance_photo")
      try {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.files (company_id, path, mime_type, size_bytes, data, uploaded_by)
           values ($1, $2, 'image/jpeg', $3, $4, $5) returning id`,
          [
            user.companyId,
            `attendance/${user.userId}/${Date.now()}.jpg`,
            bytes.length,
            bytes,
            user.userId,
          ]
        )
        photoId = rows[0]?.id ?? null
        await client.query("release savepoint attendance_photo")
      } catch (error) {
        await client.query("rollback to savepoint attendance_photo")
        // Logged rather than swallowed: a punch that silently stops carrying
        // its photo is exactly the kind of thing nobody notices for months.
        console.error(
          `[attendance] photo not stored for user ${user.userId}: ${(error as Error).message}`
        )
      }
    }
  }

  // The two families take different arguments — the verified one is told
  // which method to record, the manual one is the method — so the call is
  // built per family rather than the name being swapped in one template.
  const { rows } =
    method === "biometric"
      ? await client.query(
          `select public.${
            direction === "in" ? "attendance_check_in_verified" : "attendance_check_out_verified"
          }('biometric', $1, $2, $3, $4) as result`,
          [photoId, place.latitude, place.longitude, place.accuracy]
        )
      : await client.query(
          `select public.${
            direction === "in" ? "attendance_check_in" : "attendance_check_out"
          }($1, $2, $3, $4) as result`,
          [photoId, place.latitude, place.longitude, place.accuracy]
        )
  return {
    id: rows[0]?.result ?? null,
    photoStored: photoId !== null,
    locationStored: place.latitude !== null,
  }
}

/**
 * The coordinates a punch claims, or nulls.
 *
 * Read defensively because this arrives from a phone: a reading that is not a
 * finite number, or not a point on Earth, is dropped rather than stored or
 * raised. Losing the location off an otherwise valid punch is a far smaller
 * problem than refusing an attendance record whose biometric proof already
 * passed — the same reasoning as the photo.
 *
 * Longitude and latitude are only kept as a pair. One without the other is not
 * a place, and storing half of it would put every such punch on the meridian
 * or the equator.
 */
function readPlace(location: unknown): {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
} {
  const empty = { latitude: null, longitude: null, accuracy: null }
  if (typeof location !== "object" || location === null) return empty

  const { latitude, longitude, accuracy } = location as Record<string, unknown>
  const finite = (value: unknown, limit: number) =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : null

  const lat = finite(latitude, 90)
  const lon = finite(longitude, 180)
  if (lat === null || lon === null) return empty

  // Accuracy is advisory, so a missing or absurd radius costs the radius and
  // not the reading. Capped because a "location" good to 50km is a cell tower,
  // and storing that as a number invites it being drawn as a point.
  const acc = finite(accuracy, 50_000)
  return { latitude: lat, longitude: lon, accuracy: acc === null ? null : Math.round(acc * 10) / 10 }
}

// ------------------------------------------------- native app device auth
// The same three steps as the WebAuthn routes — enrol, challenge, punch —
// signed with an ed25519 key the phone keeps behind its biometric lock. See
// deviceauth.ts for why the app cannot simply report that a check passed.
app.post("/device/register", requireAuth, authLimiter, async (req, res) => {
  const { publicKey, label } = req.body ?? {}
  try {
    await withSession(req.user!, (client) =>
      registerDevice(
        client,
        req.user!.userId,
        req.user!.companyId,
        typeof publicKey === "string" ? publicKey : "",
        typeof label === "string" ? label.slice(0, 60) : null
      )
    )
    res.json({ ok: true })
  } catch (error) {
    if (error instanceof DeviceAuthError) return res.status(400).json({ error: error.message })
    throw error
  }
})

app.post("/device/challenge", requireAuth, authLimiter, (req, res) => {
  res.json({ challenge: issueChallenge(req.user!.userId) })
})

/**
 * The selfie rides along in this body, so this route needs the large parser.
 *
 * On the global 100kb limit a punch with a photo attached never reached the
 * handler: a front-camera JPEG is a few hundred KB before base64 adds its
 * third, so express rejected the body and the punch failed with a generic
 * error that said nothing about a photo. `recordPunch` already caps the
 * decoded image at 2MB, which is the limit that actually governs what is
 * stored; this one only has to be wide enough to let it through.
 */
/**
 * A punch from the browser, with the photograph taken at the time.
 *
 * Separate from /device/punch because nothing here is verified. That route
 * checks an ed25519 signature over a challenge this server issued, and refuses
 * the punch without one. This route has no such proof and does not pretend to:
 * it records a manual punch, which is what pressing a button in a browser is,
 * and attaches the selfie as evidence beside it.
 *
 * The photo is therefore not optional-but-encouraged security. It is a record
 * of who was at the screen, useful to whoever reviews attendance, and worth
 * nothing against someone determined to mislead — which is exactly what the
 * native path exists for.
 */
app.post("/attendance/punch/:direction", requireAuth, authLimiter, fileUploadBodyParser, async (req, res) => {
  const direction = req.params.direction
  if (direction !== "in" && direction !== "out") {
    return res.status(404).json({ error: "Unknown punch direction" })
  }

  const { photo, location } = req.body ?? {}
  try {
    const result = await withSession(req.user!, (client) =>
      recordPunch(client, req.user!, direction, photo, location, "manual")
    )
    res.json(result)
  } catch (error) {
    const err = error as { code?: string; message: string }
    // P0001 is the function's own "Already checked in today" and the like:
    // a rule the caller can act on, not a fault in this server.
    if (err.code === "P0001") return res.status(400).json({ error: err.message })
    throw error
  }
})

app.post("/device/punch/:direction", requireAuth, authLimiter, fileUploadBodyParser, async (req, res) => {
  const direction = req.params.direction
  if (direction !== "in" && direction !== "out") {
    return res.status(404).json({ error: "Unknown punch direction" })
  }

  const { signature, photo, location } = req.body ?? {}
  try {
    const result = await withSession(req.user!, async (client) => {
      await verifyDeviceSignature(client, req.user!.userId, typeof signature === "string" ? signature : "")
      return recordPunch(client, req.user!, direction, photo, location)
    })
    res.json(result)
  } catch (error) {
    if (error instanceof DeviceAuthError) return res.status(401).json({ error: error.message })
    const err = error as { code?: string; message: string }
    if (err.code === "P0001") return res.status(400).json({ error: err.message })
    throw error
  }
})

/**
 * Enrolling a device, and punching in with it.
 *
 * These are separate routes rather than entries in the RPC allow-list because
 * the verification has to happen in Node: the WebAuthn signature is checked
 * against a challenge this process issued, and only once that passes does
 * anything reach the database. Exposing `attendance_check_in_verified` through
 * /rpc would let any authenticated caller post `p_method: 'biometric'` and
 * write a punch that claims a biometric check nobody performed — the record
 * would be a lie in exactly the way the feature exists to prevent.
 */
app.get("/webauthn/credentials", requireAuth, async (req, res) => {
  const list = await withSession(req.user!, async (client) => {
    const { rows } = await client.query(
      `select id, device_label, transports, created_at, last_used_at
         from public.webauthn_credentials where user_id = $1 order by created_at`,
      [req.user!.userId]
    )
    return rows
  })
  res.json(list)
})

app.post("/webauthn/register/options", requireAuth, authLimiter, async (req, res) => {
  const options = await withSession(req.user!, (client) =>
    registrationOptions(client, req.user!.userId, req.user!.email)
  )
  res.json(options)
})

app.post("/webauthn/register/verify", requireAuth, authLimiter, async (req, res) => {
  const { response, deviceLabel } = req.body ?? {}
  try {
    const result = await withSession(req.user!, (client) =>
      verifyRegistration(
        client,
        req.user!.userId,
        req.user!.companyId,
        response,
        typeof deviceLabel === "string" ? deviceLabel.slice(0, 60) : null
      )
    )
    res.json(result)
  } catch (error) {
    if (error instanceof WebAuthnError) return res.status(400).json({ error: error.message })
    throw error
  }
})

app.delete("/webauthn/credentials/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid credential" })
  await withSession(req.user!, (client) =>
    // The RLS policy already scopes this to the caller; the user_id predicate
    // is here so the intent survives if the policy is ever relaxed.
    client.query(`delete from public.webauthn_credentials where id = $1 and user_id = $2`, [
      id,
      req.user!.userId,
    ])
  )
  res.json({ ok: true })
})

app.post("/webauthn/punch/options", requireAuth, authLimiter, async (req, res) => {
  try {
    const options = await withSession(req.user!, (client) =>
      authenticationOptions(client, req.user!.userId)
    )
    res.json(options)
  } catch (error) {
    if (error instanceof WebAuthnError) return res.status(400).json({ error: error.message })
    throw error
  }
})

/**
 * The punch itself: verify the assertion, then check in or out.
 *
 * Both happen inside one `withSession`, so they share a transaction — if the
 * check-in raises "Already checked in today", the counter bump rolls back with
 * it and the credential is not left one signature ahead of what it has actually
 * done. That mismatch would not break the next punch (the counter only has to
 * advance), but it would put a lie in the audit trail.
 */
app.post("/webauthn/punch/:direction", requireAuth, authLimiter, async (req, res) => {
  const direction = req.params.direction
  if (direction !== "in" && direction !== "out") {
    return res.status(404).json({ error: "Unknown punch direction" })
  }

  const { response, photo, location } = req.body ?? {}

  try {
    const result = await withSession(req.user!, async (client) => {
      await verifyAuthentication(client, req.user!.userId, response ?? {})
      return recordPunch(client, req.user!, direction, photo, location)
    })

    res.json(result)
  } catch (error) {
    if (error instanceof WebAuthnError) return res.status(401).json({ error: error.message })
    const err = error as { code?: string; message: string }
    if (err.code === "P0001") return res.status(400).json({ error: err.message })
    throw error
  }
})

// --------------------------------------------------------- error handling
// Express's default handler renders an HTML page containing the stack trace,
// ---------------------------------------------------------------------- email
// Explicit routes with their own authorisation. Deliberately not reachable
// through /query: company_email_settings has no grant to this server's database
// role at all, so SMTP settings cannot be changed by a table write however the
// query allow-lists evolve.
app.use(emailRouter)

// which leaks absolute server paths, the dependency layout and the shape of the
// query that failed. It is also HTML, which every caller here is parsing as
// JSON — so a database error arrived at the client as a parse failure rather
// than as an error message.
//
// Four arguments, including `next`: that signature is how Express recognises an
// error handler, and omitting it makes this silently never run.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { code?: string; message?: string; type?: string }

  // Postgres error classes that describe a bad request rather than a fault.
  const byCode: Record<string, number> = {
    "42501": 403, // insufficient privilege — an RLS policy refused it
    "P0002": 404, // no_data_found
    "P0001": 400, // raise_exception — the HRMS's own business rules
    "23505": 409, // unique_violation
    "23503": 400, // foreign_key_violation
    "23502": 400, // not_null_violation
    "42703": 400, // undefined_column
    "42P01": 400, // undefined_table
    "22P02": 400, // invalid_text_representation
  }

  // body-parser reports an oversized body with a string code and its own
  // status. Left to the map below it fell through to 500 — "Internal server
  // error" for something the caller can actually fix by sending less.
  if (err.code === "LIMIT_FILE_SIZE" || err.type === "entity.too.large") {
    console.error(`[413] entity.too.large ${err.message ?? error}`)
    return res.status(413).json({ error: "That upload is too large. Try again with a smaller photo." })
  }

  // Ternary rather than `&&`: an empty-string code would make the whole
  // expression "" instead of a number, which `?? 500` would then accept.
  const status = (err.code ? byCode[err.code] : undefined) ?? 500
  console.error(`[${status}] ${err.code ?? "-"} ${err.message ?? error}`)

  // A 500 is a fault in this server, and its message may describe internals.
  // Anything else came from a rule the caller can act on, so it is passed through.
  res.status(status).json({
    error: status === 500 ? "Internal server error" : (err.message ?? "Request failed"),
    ...(err.code ? { code: err.code } : {}),
  })
})

// ------------------------------------------------------------------- startup
const port = Number(process.env.PORT) || 3001

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled rejection:", reason)
})

process.on("uncaughtException", (error) => {
  console.error("[process] uncaught exception:", error)
})

app.listen(port, async () => {
  console.log(`HRMS API listening on :${port}`)
  // Printed because a wrong RP ID or origin does not fail here — it fails in
  // the browser, at the moment an employee tries to enrol a phone, with an
  // error that names neither value. Seeing them at boot turns a confusing
  // support ticket into an obvious one.
  console.log(`  webauthn: rpId=${webauthnConfig.rpId} origins=${webauthnConfig.origins.join(",")}`)
  try {
    const info = await checkConnection()
    console.log(`  database: ${info.database} as ${info.role}`)
    if (info.isOwner) {
      console.warn(
        "  WARNING: connected as a role that owns the tables. Postgres exempts\n" +
          "  owners from row level security, so every policy is inactive and tenant\n" +
          "  isolation is NOT being enforced. Connect as hrms_app instead."
      )
    }
  } catch (error) {
    console.error(`  database unreachable: ${(error as Error).message}`)
  }
})
